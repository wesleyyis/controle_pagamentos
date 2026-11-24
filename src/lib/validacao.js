'use strict';

const { dataValida } = require('./datas');

const CICLOS = ['mensal', 'anual', 'semanal'];
const VALOR_MAX = 99999999.99;

/** Aceita número (29.9) ou texto ("29,90" / "1.234,56" / "29.90"). */
function parseValor(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const t = v.trim();
  if (!t) return NaN;
  const normalizado = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return Number(normalizado);
}

/**
 * Valida o corpo de criação/edição de conta.
 * Retorna { dados } em caso de sucesso ou { detalhes } com erros por campo.
 */
function validarConta(body, { aceitaAtiva = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const detalhes = {};

  const nome = typeof b.nome === 'string' ? b.nome.trim() : '';
  if (nome.length < 1 || nome.length > 100) {
    detalhes.nome = 'Informe o nome (até 100 caracteres).';
  }

  const categoria = typeof b.categoria === 'string' ? b.categoria.trim() : '';
  if (categoria.length < 1 || categoria.length > 50) {
    detalhes.categoria = 'Informe a categoria (até 50 caracteres).';
  }

  const valorNum = parseValor(b.valor);
  if (!Number.isFinite(valorNum) || valorNum <= 0 || valorNum > VALOR_MAX) {
    detalhes.valor = 'Informe um valor maior que zero.';
  }

  if (!CICLOS.includes(b.ciclo)) {
    detalhes.ciclo = 'Ciclo deve ser mensal, anual ou semanal.';
  }

  if (!dataValida(b.proximo_vencimento)) {
    detalhes.proximo_vencimento = 'Informe uma data válida (AAAA-MM-DD).';
  }

  let ativa;
  if (aceitaAtiva && b.ativa !== undefined) {
    if (typeof b.ativa !== 'boolean') {
      detalhes.ativa = 'Deve ser verdadeiro ou falso.';
    } else {
      ativa = b.ativa;
    }
  }

  if (Object.keys(detalhes).length) return { detalhes };

  return {
    dados: {
      nome,
      categoria,
      valor: Math.round((valorNum + Number.EPSILON) * 100) / 100,
      ciclo: b.ciclo,
      proximo_vencimento: b.proximo_vencimento,
      ativa,
    },
  };
}

module.exports = { validarConta, parseValor, CICLOS };