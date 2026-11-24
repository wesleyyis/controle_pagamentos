'use strict';

/**
 * Service Worker do Controle de Pagamentos (versão canônica).
 *  1) Cache do "casco" do app (HTML, JS, CSS, ícones, Tailwind) -> abre offline.
 *  2) Web Push: mostra a notificação na tela de bloqueio mesmo com o app fechado.
 *
 * IMPORTANTE: ao alterar qualquer arquivo de public/, aumente VERSAO para que os
 * aparelhos já instalados descartem o cache antigo.
 */
const VERSAO = 'v4';
const CACHE = `cp-casco-${VERSAO}`;

const CASCO = [
  '/',
  '/css/tailwind.css',
  '/css/app.css',
  '/js/app.js',
  '/js/api.js',
  '/js/format.js',
  '/js/config.js',
  '/js/datas.js',
  '/js/calculos.js',
  '/js/validacao.js',
  '/js/push.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/badge-72.png',
];

// ---------------------------------------------------------------- instalação
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(CASCO);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(
        nomes.filter((n) => n.startsWith('cp-casco-') && n !== CACHE).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

// Grava no cache e só retorna quando a gravação terminou (evita cache intermitente).
async function guardar(cache, chave, resposta) {
  if (resposta && resposta.ok) {
    await cache.put(chave, resposta.clone());
  }
  return resposta;
}

// ---------------------------------------------------------------- cache
// Navegação: rede primeiro, para o deploy novo aparecer já na primeira visita.
async function navegacao(event) {
  const cache = await caches.open(CACHE);
  try {
    const resposta = await fetch(event.request);
    if (resposta.ok) await guardar(cache, '/', resposta);
    return resposta;
  } catch {
    return (
      (await cache.match('/')) ||
      new Response('Sem conexão.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

// Assets do próprio site: cache primeiro, atualização em segundo plano.
async function guardadoEAtualiza(event) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(event.request);

  const rede = (async () => {
    try {
      const resposta = await fetch(event.request);
      await guardar(cache, event.request, resposta);
      return resposta;
    } catch {
      return guardado || Response.error();
    }
  })();

  if (guardado) {
    event.waitUntil(rede);
    return guardado;
  }
  return rede;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return; // sempre rede
    if (req.mode === 'navigate') {
      event.respondWith(navegacao(event));
      return;
    }
    event.respondWith(guardadoEAtualiza(event));
    return;
  }
});

// ---------------------------------------------------------------- push
self.addEventListener('push', (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { body: event.data ? event.data.text() : '' };
  }

  const titulo = dados.title || 'Controle de Pagamentos';
  const opcoes = {
    body: dados.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: dados.tag || 'vencimento',
    renotify: true, // vibra/toca de novo se a tag já estava na tela
    lang: 'pt-BR',
    vibrate: [200, 100, 200],
    timestamp: Date.now(),
    data: { url: dados.url || '/' },
  };

  // Todo push precisa exibir uma notificação (exigência do userVisibleOnly).
  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Nunca abre origem externa, mesmo que o payload do push seja alterado.
  let alvo = '/';
  try {
    const informado = (event.notification.data && event.notification.data.url) || '/';
    const url = new URL(informado, self.location.origin);
    if (url.origin === self.location.origin) alvo = url.pathname + url.search + url.hash;
  } catch {
    // mantém '/'
  }

  event.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const janela of janelas) {
        if (new URL(janela.url).origin === self.location.origin && 'focus' in janela) {
          await janela.focus();
          janela.postMessage({ tipo: 'atualizar' }); // o app recarrega as contas
          return;
        }
      }
      await self.clients.openWindow(alvo);
    })()
  );
});
