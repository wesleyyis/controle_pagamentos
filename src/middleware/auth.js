'use strict';

const jwt = require('jsonwebtoken');

/**
 * Exige "Authorization: Bearer <token>".
 * Em caso de sucesso, popula req.usuario = { id, nome }.
 * Todas as consultas das rotas filtram por req.usuario.id (RF01: isolamento).
 */
function autenticar(req, res, next) {
  const [tipo, token] = (req.headers.authorization || '').split(' ');
  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ erro: 'Autenticação necessária.', codigo: 'TOKEN_AUSENTE' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.usuario = { id: Number(payload.sub), nome: payload.nome };
    return next();
  } catch (err) {
    const expirado = err.name === 'TokenExpiredError';
    return res.status(401).json({
      erro: expirado ? 'Sessão expirada. Entre novamente.' : 'Token inválido.',
      codigo: expirado ? 'TOKEN_EXPIRADO' : 'TOKEN_INVALIDO',
    });
  }
}

module.exports = { autenticar };
