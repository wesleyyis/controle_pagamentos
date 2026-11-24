'use strict';

const express = require('express');
const { pool } = require('../../db');
const { autenticar } = require('../middleware/auth');
const { asyncHandler } = require('../async');
const { validarConta } = require('../lib/validacao');
const { hojeISO, diaDoMes, avancarVencimento } = require('../lib/datas');
const { DIAS_ALERTA, totais, serializarConta } = require('../lib/calculos');

const router = express.Router();
router.use(autenticar);

const COLUNAS = 'id, nome, categoria, valor, ciclo, proximo_vencimento, dia_ancora, ativa';

function lerId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ erro: 'ID inválido.' });
    return null;
  }
  return id;
}

async function buscarConta(id, usuarioId) {
  const [linhas] = await pool.execute(
    `SELECT ${COLUNAS} FROM contas WHERE id = ? AND usuario_id = ?`,
    [id, usuarioId]
  );
  return linhas[0] || null;
}

// GET /api/contas/resumo  -> cards do dashboard (RF03)
// (declarada antes de "/:id" para não ser interpretada como um ID)
router.get(
  '/resumo',
  asyncHandler(async (req, res) => {
    const hoje = hojeISO();
    const [linhas] = await pool.execute(
      `SELECT ${COLUNAS} FROM contas
        WHERE usuario_id = ? AND ativa = 1
        ORDER BY proximo_vencimento ASC, nome ASC`,
      [req.usuario.id]
    );

    const contas = linhas.map((l) => serializarConta(l, hoje));
    const { mensal, anual } = totais(contas);
    const alertas = contas.filter((c) => c.status !== 'em_dia');

    res.json({
      hoje,
      gasto_fixo_mensal: mensal,
      projecao_anual: anual,
      compromissos_ativos: contas.length,
      atrasadas: contas.filter((c) => c.status === 'atrasada').length,
      vencem_hoje: contas.filter((c) => c.status === 'vence_hoje').length,
      dias_alerta: DIAS_ALERTA,
      proximas: alertas,
    });
  })
);

// GET /api/contas
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const hoje = hojeISO();
    const [linhas] = await pool.execute(
      `SELECT ${COLUNAS} FROM contas
        WHERE usuario_id = ?
        ORDER BY ativa DESC, proximo_vencimento ASC, nome ASC`,
      [req.usuario.id]
    );
    res.json({ contas: linhas.map((l) => serializarConta(l, hoje)) });
  })
);

// GET /api/contas/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = lerId(req, res);
    if (id === null) return;
    const conta = await buscarConta(id, req.usuario.id);
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada.' });
    res.json({ conta: serializarConta(conta, hojeISO()) });
  })
);

// POST /api/contas
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { dados, detalhes } = validarConta(req.body);
    if (detalhes) return res.status(400).json({ erro: 'Dados inválidos.', detalhes });

    const [r] = await pool.execute(
      `INSERT INTO contas
         (usuario_id, nome, categoria, valor, ciclo, proximo_vencimento, dia_ancora)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.usuario.id,
        dados.nome,
        dados.categoria,
        dados.valor,
        dados.ciclo,
        dados.proximo_vencimento,
        diaDoMes(dados.proximo_vencimento),
      ]
    );

    const conta = await buscarConta(r.insertId, req.usuario.id);
    res.status(201).json({ conta: serializarConta(conta, hojeISO()) });
  })
);

// PUT /api/contas/:id
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = lerId(req, res);
    if (id === null) return;

    const { dados, detalhes } = validarConta(req.body, { aceitaAtiva: true });
    if (detalhes) return res.status(400).json({ erro: 'Dados inválidos.', detalhes });

    const atual = await buscarConta(id, req.usuario.id);
    if (!atual) return res.status(404).json({ erro: 'Conta não encontrada.' });

    // Só re-ancora o dia se o usuário realmente mudou a data de vencimento
    const diaAncora =
      dados.proximo_vencimento !== atual.proximo_vencimento
        ? diaDoMes(dados.proximo_vencimento)
        : atual.dia_ancora;
    const ativa = dados.ativa === undefined ? atual.ativa : dados.ativa ? 1 : 0;

    await pool.execute(
      `UPDATE contas
          SET nome = ?, categoria = ?, valor = ?, ciclo = ?,
              proximo_vencimento = ?, dia_ancora = ?, ativa = ?
        WHERE id = ? AND usuario_id = ?`,
      [
        dados.nome,
        dados.categoria,
        dados.valor,
        dados.ciclo,
        dados.proximo_vencimento,
        diaAncora,
        ativa,
        id,
        req.usuario.id,
      ]
    );

    const conta = await buscarConta(id, req.usuario.id);
    res.json({ conta: serializarConta(conta, hojeISO()) });
  })
);

// DELETE /api/contas/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = lerId(req, res);
    if (id === null) return;

    const conta = await buscarConta(id, req.usuario.id);
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada.' });

    await pool.execute('DELETE FROM contas WHERE id = ? AND usuario_id = ?', [
      id,
      req.usuario.id,
    ]);
    res.status(204).end();
  })
);

// POST /api/contas/:id/pagar  -> "Marcar como Pago"
// Corpo opcional: { "vencimento_atual": "AAAA-MM-DD" }. Se enviado e diferente
// do vencimento salvo, responde 409 (evita pagar duas vezes por duplo clique
// ou por uma tela desatualizada).
router.post(
  '/:id/pagar',
  asyncHandler(async (req, res) => {
    const id = lerId(req, res);
    if (id === null) return;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [linhas] = await conn.execute(
        `SELECT ${COLUNAS} FROM contas WHERE id = ? AND usuario_id = ? FOR UPDATE`,
        [id, req.usuario.id]
      );
      const conta = linhas[0];

      if (!conta) {
        await conn.rollback();
        return res.status(404).json({ erro: 'Conta não encontrada.' });
      }
      if (!conta.ativa) {
        await conn.rollback();
        return res.status(409).json({ erro: 'Conta pausada. Reative-a antes de dar baixa.' });
      }

      const esperado = req.body && req.body.vencimento_atual;
      if (esperado && esperado !== conta.proximo_vencimento) {
        await conn.rollback();
        return res.status(409).json({
          erro: 'Esta conta já foi atualizada. Recarregue a lista.',
          proximo_vencimento: conta.proximo_vencimento,
        });
      }

      await conn.execute(
        `INSERT INTO pagamentos (conta_id, usuario_id, valor_pago, data_vencimento)
         VALUES (?, ?, ?, ?)`,
        [conta.id, req.usuario.id, conta.valor, conta.proximo_vencimento]
      );

      const quitado = conta.proximo_vencimento;
      const novoVencimento = avancarVencimento(quitado, conta.ciclo, conta.dia_ancora);

      await conn.execute('UPDATE contas SET proximo_vencimento = ? WHERE id = ?', [
        novoVencimento,
        conta.id,
      ]);

      await conn.commit();

      conta.proximo_vencimento = novoVencimento;
      return res.json({
        conta: serializarConta(conta, hojeISO()),
        pagamento: { valor_pago: Number(conta.valor), vencimento_quitado: quitado },
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

// GET /api/contas/:id/pagamentos  -> histórico de baixas (últimas 24)
router.get(
  '/:id/pagamentos',
  asyncHandler(async (req, res) => {
    const id = lerId(req, res);
    if (id === null) return;

    const conta = await buscarConta(id, req.usuario.id);
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada.' });

    const [linhas] = await pool.execute(
      `SELECT id, valor_pago, data_vencimento, pago_em
         FROM pagamentos
        WHERE conta_id = ? AND usuario_id = ?
        ORDER BY pago_em DESC, id DESC
        LIMIT 24`,
      [id, req.usuario.id]
    );
    res.json({
      pagamentos: linhas.map((p) => ({ ...p, valor_pago: Number(p.valor_pago) })),
    });
  })
);

module.exports = router;