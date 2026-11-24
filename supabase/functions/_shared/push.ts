// Envio de Web Push com a biblioteca web-push (a mesma do backend antigo).
// @ts-ignore: a biblioteca não traz tipos para o Deno
import webpush from "npm:web-push@3.6.7";
import type { Assinatura, ResultadoEnvio } from "./alertas-core.ts";

let configurado = false;

function configurar() {
  if (configurado) return;
  const assunto = Deno.env.get("VAPID_SUBJECT");
  const publica = Deno.env.get("VAPID_PUBLIC_KEY");
  const privada = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!assunto || !publica || !privada) {
    throw new Error("Defina VAPID_SUBJECT, VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY nos secrets das funções.");
  }
  webpush.setVapidDetails(assunto, publica, privada);
  configurado = true;
}

/** Envia para todas as assinaturas; as que o serviço push diz estarem expiradas (404/410) são removidas. */
export async function enviar(
  assinaturas: Assinatura[],
  payload: unknown,
  aoExpirar: (id: number) => Promise<void>,
): Promise<ResultadoEnvio> {
  configurar();
  const corpo = JSON.stringify(payload);
  const resultado: ResultadoEnvio = { destinatarios: assinaturas.length, enviadas: 0, removidas: 0, falhas: 0 };

  await Promise.all(assinaturas.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
        corpo,
        // TTL de 12h: um alerta de vencimento perde o sentido depois disso
        { TTL: 60 * 60 * 12, urgency: "high" },
      );
      resultado.enviadas += 1;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await aoExpirar(s.id);
        resultado.removidas += 1;
      } else {
        resultado.falhas += 1;
        console.error(`[push] falha ao enviar (assinatura ${s.id}):`, status ?? (err as Error).message);
      }
    }
  }));

  return resultado;
}
