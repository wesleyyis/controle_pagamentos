// Funções de formatação e apresentação (sem acesso ao DOM)

const formatadorBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const brl = (n) => formatadorBRL.format(Number(n) || 0);

/** Escapa texto digitado pelo usuário antes de colocar em innerHTML. */
export function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** 'AAAA-MM-DD' -> 'DD/MM/AAAA' (sem usar Date, para não sofrer com fuso). */
export function dataBR(iso) {
  const [a, m, d] = String(iso).split('-');
  return `${d}/${m}/${a}`;
}

export const ROTULO_CICLO = { mensal: 'Mensal', anual: 'Anual', semanal: 'Semanal' };

export function rotuloDias(conta) {
  const d = conta.dias_para_vencer;
  if (d < -1) return `Venceu há ${-d} dias`;
  if (d === -1) return 'Venceu ontem';
  if (d === 0) return 'Vence hoje';
  if (d === 1) return 'Vence amanhã';
  return `Vence em ${d} dias`;
}

const CLASSE_CHIP = {
  atrasada: 'border-red-900 bg-red-950 text-red-300',
  vence_hoje: 'border-amber-900 bg-amber-950 text-amber-300',
  proxima: 'border-yellow-900 bg-yellow-950 text-yellow-300',
  em_dia: 'border-zinc-800 bg-zinc-900 text-zinc-400',
  pausada: 'border-zinc-800 bg-zinc-900 text-zinc-500',
};

export function chipStatus(conta) {
  const chave = conta.ativa ? conta.status : 'pausada';
  const texto = conta.ativa ? rotuloDias(conta) : 'Pausada';
  return `<span class="inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${CLASSE_CHIP[chave]}">${esc(texto)}</span>`;
}

/** Para contas anuais/semanais: quanto isso pesa por mês. */
export function textoEquivalente(conta) {
  if (conta.ciclo === 'mensal') return '';
  return `≈ ${brl(conta.equivalente_mensal)}/mês`;
}
