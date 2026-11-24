'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../../db');
const { autenticar } = require('../middleware/auth');
const { asyncHandler } = require('../async'); // Ajustado para a pasta src/

const router = express.Router();

const BCRYPT_ROUNDS = 12;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Hash descartável: usado quando o e-mail não existe, para o login levar o
// mesmo tempo nos dois casos (dificulta descobrir e-mails cadastrados).
const HASH_FALSO = bcrypt.hashSync('hash-falso-tempo-constante', BCRYPT_ROUNDS);

function gerarToken(usuario) {
  return jwt.sign({ nome: usuario.nome }, process.env.JWT_SECRET, {
    subject: String(usuario.id),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    algorithm: 'HS256',
  });
}

// POST /api/auth/register
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { nome, email, senha } = req.body || {};
    const detalhes = {};

    const nomeLimpo = typeof nome === 'string' ? nome.trim() : '';
    if (nomeLimpo.length < 2 || nomeLimpo.length > 100) {
      detalhes.nome = 'Informe seu nome (2 a 100 caracteres).';
    }

    const emailLimpo = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!RE_EMAIL.test(emailLimpo) || emailLimpo.length > 150) {
      detalhes.email = 'Informe um e-mail válido.';
    }

    // bcrypt só considera os primeiros 72 bytes da senha
    if (typeof senha !== 'string' || senha.length < 8 || Buffer.byteLength(senha) > 72) {
      detalhes.senha = 'A senha deve ter de 8 a 72 caracteres.';
    }

    if (Object.keys(detalhes).length) {
      return res.status(400).json({ erro: 'Dados inválidos.', detalhes });
    }

    const senhaHash = await bcrypt.hash(senha, BCRYPT_ROUNDS);

    let resultado;
    try {
      [resultado] = await pool.execute(
        'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
        [nomeLimpo, emailLimpo, senhaHash]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
      }
      throw err;
    }

    const usuario = { id: resultado.insertId, nome: nomeLimpo, email: emailLimpo };
    return res.status(201).json({ token: gerarToken(usuario), usuario });
  })
);

// POST /api/auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, senha } = req.body || {};

    if (typeof email !== 'string' || typeof senha !== 'string' || !email || !senha) {
      return res.status(400).json({ erro: 'Informe e-mail e senha.' });
    }

    const [linhas] = await pool.execute(
      'SELECT id, nome, email, senha_hash FROM usuarios WHERE email = ?',
      [email.trim().toLowerCase()]
    );
    const registro = linhas[0];

    const senhaOk = await bcrypt.compare(senha, registro ? registro.senha_hash : HASH_FALSO);
    if (!registro || !senhaOk) {
      return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
    }

    const usuario = { id: registro.id, nome: registro.nome, email: registro.email };
    return res.json({ token: gerarToken(usuario), usuario });
  })
);

// GET /api/auth/me  (valida o token guardado no navegador)
router.get(
  '/me',
  autenticar,
  asyncHandler(async (req, res) => {
    const [linhas] = await pool.execute(
      'SELECT id, nome, email FROM usuarios WHERE id = ?',
      [req.usuario.id]
    );
    if (!linhas.length) {
      return res.status(401).json({ erro: 'Usuário não encontrado.', codigo: 'TOKEN_INVALIDO' });
    }
    return res.json({ usuario: linhas[0] });
  })
);

module.exports = router;