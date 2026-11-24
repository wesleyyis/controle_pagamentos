'use strict';

const crypto = require('crypto');
const webpush = require('web-push');
const { pool } = require('../../db');

// Configura o VAPID aqui também, para que scripts avulsos (ex.: npm run alertas)
// funcionem sem passar pelo server.js. Chamar duas vezes é inofensivo.
if (process.env.VAPID_SUBJECT && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

function hashEndpoint(endpoint) {
  return crypto.createHash('sha256').update(endpoint).digest('hex');
}

/**
 * Envia um payload JSON para todos os dispositivos inscritos do usuário.
 * Inscrições que o serviço push informa como expiradas (404/410) são apagadas.
 * Retorna { destinatarios, enviadas, removidas, falhas }.
 */
async function enviarParaUsuario(usuarioId, payload) {
  const [inscricoes] = await pool.execute(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE usuario_id = ?',
    [usuarioId]
  );

  const resultado = { destinatarios: inscricoes.length, enviadas: 0, removidas: 0, falhas: 0 };
  const corpo = JSON.stringify(payload);

  await Promise.all(
    inscricoes.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          corpo,
          // TTL de 12h: um alerta de vencimento perde o sentido depois disso
          { TTL: 60 * 60 * 12, urgency: 'high' }
        );
        resultado.enviadas += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await pool.execute('DELETE FROM push_subscriptions WHERE id = ?', [s.id]);
          resultado.removidas += 1;
        } else {
          resultado.falhas += 1;
          console.error(`[push] Falha ao enviar (inscrição ${s.id}):`, err.statusCode || err.message);
        }
      }
    })
  );

  return resultado;
}

module.exports = { hashEndpoint, enviarParaUsuario };
