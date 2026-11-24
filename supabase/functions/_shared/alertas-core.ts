// Regra dos alertas (RN02), separada do runtime para poder ser testada.
import { agrupar, montarNotificacao } from "./notificacoes.ts";
import type { Notificacao, Reserva, Tipo } from "./notificacoes.ts";

export type Assinatura = { id: number; user_id: string; endpoint: string; p256dh: string; auth_key: string };
export type ResultadoEnvio = { destinatarios: number; enviadas: number; removidas: number; falhas: number };

export type Dependencias = {
  hoje: string;
  reservar: (hoje: string) => Promise<Reserva[]>;
  assinaturasDe: (userIds: string[]) => Promise<Assinatura[]>;
  liberar: (contaIds: number[], tipo: Tipo, dataVencimento: string) => Promise<void>;
  removerAssinatura: (id: number) => Promise<void>;
  enviar: (
    assinaturas: Assinatura[],
    payload: Notificacao,
    aoExpirar: (id: number) => Promise<void>,
  ) => Promise<ResultadoEnvio>;
};

export type Resumo = { contas_reservadas: number; notificacoes: number; dispositivos: number; liberadas: number };

/**
 * 1) reserva as contas que vencem hoje/amanhã (as já avisadas são ignoradas);
 * 2) envia 1 notificação por usuário e tipo para todos os aparelhos dele;
 * 3) se NADA foi entregue (sem aparelho inscrito ou falha), libera a reserva
 *    para a próxima execução tentar de novo.
 */
export async function executarAlertas(d: Dependencias): Promise<Resumo> {
  const resumo: Resumo = { contas_reservadas: 0, notificacoes: 0, dispositivos: 0, liberadas: 0 };

  const reservas = await d.reservar(d.hoje);
  resumo.contas_reservadas = reservas.length;
  if (!reservas.length) return resumo;

  const userIds = [...new Set(reservas.map((r) => r.r_user_id))];
  const todas = await d.assinaturasDe(userIds);
  const porUsuario = new Map<string, Assinatura[]>();
  for (const a of todas) {
    porUsuario.set(a.user_id, [...(porUsuario.get(a.user_id) ?? []), a]);
  }

  for (const grupo of agrupar(reservas)) {
    const assinaturas = porUsuario.get(grupo.userId) ?? [];
    let enviadas = 0;

    if (assinaturas.length) {
      try {
        const r = await d.enviar(assinaturas, montarNotificacao(grupo.contas, grupo.tipo), d.removerAssinatura);
        enviadas = r.enviadas;
      } catch (err) {
        console.error(`[alertas] erro ao notificar o usuário ${grupo.userId}:`, err);
      }
    }

    if (enviadas > 0) {
      resumo.notificacoes += 1;
      resumo.dispositivos += enviadas;
    } else {
      await d.liberar(grupo.contas.map((c) => c.id), grupo.tipo, grupo.dataVencimento);
      resumo.liberadas += grupo.contas.length;
    }
  }

  return resumo;
}
