'use strict';

const { arredondar } = require('./calculos');

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function juntarNomes(nomes, max = 3) {
  if (nomes.length === 1) return nomes[0];
  if (nomes.length <= max) return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
  return `${nomes.slice(0, max).join(', ')} e mais ${nomes.length - max}`;
}

/**
 * Monta o payload da notificação de um usuário.
 * tipo: 'vespera' (vence amanhã) ou 'dia' (vence hoje).
 * Várias contas do mesmo tipo viram UMA notificação (evita spam na tela de bloqueio).
 */
function montarNotificacao(contas, tipo) {
  const quando = tipo === 'dia' ? 'hoje' : 'amanhã';
  const ids = contas.map((c) => c.id);
  const base = { tag: `vencimento-${tipo}`, url: '/', tipo, contas: ids };

  if (contas.length === 1) {
    const c = contas[0];
    return {
      ...base,
      title: `Conta vence ${quando}`,
      body: `${c.nome} — ${brl.format(Number(c.valor))}`,
    };
  }

  const total = arredondar(contas.reduce((soma, c) => soma + Number(c.valor), 0));
  return {
    ...base,
    title: `${contas.length} contas vencem ${quando}`,
    body: `${juntarNomes(contas.map((c) => c.nome))} — total ${brl.format(total)}`,
  };
}

module.exports = { montarNotificacao };
