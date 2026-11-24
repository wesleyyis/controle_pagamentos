// Edge Function "alertas": chamada todo dia pelo pg_cron (veja supabase/02_agendamento.sql).
// Autenticação: cabeçalho x-cron-secret igual ao secret CRON_SECRET.
import { executarAlertas } from "../_shared/alertas-core.ts";
import type { Assinatura } from "../_shared/alertas-core.ts";
import { hojeISO } from "../_shared/notificacoes.ts";
import type { Reserva } from "../_shared/notificacoes.ts";
import { restAdmin } from "../_shared/supabase.ts";
import { enviar } from "../_shared/push.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function responder(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);

  const segredo = Deno.env.get("CRON_SECRET") ?? "";
  const recebido = req.headers.get("x-cron-secret") ?? "";
  if (!segredo || !iguais(recebido, segredo)) return responder({ erro: "Não autorizado." }, 401);

  try {
    const hoje = hojeISO();
    const resumo = await executarAlertas({
      hoje,
      reservar: (h) => restAdmin<Reserva[]>("POST", "rpc/reservar_alertas", { p_hoje: h }),
      assinaturasDe: (ids) => {
        const seguros = ids.filter((id) => UUID.test(id));
        if (!seguros.length) return Promise.resolve([] as Assinatura[]);
        return restAdmin<Assinatura[]>(
          "GET",
          `push_subscriptions?select=id,user_id,endpoint,p256dh,auth_key&user_id=in.(${seguros.join(",")})`,
        );
      },
      liberar: async (contaIds, tipo, data) => {
        await restAdmin(
          "DELETE",
          `notificacoes_enviadas?conta_id=in.(${contaIds.map(Number).join(",")})&tipo=eq.${tipo}&data_vencimento=eq.${data}`,
        );
      },
      removerAssinatura: async (id) => {
        await restAdmin("DELETE", `push_subscriptions?id=eq.${Number(id)}`);
      },
      enviar,
    });
    console.log("[alertas]", hoje, JSON.stringify(resumo));
    return responder({ ok: true, hoje, ...resumo });
  } catch (err) {
    console.error("[alertas] falha:", err);
    return responder({ erro: "Falha ao executar os alertas. Veja os logs da função." }, 500);
  }
});
