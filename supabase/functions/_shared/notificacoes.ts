// Texto das notificações e utilidades de data. Sem dependências externas.

export type Tipo = "vespera" | "dia";
export type ContaAlerta = { id: number; nome: string; valor: number | string };
export type Reserva = {
  r_user_id: string;
  r_tipo: Tipo;
  r_conta_id: number;
  r_nome: string;
  r_valor: number | string;
  r_data_vencimento: string;
};
export type Grupo = { userId: string; tipo: Tipo; dataVencimento: string; contas: ContaAlerta[] };
export type Notificacao = {
  title: string;
  body: string;
  tag: string;
  url: string;
  tipo: Tipo | "teste";
  contas: number[];
};

const FUSO = "America/Sao_Paulo";
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const arredondar = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** "Hoje" no fuso de Brasília, como AAAA-MM-DD. */
export function hojeISO(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

function juntarNomes(nomes: string[], max = 3): string {
  if (nomes.length === 1) return nomes[0];
  if (nomes.length <= max) return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return `${nomes.slice(0, max).join(", ")} e mais ${nomes.length - max}`;
}

/** Várias contas do mesmo tipo viram UMA notificação (evita spam na tela de bloqueio). */
export function montarNotificacao(contas: ContaAlerta[], tipo: Tipo): Notificacao {
  const quando = tipo === "dia" ? "hoje" : "amanhã";
  const base = { tag: `vencimento-${tipo}`, url: "/", tipo, contas: contas.map((c) => c.id) };

  if (contas.length === 1) {
    const c = contas[0];
    return { ...base, title: `Conta vence ${quando}`, body: `${c.nome} — ${brl.format(Number(c.valor))}` };
  }

  const total = arredondar(contas.reduce((soma, c) => soma + Number(c.valor), 0));
  return {
    ...base,
    title: `${contas.length} contas vencem ${quando}`,
    body: `${juntarNomes(contas.map((c) => c.nome))} — total ${brl.format(total)}`,
  };
}

/** Agrupa as contas reservadas por usuário + tipo (1 notificação por grupo). */
export function agrupar(reservas: Reserva[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const r of reservas) {
    const chave = `${r.r_user_id}|${r.r_tipo}`;
    let g = grupos.get(chave);
    if (!g) {
      g = { userId: r.r_user_id, tipo: r.r_tipo, dataVencimento: r.r_data_vencimento, contas: [] };
      grupos.set(chave, g);
    }
    g.contas.push({ id: r.r_conta_id, nome: r.r_nome, valor: r.r_valor });
  }
  return [...grupos.values()];
}
