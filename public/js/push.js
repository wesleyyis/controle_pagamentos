// Web Push no navegador (inscrição VAPID). O envio em si é feito pelo servidor.
import { api } from './api.js';

export function suportado() {
  return (
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** No iPhone/iPad, push só funciona com o app instalado na Tela de Início (iOS 16.4+). */
export function iosSemInstalar() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalado = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return ios && !instalado;
}

function chaveParaBytes(base64Url) {
  const preenchimento = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + preenchimento).replace(/-/g, '+').replace(/_/g, '/');
  const bruto = atob(base64);
  return Uint8Array.from(bruto, (c) => c.charCodeAt(0));
}

function mesmaChave(inscricao, bytes) {
  const atual = inscricao.options && inscricao.options.applicationServerKey;
  if (!atual) return true; // não dá para comparar: assume igual
  const a = new Uint8Array(atual);
  return a.length === bytes.length && a.every((v, i) => v === bytes[i]);
}

async function inscricaoAtual() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** { suportado, permissao: 'default'|'granted'|'denied', inscrito } */
export async function estado() {
  if (!suportado()) return { suportado: false, permissao: 'default', inscrito: false };
  const sub = await inscricaoAtual();
  return { suportado: true, permissao: Notification.permission, inscrito: Boolean(sub) };
}

/** Pede permissão (precisa vir de um clique), assina no navegador e registra no servidor. */
export async function ativar() {
  if (!suportado()) throw new Error('Este navegador não suporta notificações push.');

  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') throw new Error('Permissão de notificação não concedida.');

  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.chavePublica();
  const bytes = chaveParaBytes(publicKey);

  let sub = await reg.pushManager.getSubscription();
  // Se as chaves VAPID do servidor mudaram, a inscrição antiga deixa de valer
  if (sub && !mesmaChave(sub, bytes)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  }

  await api.inscrever(sub.toJSON());
}

export async function desativar() {
  const sub = await inscricaoAtual();
  if (!sub) return;
  await api.desinscrever(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}

/** Ao entrar no app: garante que este aparelho está vinculado ao usuário logado. */
export async function sincronizar() {
  if (!suportado() || Notification.permission !== 'granted') return;

  const { publicKey } = await api.chavePublica();
  const bytes = chaveParaBytes(publicKey);
  let sub = await inscricaoAtual();

  // Se as chaves VAPID mudaram, a inscrição antiga não serve mais.
  if (sub && !mesmaChave(sub, bytes)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) {
    const reg = await navigator.serviceWorker.ready;
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  }

  await api.inscrever(sub.toJSON());
}

/** Ao sair: o servidor para de avisar este aparelho (a inscrição local é mantida). */
export async function desvincularServidor() {
  if (!suportado()) return;
  const sub = await inscricaoAtual();
  if (sub) await api.desinscrever(sub.endpoint);
}
