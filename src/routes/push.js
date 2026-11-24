'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../../db');
const { autenticar } = require('../middleware/auth');
const { asyncHandler } = require('../async');
const { hashEndpoint, enviarParaUsuario } = require('../lib/push');
const { validarInscricao } = require('../lib/validacao-push');

const router = express.Router();

// GET /api/push/public-key  (pública: o navegador precisa dela para assinar)
router.get('/public-key', (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe   corpo: { subscription: <PushSubscription.toJSON()> }
router.post(
  '/subscribe',
  autenticar,
  asyncHandler(async (req, res) => {
    const insc = validarInscricao(req.body && req.body.subscription);
    if (!insc) return res.status(400).json({ erro: 'Inscrição push inválida.' });

    const userAgent = (req.get('user-agent') || '').slice(0, 255) || null;
    const hash = hashEndpoint(insc.endpoint);

    // Um endpoint já vinculado a outro usuário não pode ser transferido só porque
    // o atacante conhece a URL — isso cortaria as notificações da vítima.
    const [existentes] = await pool.execute(
      'SELECT usuario_id FROM push_subscriptions WHERE endpoint_hash = ? LIMIT 1',
      [hash]
    );
    if (existentes.length && Number(existentes[0].usuario_id) !== Number(req.usuario.id)) {
      return res.status(409).json({ erro: 'Esta inscrição já está vinculada a outro usuário.' });
    }

    await pool.execute(
      `INSERT INTO push_subscriptions (usuario_id, endpoint, endpoint_hash, p256dh, auth, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         p256dh     = VALUES(p256dh),
         auth       = VALUES(auth),
         user_agent = VALUES(user_agent)`,
      [req.usuario.id, insc.endpoint, hash, insc.p256dh, insc.auth, userAgent]
    );

    res.status(201).json({ ok: true });
  })
);

// POST /api/push/unsubscribe   corpo: { endpoint }
router.post(
  '/unsubscribe',
  autenticar,
  asyncHandler(async (req, res) => {
    const endpoint = req.body && req.body.endpoint;
    if (typeof endpoint !== 'string' || !endpoint) {
      return res.status(400).json({ erro: 'Informe o endpoint.' });
    }
    await pool.execute(
      'DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND usuario_id = ?',
      [hashEndpoint(endpoint), req.usuario.id]
    );
    res.status(204).end();
  })
);

// POST /api/push/test  -> notificação de teste para os aparelhos do usuário
const limitadorTeste = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Aguarde um minuto antes de testar de novo.' },
});

router.post(
  '/test',
  autenticar,
  limitadorTeste,
  asyncHandler(async (req, res) => {
    const r = await enviarParaUsuario(req.usuario.id, {
      title: 'Teste de notificação',
      body: 'Se você está vendo isto, o Web Push está funcionando.',
      tag: 'teste',
      url: '/',
      tipo: 'teste',
      contas: [],
    });

    if (r.destinatarios === 0) {
      return res.status(404).json({ erro: 'Nenhum dispositivo inscrito para notificações.' });
    }
    res.json(r);
  })
);

module.exports = router;
