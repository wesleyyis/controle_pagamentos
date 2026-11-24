'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hojeISO,
  dataValida,
  diasEntre,
  avancarVencimento,
} = require('./src/lib/datas');
const { totais, statusPorDias, serializarConta, valorMensal } = require('./src/lib/calculos');
const { validarConta, parseValor } = require('./src/lib/validacao');

test('hojeISO respeita o fuso de São Paulo', () => {
  // 02:00 UTC ainda é o dia anterior em Brasília (UTC-3)
  assert.equal(hojeISO(new Date('2026-11-18T02:00:00Z')), '2026-11-17');
  assert.equal(hojeISO(new Date('2026-11-18T12:00:00Z')), '2026-11-18');
});

test('dataValida', () => {
  assert.ok(dataValida('2026-11-18'));
  assert.ok(dataValida('2028-02-29'));
  assert.ok(!dataValida('2027-02-29'));
  assert.ok(!dataValida('2026-13-01'));
  assert.ok(!dataValida('18/11/2026'));
  assert.ok(!dataValida(null));
});

test('diasEntre', () => {
  assert.equal(diasEntre('2026-11-18', '2026-11-19'), 1);
  assert.equal(diasEntre('2026-11-18', '2026-11-18'), 0);
  assert.equal(diasEntre('2026-11-18', '2026-11-10'), -8);
  assert.equal(diasEntre('2026-12-31', '2027-01-01'), 1);
});

test('avancarVencimento mensal: vira o ano', () => {
  assert.equal(avancarVencimento('2026-12-15', 'mensal', 15), '2027-01-15');
});

test('avancarVencimento mensal: dia 31 não deriva depois de fevereiro', () => {
  const fev = avancarVencimento('2026-01-31', 'mensal', 31);
  assert.equal(fev, '2026-02-28');
  assert.equal(avancarVencimento(fev, 'mensal', 31), '2026-03-31');
  assert.equal(avancarVencimento('2026-03-31', 'mensal', 31), '2026-04-30');
});

test('avancarVencimento semanal', () => {
  assert.equal(avancarVencimento('2026-12-28', 'semanal', 28), '2027-01-04');
});

test('avancarVencimento anual: 29/fev em anos bissextos e não bissextos', () => {
  assert.equal(avancarVencimento('2028-02-29', 'anual', 29), '2029-02-28');
  assert.equal(avancarVencimento('2031-02-28', 'anual', 29), '2032-02-29');
  assert.equal(avancarVencimento('2026-11-18', 'anual', 18), '2027-11-18');
});

test('RN01: totais mensal e anual', () => {
  const contas = [
    { valor: 100, ciclo: 'mensal' }, // 100 / 1200
    { valor: 1200, ciclo: 'anual' }, // 100 / 1200
    { valor: 50, ciclo: 'semanal' }, // 216,67 / 2600
  ];
  const t = totais(contas);
  assert.equal(t.mensal, 416.67);
  assert.equal(t.anual, 5000);
});

test('RN01: semanal x 52/12 fecha com o anual (x 52)', () => {
  assert.ok(Math.abs(valorMensal(50, 'semanal') * 12 - 50 * 52) < 1e-9);
});

test('statusPorDias', () => {
  assert.equal(statusPorDias(-1), 'atrasada');
  assert.equal(statusPorDias(0), 'vence_hoje');
  assert.equal(statusPorDias(1), 'proxima');
  assert.equal(statusPorDias(7), 'proxima');
  assert.equal(statusPorDias(8), 'em_dia');
});

test('serializarConta converte DECIMAL (string) em número', () => {
  const c = serializarConta(
    { id: 1, nome: 'Netflix', categoria: 'Lazer', valor: '39.90', ciclo: 'mensal',
      proximo_vencimento: '2026-11-19', ativa: 1 },
    '2026-11-18'
  );
  assert.equal(c.valor, 39.9);
  assert.equal(c.dias_para_vencer, 1);
  assert.equal(c.status, 'proxima');
  assert.equal(c.ativa, true);
});

test('parseValor aceita formatos brasileiro e numérico', () => {
  assert.equal(parseValor('29,90'), 29.9);
  assert.equal(parseValor('1.234,56'), 1234.56);
  assert.equal(parseValor('29.90'), 29.9);
  assert.equal(parseValor(15), 15);
  assert.ok(Number.isNaN(parseValor('abc')));
});

test('validarConta: sucesso e erros por campo', () => {
  const ok = validarConta({
    nome: ' Aluguel ', categoria: 'Casa', valor: '1.500,00',
    ciclo: 'mensal', proximo_vencimento: '2026-12-05',
  });
  assert.equal(ok.dados.nome, 'Aluguel');
  assert.equal(ok.dados.valor, 1500);

  const ruim = validarConta({ nome: '', categoria: '', valor: -5, ciclo: 'diario', proximo_vencimento: '2026-02-30' });
  assert.deepEqual(
    Object.keys(ruim.detalhes).sort(),
    ['categoria', 'ciclo', 'nome', 'proximo_vencimento', 'valor']
  );
});

const { montarNotificacao } = require('./src/lib/notificacoes');
const limpar = (s) => s.replace(/\u00a0/g, ' ');

test('montarNotificacao: uma conta, vence hoje', () => {
  const n = montarNotificacao([{ id: 7, nome: 'Netflix', valor: '39.90' }], 'dia');
  assert.equal(n.title, 'Conta vence hoje');
  assert.equal(limpar(n.body), 'Netflix — R$ 39,90');
  assert.equal(n.tag, 'vencimento-dia');
  assert.deepEqual(n.contas, [7]);
});

test('montarNotificacao: várias contas, vence amanhã, com total', () => {
  const n = montarNotificacao(
    [
      { id: 1, nome: 'Aluguel', valor: '1500.00' },
      { id: 2, nome: 'Luz', valor: '120.50' },
    ],
    'vespera'
  );
  assert.equal(n.title, '2 contas vencem amanhã');
  assert.equal(limpar(n.body), 'Aluguel e Luz — total R$ 1.620,50');
  assert.equal(n.tag, 'vencimento-vespera');
});

test('montarNotificacao: resume nomes quando são muitas contas', () => {
  const contas = ['A', 'B', 'C', 'D', 'E'].map((nome, i) => ({ id: i, nome, valor: 10 }));
  const n = montarNotificacao(contas, 'dia');
  assert.equal(n.title, '5 contas vencem hoje');
  assert.equal(limpar(n.body), 'A, B, C e mais 2 — total R$ 50,00');
});