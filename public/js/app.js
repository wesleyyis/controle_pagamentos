import { api, sessao } from './api.js';
import { brl, dataBR, esc, ROTULO_CICLO, chipStatus, rotuloDias, textoEquivalente } from './format.js';
import * as push from './push.js';

const $ = (id) => document.getElementById(id);
const CACHE_KEY = 'cp_cache';

const estado = { resumo: null, contas: [], carregado: false };

// ======================================================================
// Utilidades de interface
// ======================================================================
function toast(mensagem, tipo = 'ok') {
  const el = document.createElement('div');
  el.className =
    'pointer-events-auto max-w-sm rounded-xl border px-4 py-2.5 text-sm shadow-lg ' +
    (tipo === 'erro'
      ? 'border-red-900 bg-red-950 text-red-200'
      : 'border-green-900 bg-green-950 text-green-200');
  el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  el.textContent = mensagem;
  $('toast-area').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function hojeLocal() {
  return new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD no fuso do aparelho
}

function confirmar({ titulo, texto, rotulo, perigo = false }) {
  const dlg = $('dlg-confirmar');
  $('confirmar-titulo').textContent = titulo;
  $('confirmar-texto').textContent = texto;
  const ok = $('confirmar-ok');
  ok.textContent = rotulo;
  ok.className =
    'rounded-lg px-4 py-2.5 text-sm font-medium text-white ' +
    (perigo ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500');
  dlg.returnValue = '';
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
  });
}

// ======================================================================
// Sessão e telas
// ======================================================================
function mostrarAuth() {
  $('view-app').classList.add('hidden');
  const auth = $('view-auth');
  auth.classList.remove('hidden');
  auth.classList.add('flex');
}

function mostrarApp() {
  const auth = $('view-auth');
  auth.classList.add('hidden');
  auth.classList.remove('flex');
  $('view-app').classList.remove('hidden');
  const u = sessao.usuario();
  $('usuario-nome').textContent = u ? u.nome : '';
}

function trocarAba(aba) {
  const login = aba === 'login';
  $('form-login').classList.toggle('hidden', !login);
  $('form-cadastro').classList.toggle('hidden', login);
  const ativa = 'rounded-md bg-green-600 py-2 font-medium text-white';
  const inativa = 'rounded-md py-2 font-medium text-zinc-400';
  $('aba-login').className = login ? ativa : inativa;
  $('aba-cadastro').className = login ? inativa : ativa;
  $('auth-erro').classList.add('hidden');
}

async function enviarAuth(e, modo) {
  e.preventDefault();
  const form = e.currentTarget;
  const botao = form.querySelector('button[type="submit"]');
  const erro = $('auth-erro');
  erro.classList.add('hidden');

  const dados = Object.fromEntries(new FormData(form));
  const rotulo = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'Aguarde…';

  try {
    const resposta =
      modo === 'login'
        ? await api.login(dados.email, dados.senha)
        : await api.registrar(dados.nome, dados.email, dados.senha);
    sessao.salvar(resposta);
    form.reset();
    await entrar();
  } catch (err) {
    const primeiroDetalhe = err.detalhes ? Object.values(err.detalhes)[0] : null;
    erro.textContent = primeiroDetalhe || err.message;
    erro.classList.remove('hidden');
  } finally {
    botao.disabled = false;
    botao.textContent = rotulo;
  }
}

async function entrar() {
  estado.resumo = null;
  estado.contas = [];
  estado.carregado = false;
  lerCache();
  mostrarApp();
  render();
  atualizarSino();
  await carregarDados();
  push.sincronizar().then(atualizarSino).catch(() => {});
}

function limparSessaoLocal() {
  sessao.limpar();
  localStorage.removeItem(CACHE_KEY);
  estado.resumo = null;
  estado.contas = [];
  estado.carregado = false;
  mostrarAuth();
}

async function sair() {
  await push.desvincularServidor().catch(() => {});
  limparSessaoLocal();
}

// ======================================================================
// Dados (com cópia local para abrir rápido e funcionar offline)
// ======================================================================
function salvarCache() {
  try {
    const u = sessao.usuario();
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ uid: u && u.id, resumo: estado.resumo, contas: estado.contas })
    );
  } catch { /* armazenamento cheio ou bloqueado: ignora */ }
}

function lerCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    const u = sessao.usuario();
    if (c && u && c.uid === u.id && c.resumo) {
      estado.resumo = c.resumo;
      estado.contas = c.contas || [];
      estado.carregado = true;
    }
  } catch { /* cache inválido: ignora */ }
}

async function carregarDados() {
  try {
    const [resumo, lista] = await Promise.all([api.resumo(), api.contas()]);
    estado.resumo = resumo;
    estado.contas = lista.contas;
    estado.carregado = true;
    salvarCache();
    $('banner-offline').classList.add('hidden');
  } catch (err) {
    if (err.status === 0) {
      $('banner-offline').classList.remove('hidden');
      estado.carregado = true; // mostra o que houver em cache (ou a lista vazia)
    } else if (err.status !== 401) {
      toast(err.message, 'erro');
    }
  }
  render();
}

// ======================================================================
// Renderização
// ======================================================================
function render() {
  renderCards();
  renderContas();
}

function renderCards() {
  const r = estado.resumo;
  if (!r) {
    $('card-mensal').textContent = '—';
    $('card-anual').textContent = '—';
    $('card-ativos').textContent = '—';
    $('card-alertas').innerHTML = '';
    return;
  }

  $('card-mensal').textContent = brl(r.gasto_fixo_mensal);
  $('card-anual').textContent = brl(r.projecao_anual);
  $('card-ativos').textContent = String(r.compromissos_ativos);

  const linhas = [];
  if (r.atrasadas > 0) {
    linhas.push(`<p class="text-red-400">${r.atrasadas} ${r.atrasadas === 1 ? 'atrasada' : 'atrasadas'}</p>`);
  }
  if (r.vencem_hoje > 0) {
    linhas.push(
      `<p class="text-amber-400">${r.vencem_hoje} ${r.vencem_hoje === 1 ? 'vence hoje' : 'vencem hoje'}</p>`
    );
  }
  const proximas = r.proximas.filter((c) => c.status === 'proxima').slice(0, 3);
  for (const c of proximas) {
    linhas.push(
      `<p class="truncate text-zinc-300">${esc(c.nome)} <span class="text-zinc-500">· ${esc(rotuloDias(c))}</span></p>`
    );
  }
  if (!linhas.length) {
    linhas.push('<p class="text-green-500">Nenhuma conta próxima do vencimento.</p>');
  }
  $('card-alertas').innerHTML = linhas.join('');
}

function linhaTabela(c) {
  const opaco = c.ativa ? '' : 'opacity-60';
  const equiv = textoEquivalente(c);
  return `
    <tr class="border-t border-zinc-900 ${opaco}">
      <td class="px-4 py-3">
        <div class="font-medium">${esc(c.nome)}</div>
        <div class="text-xs text-zinc-500">${esc(c.categoria)}</div>
      </td>
      <td class="px-4 py-3 tabular-nums">
        <div>${brl(c.valor)}</div>
        ${equiv ? `<div class="text-xs text-zinc-500">${equiv}</div>` : ''}
      </td>
      <td class="px-4 py-3 text-zinc-300">${ROTULO_CICLO[c.ciclo] || esc(c.ciclo)}</td>
      <td class="px-4 py-3">
        <div class="tabular-nums">${dataBR(c.proximo_vencimento)}</div>
        <div class="mt-1">${chipStatus(c)}</div>
      </td>
      <td class="px-4 py-3">
        <div class="flex justify-end gap-1">
          <button type="button" data-acao="pagar" data-id="${c.id}" ${c.ativa ? '' : 'disabled'}
            class="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-40">Marcar como pago</button>
          <button type="button" data-acao="editar" data-id="${c.id}"
            class="rounded-lg px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900">Editar</button>
          <button type="button" data-acao="excluir" data-id="${c.id}"
            class="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-zinc-900">Excluir</button>
        </div>
      </td>
    </tr>`;
}

function itemMobile(c) {
  const opaco = c.ativa ? '' : 'opacity-60';
  const equiv = textoEquivalente(c);
  return `
    <li>
      <button type="button" data-acao="abrir" data-id="${c.id}"
        class="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left active:bg-zinc-900 ${opaco}">
        <div class="min-w-0">
          <div class="truncate font-medium">${esc(c.nome)}</div>
          <div class="mt-0.5 truncate text-xs text-zinc-500">${esc(c.categoria)} · ${ROTULO_CICLO[c.ciclo] || esc(c.ciclo)}</div>
        </div>
        <div class="shrink-0 text-right">
          <div class="font-semibold tabular-nums">${brl(c.valor)}</div>
          ${equiv ? `<div class="text-[11px] text-zinc-500">${equiv}</div>` : ''}
          <div class="mt-1">${chipStatus(c)}</div>
        </div>
      </button>
    </li>`;
}

function renderContas() {
  const vazia = estado.contas.length === 0;
  const aviso = $('lista-vazia');
  aviso.classList.toggle('hidden', !vazia);
  $('bloco-contas').classList.toggle('hidden', vazia);

  if (vazia) {
    aviso.textContent = estado.carregado
      ? 'Nenhuma conta cadastrada ainda. Toque em “+” para adicionar a primeira.'
      : 'Carregando…';
    return;
  }
  $('tbody-contas').innerHTML = estado.contas.map(linhaTabela).join('');
  $('lista-mobile').innerHTML = estado.contas.map(itemMobile).join('');
}

// ======================================================================
// Contas: formulário, pagar, excluir
// ======================================================================
const CAMPOS_ERRO = ['nome', 'categoria', 'valor', 'ciclo', 'proximo_vencimento', 'form'];

function limparErrosForm() {
  for (const campo of CAMPOS_ERRO) {
    const el = $(`erro-${campo}`);
    el.textContent = '';
    el.classList.add('hidden');
  }
}

function mostrarErroCampo(campo, texto) {
  const el = $(`erro-${CAMPOS_ERRO.includes(campo) ? campo : 'form'}`);
  el.textContent = texto;
  el.classList.remove('hidden');
}

function abrirFormConta(conta = null) {
  limparErrosForm();
  $('conta-titulo').textContent = conta ? 'Editar conta' : 'Nova conta';
  $('conta-id').value = conta ? String(conta.id) : '';
  $('conta-nome').value = conta ? conta.nome : '';
  $('conta-categoria').value = conta ? conta.categoria : '';
  $('conta-valor').value = conta ? conta.valor.toFixed(2).replace('.', ',') : '';
  $('conta-ciclo').value = conta ? conta.ciclo : 'mensal';
  $('conta-venc').value = conta ? conta.proximo_vencimento : (estado.resumo && estado.resumo.hoje) || hojeLocal();
  $('conta-ativa').checked = conta ? conta.ativa : true;

  const blocoAtiva = $('bloco-ativa');
  blocoAtiva.classList.toggle('hidden', !conta);
  blocoAtiva.classList.toggle('flex', Boolean(conta));

  $('dlg-conta').showModal();
}

async function salvarConta(e) {
  e.preventDefault();
  limparErrosForm();

  const id = $('conta-id').value;
  const corpo = {
    nome: $('conta-nome').value,
    categoria: $('conta-categoria').value,
    valor: $('conta-valor').value,
    ciclo: $('conta-ciclo').value,
    proximo_vencimento: $('conta-venc').value,
  };
  if (id) corpo.ativa = $('conta-ativa').checked;

  const botao = $('btn-salvar-conta');
  botao.disabled = true;
  try {
    if (id) await api.editar(id, corpo);
    else await api.criar(corpo);
    $('dlg-conta').close();
    toast(id ? 'Conta atualizada.' : 'Conta cadastrada.');
    await carregarDados();
  } catch (err) {
    if (err.detalhes) {
      for (const [campo, texto] of Object.entries(err.detalhes)) mostrarErroCampo(campo, texto);
    } else {
      mostrarErroCampo('form', err.message);
    }
  } finally {
    botao.disabled = false;
  }
}

async function pagar(id) {
  const c = estado.contas.find((x) => x.id === id);
  if (!c) return;
  const ok = await confirmar({
    titulo: 'Marcar como pago?',
    texto: `${c.nome} — ${brl(c.valor)}, vencimento ${dataBR(c.proximo_vencimento)}. O vencimento avança para o próximo ciclo.`,
    rotulo: 'Marcar como pago',
  });
  if (!ok) return;

  try {
    const r = await api.pagar(id, c.proximo_vencimento);
    toast(`Pago! Próximo vencimento: ${dataBR(r.conta.proximo_vencimento)}.`);
    await carregarDados();
  } catch (err) {
    toast(err.message, 'erro');
    if (err.status === 409) await carregarDados();
  }
}

async function excluir(id) {
  const c = estado.contas.find((x) => x.id === id);
  if (!c) return;
  const ok = await confirmar({
    titulo: 'Excluir conta?',
    texto: `“${c.nome}” e o histórico de pagamentos dela serão removidos. Esta ação não pode ser desfeita.`,
    rotulo: 'Excluir',
    perigo: true,
  });
  if (!ok) return;

  try {
    await api.excluir(id);
    toast('Conta excluída.');
    await carregarDados();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

function abrirSheet(id) {
  const c = estado.contas.find((x) => x.id === id);
  if (!c) return;
  $('sheet-titulo').textContent = c.nome;
  $('sheet-sub').textContent = `${brl(c.valor)} · ${c.ativa ? rotuloDias(c) : 'Pausada'}`;
  $('dlg-acoes').querySelectorAll('button[data-acao]').forEach((b) => {
    if (b.dataset.acao !== 'fechar') b.dataset.id = String(id);
  });
  $('sheet-pagar').disabled = !c.ativa;
  $('dlg-acoes').showModal();
}

// ======================================================================
// Notificações push
// ======================================================================
async function atualizarSino() {
  try {
    const s = await push.estado();
    const ativo = s.suportado && s.permissao === 'granted' && s.inscrito;
    $('btn-notif').classList.toggle('text-green-500', ativo);
    $('btn-notif').classList.toggle('text-zinc-400', !ativo);
  } catch { /* sem service worker: mantém o padrão */ }
}

async function atualizarDialogNotif() {
  const status = $('notif-status');
  const dica = $('notif-dica');
  const ativar = $('btn-push-ativar');
  const teste = $('btn-push-teste');
  const desativar = $('btn-push-desativar');
  [ativar, teste, desativar].forEach((b) => b.classList.add('hidden'));
  dica.classList.add('hidden');

  const s = await push.estado();

  if (!s.suportado) {
    status.textContent = 'Este navegador ou conexão não permite notificações push.';
    dica.textContent = push.iosSemInstalar()
      ? 'No iPhone, instale o app (Compartilhar → Adicionar à Tela de Início) e abra por ele.'
      : 'Notificações push exigem HTTPS (ou localhost) e um navegador compatível.';
    dica.classList.remove('hidden');
    return;
  }
  if (s.permissao === 'denied') {
    status.textContent = 'As notificações estão bloqueadas para este site.';
    dica.textContent = 'Libere nas configurações do navegador (cadeado ao lado do endereço) e tente de novo.';
    dica.classList.remove('hidden');
    return;
  }
  if (s.permissao === 'granted' && s.inscrito) {
    status.textContent = 'Ativas neste dispositivo. Você será avisado 1 dia antes e no dia do vencimento, mesmo com o app fechado.';
    teste.classList.remove('hidden');
    desativar.classList.remove('hidden');
    return;
  }
  status.textContent = 'Receba avisos de vencimento na tela de bloqueio, mesmo com o app fechado.';
  if (push.iosSemInstalar()) {
    dica.textContent = 'No iPhone, as notificações só funcionam depois de instalar o app na Tela de Início.';
    dica.classList.remove('hidden');
  }
  ativar.classList.remove('hidden');
}

async function acaoPush(botaoId, rotuloOcupado, tarefa, mensagemOk) {
  const botao = $(botaoId);
  const rotulo = botao.textContent;
  botao.disabled = true;
  botao.textContent = rotuloOcupado;
  try {
    await tarefa();
    if (mensagemOk) toast(mensagemOk);
  } catch (err) {
    toast(err.message, 'erro');
  } finally {
    botao.disabled = false;
    botao.textContent = rotulo;
    await atualizarDialogNotif();
    atualizarSino();
  }
}

// ======================================================================
// Eventos
// ======================================================================
function aoClicar(e) {
  const el = e.target.closest('[data-acao]');
  if (!el) return;
  const acao = el.dataset.acao;
  const id = Number(el.dataset.id) || null;

  // Ações vindas de dentro de um diálogo fecham o diálogo antes de seguir
  if (['pagar', 'editar', 'excluir'].includes(acao)) {
    const dlg = el.closest('dialog');
    if (dlg) dlg.close();
  }

  switch (acao) {
    case 'aba': trocarAba(el.dataset.aba); break;
    case 'nova': abrirFormConta(); break;
    case 'abrir': abrirSheet(id); break;
    case 'editar': abrirFormConta(estado.contas.find((c) => c.id === id)); break;
    case 'pagar': pagar(id); break;
    case 'excluir': excluir(id); break;
    case 'fechar': el.closest('dialog').close(); break;
    case 'sair': sair(); break;
    case 'notif':
      atualizarDialogNotif().finally(() => $('dlg-notif').showModal());
      break;
    case 'push-ativar':
      acaoPush('btn-push-ativar', 'Ativando…', () => push.ativar(), 'Notificações ativadas neste dispositivo.');
      break;
    case 'push-desativar':
      acaoPush('btn-push-desativar', 'Desativando…', () => push.desativar(), 'Notificações desativadas.');
      break;
    case 'push-teste':
      acaoPush('btn-push-teste', 'Enviando…', () => api.testePush(), 'Teste enviado. Deve chegar em instantes.');
      break;
    default: break;
  }
}

function ligarEventos() {
  $('form-login').addEventListener('submit', (e) => enviarAuth(e, 'login'));
  $('form-cadastro').addEventListener('submit', (e) => enviarAuth(e, 'cadastro'));
  $('form-conta').addEventListener('submit', salvarConta);
  document.addEventListener('click', aoClicar);

  // Clicar no fundo escuro fecha o diálogo
  document.querySelectorAll('dialog').forEach((dlg) => {
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); });
  });

  window.addEventListener('online', () => { if (sessao.token()) carregarDados(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && sessao.token()) carregarDados();
  });
}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const registrar = () =>
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[sw] registro falhou:', err));
  if (document.readyState === 'complete') registrar();
  else window.addEventListener('load', registrar);

  // O Service Worker avisa quando o usuário toca numa notificação com o app aberto
  navigator.serviceWorker.addEventListener('message', (ev) => {
    if (ev.data && ev.data.tipo === 'atualizar' && sessao.token()) carregarDados();
  });
}

// ======================================================================
// Início
// ======================================================================
function iniciar() {
  registrarServiceWorker();
  ligarEventos();
  api.aoExpirar(() => {
    limparSessaoLocal();
    toast('Sessão expirada. Entre novamente.', 'erro');
  });

  if (sessao.token()) entrar();
  else mostrarAuth();
}

iniciar();
