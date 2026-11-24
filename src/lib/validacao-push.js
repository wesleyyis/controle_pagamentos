'use strict';

/**
 * Web Push só deve enviar para os serviços oficiais dos navegadores.
 * Aceitar qualquer URL HTTPS permitiria SSRF: o servidor faria POST para
 * um host arbitrário com o payload das notificações e os headers VAPID.
 */
const HOSTES_PERMITIDOS = [
  'fcm.googleapis.com',                    // Chrome/Edge/Android
  'updates.push.services.mozilla.com',     // Firefox
  'web.push.apple.com',                    // Safari
  'api.push.apple.com',                    // APNs
  'notify.windows.com',                    // WNS (subdomínos incluídos)
];

const CHAVE_BASE64URL = /^[A-Za-z0-9_-]{1,255}$/;

function hostPermitido(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return HOSTES_PERMITIDOS.some((permitido) => host === permitido || host.endsWith(`.${permitido}`));
}

function endpointPermitido(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > 2048) return false;
  if (!endpoint.startsWith('https://')) return false;

  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port) return false; // porta explícita (ex.: :8443) não é endpoint push válido
  return hostPermitido(url.hostname);
}

/** Retorna { endpoint, p256dh, auth } ou null quando a inscrição é inválida. */
function validarInscricao(s) {
  if (!s || typeof s !== 'object') return null;
  const { endpoint, keys } = s;
  if (!endpointPermitido(endpoint)) return null;
  if (!keys || typeof keys !== 'object') return null;
  if (!CHAVE_BASE64URL.test(keys.p256dh || '')) return null;
  if (!CHAVE_BASE64URL.test(keys.auth || '')) return null;
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

module.exports = { validarInscricao, endpointPermitido, hostPermitido, HOSTES_PERMITIDOS };
