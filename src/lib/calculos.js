'use strict';

const { diasEntre } = require('./datas');

/** Contas que vencem em até N dias (ou já vencidas) entram em "próximas". */
const DIAS_ALERTA = 7;

/**
 * RN01 - Normalização de ciclos.
 *  mensal : mensal = valor        | anual = valor x 12
 *  anual  : mensal = valor / 12   | anual = valor
 *  semanal: mensal = valor x 52/12 (~4,33) | anual = valor x 52
 * Usar 52/12 no mensal mantém a conta fechada: mensal x 12 == anual.
 */
function valorMensal(valor, ciclo) {
  switch (ciclo) {
    case 'mensal':
      return valor;
    case 'anual':
      return valor / 12;
    case 'semanal':
      return (valor * 52) / 12;
    default:
      throw new Error(`Ciclo desconhecido: ${ciclo}`);
  }
}

function valorAnual(valor, ciclo) {
  switch (ciclo) {
    case 'mensal':
      return valor * 12;
    case 'anual':
      return valor;
    case 'semanal':
      return valor * 52;
    default:
      throw new Error(`Ciclo desconhecido: ${ciclo}`);
  }
}

function arredondar(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Soma sem arredondar cada item; arredonda só o total (evita erro acumulado). */
function totais(contas) {
  let mensal = 0;
  let anual = 0;
  for (const c of contas) {
    mensal += valorMensal(c.valor, c.ciclo);
    anual += valorAnual(c.valor, c.ciclo);
  }
  return { mensal: arredondar(mensal), anual: arredondar(anual) };
}

function statusPorDias(dias) {
  if (dias < 0) return 'atrasada';
  if (dias === 0) return 'vence_hoje';
  if (dias <= DIAS_ALERTA) return 'proxima';
  return 'em_dia';
}

/** Converte a linha do MySQL (DECIMAL vem como string) no formato da API. */
function serializarConta(linha, hoje) {
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

module.exports = {
  DIAS_ALERTA,
  valorMensal,
  valorAnual,
  arredondar,
  totais,
  statusPorDias,
  serializarConta,
};