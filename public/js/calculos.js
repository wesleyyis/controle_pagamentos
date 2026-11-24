// Regras de negócio da RN01, agora calculadas no navegador (o banco guarda só os dados).
import { diasEntre } from './datas.js';

/** Contas que vencem em até N dias (ou já vencidas) entram em "próximas". */
export const DIAS_ALERTA = 7;

/**
 * RN01 - Normalização de ciclos
 *  mensal : mensal = valor        | anual = valor x 12
 *  anual  : mensal = valor / 12   | anual = valor
 *  semanal: mensal = valor x 52/12 (~4,33) | anual = valor x 52
 */
export function valorMensal(valor, ciclo) {
  switch (ciclo) {
    case 'mensal': return valor;
    case 'anual': return valor / 12;
    case 'semanal': return (valor * 52) / 12;
    default: throw new Error(`Ciclo desconhecido: ${ciclo}`);
  }
}

export function valorAnual(valor, ciclo) {
  switch (ciclo) {
    case 'mensal': return valor * 12;
    case 'anual': return valor;
    case 'semanal': return valor * 52;
    default: throw new Error(`Ciclo desconhecido: ${ciclo}`);
  }
}

export const arredondar = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Soma sem arredondar cada item; arredonda só o total. */
export function totais(contas) {
  let mensal = 0;
  let anual = 0;
  for (const c of contas) {
    mensal += valorMensal(c.valor, c.ciclo);
    anual += valorAnual(c.valor, c.ciclo);
  }
  return { mensal: arredondar(mensal), anual: arredondar(anual) };
}

export function statusPorDias(dias) {
  if (dias < 0) return 'atrasada';
  if (dias === 0) return 'vence_hoje';
  if (dias <= DIAS_ALERTA) return 'proxima';
  return 'em_dia';
}

/** Linha do banco -> formato usado pela interface. */
export function serializarConta(linha, hoje) {
  const valor = Number(linha.valor);
  const dias = diasEntre(hoje, linha.proximo_vencimento);
  return {
    id: linha.id,
    nome: linha.nome,
    categoria: linha.categoria,
    valor,
    ciclo: linha.ciclo,
    proximo_vencimento: linha.proximo_vencimento,
    ativa: Boolean(linha.ativa),
    dias_para_vencer: dias,
    status: statusPorDias(dias),
    equivalente_mensal: arredondar(valorMensal(valor, linha.ciclo)),
  };
}

/** Cards do dashboard (RF03). Só contas ativas entram nos totais. */
export function montarResumo(contas, hoje) {
  const ativas = contas.filter((c) => c.ativa);
  const { mensal, anual } = totais(ativas);
  const proximas = ativas
    .filter((c) => c.status !== 'em_dia')
    .sort((a, b) => a.dias_para_vencer - b.dias_para_vencer || a.nome.localeCompare(b.nome, 'pt-BR'));

  return {
    hoje,
    gasto_fixo_mensal: mensal,
    projecao_anual: anual,
    compromissos_ativos: ativas.length,
    atrasadas: ativas.filter((c) => c.status === 'atrasada').length,
    vencem_hoje: ativas.filter((c) => c.status === 'vence_hoje').length,
    dias_alerta: DIAS_ALERTA,
    proximas,
  };
}
