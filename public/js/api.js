// Acesso ao Supabase usando só fetch (Auth/GoTrue + PostgREST + Edge Functions).
// Sem bibliotecas externas: o app continua abrindo offline e a CSP continua simples.
import { CONFIG } from './config.js';
import { hojeISO } from './datas.js';
import { serializarConta, montarResumo } from './calculos.js';
import { validarConta, validarCadastro } from './validacao.js';

const SESSAO_KEY = 'cp_sessao';
const COLUNAS = 'id,nome,categoria,valor,ciclo,proximo_vencimento,ativa';
const MARGEM_RENOVACAO_S = 60; // renova o token 1 min antes de expirar

export class ApiError extends Error {
  constructor(mensagem, status, detalhes, codigo) {
    super(mensagem);
    this.status = status; // 0 = sem conexão
    this.detalhes = detalhes;
    this.codigo = codigo;
  }
}

let aoExpirar = () => {};

// ======================================================================
// Sessão (sessionStorage: some ao fechar a aba, nunca fica persistida no disco)
// ======================================================================
function lerSessao() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSAO_KEY));
  } catch {
    return null;
  }
}

export const sessao = {
  token: () => (lerSessao() || {}).access_token || null,
  usuario: () => (lerSessao() || {}).usuario || null,
  limpar() {
    sessionStorage.removeItem(SESSAO_KEY);
    // Restos da versão com backend próprio, que usava localStorage.
    localStorage.removeItem('cp_token');
    localStorage.removeItem('cp_usuario');
    localStorage.removeItem(SESSAO_KEY);
  },
};

function salvarSessao(dados) {
  const u = dados.user || {};
  const usuario = {
    id: u.id,
    email: u.email,
    nome: (u.user_metadata && u.user_metadata.nome) || String(u.email || '').split('@')[0],
  };
  const expiraEm = dados.expires_at || Math.floor(Date.now() / 1000) + (dados.expires_in || 3600);
  sessionStorage.setItem(
    SESSAO_KEY,
    JSON.stringify({
      access_token: dados.access_token,
      refresh_token: dados.refresh_token,
      expires_at: expiraEm,
      usuario,
    })
  );
  return usuario;
}

// ======================================================================
// Infraestrutura HTTP
// ======================================================================
function base() {
  const url = CONFIG.SUPABASE_URL || '';
  const chave = CONFIG.SUPABASE_ANON_KEY || '';
  if (!url || url.includes('SEU-PROJETO') || !chave || chave.startsWith('COLE_AQUI')) {
    throw new ApiError('Configure o Supabase em public/js/config.js antes de usar o app.', 500);
  }
  return url.replace(/\/+$/, '');
}

const cabecalhosAnon = () => ({ apikey: CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' });

async function chamar(url, opcoes) {
  try {
    return await fetch(url, opcoes);
  } catch {
    throw new ApiError('Sem conexão com o servidor.', 0);
  }
}

async function lerJson(resposta) {
  try {
    return await resposta.json();
  } catch {
    return null;
  }
}

const MENSAGENS_AUTH = {
  invalid_credentials: 'E-mail ou senha inválidos.',
  invalid_grant: 'E-mail ou senha inválidos.',
  user_already_exists: 'Este e-mail já está cadastrado.',
  email_exists: 'Este e-mail já está cadastrado.',
  email_not_confirmed: 'Confirme seu e-mail (veja a caixa de entrada) antes de entrar.',
  weak_password: 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.',
  over_request_rate_limit: 'Muitas tentativas. Aguarde alguns minutos.',
  over_email_send_rate_limit: 'Limite de e-mails atingido. Tente novamente mais tarde.',
  signup_disabled: 'Novos cadastros estão desativados neste projeto.',
  validation_failed: 'Dados inválidos. Confira e-mail e senha.',
};

function erroAuth(status, d) {
  const codigo = d && (d.error_code || d.error);
  const texto = (d && (d.msg || d.message || d.error_description)) || '';
  let mensagem = MENSAGENS_AUTH[codigo];
  if (!mensagem && /invalid login credentials/i.test(texto)) mensagem = MENSAGENS_AUTH.invalid_credentials;
  if (!mensagem && /already registered/i.test(texto)) mensagem = MENSAGENS_AUTH.user_already_exists;
  if (!mensagem && /email not confirmed/i.test(texto)) mensagem = MENSAGENS_AUTH.email_not_confirmed;
  return new ApiError(mensagem || texto || 'Não foi possível concluir. Tente novamente.', status, undefined, codigo);
}

function erroRest(status, d) {
  const codigo = d && d.code != null ? String(d.code) : '';
  const texto = d && (d.message || d.msg || d.erro);
  // Erros levantados pelas funções SQL: SQLSTATE "PTxyz" vira HTTP xyz (PT404, PT409...)
  if (/^PT\d{3}$/.test(codigo)) return new ApiError(texto || 'Erro inesperado.', Number(codigo.slice(2)), undefined, codigo);
  if (['23514', '22P02', '23502', '22003', '22007'].includes(codigo)) {
    return new ApiError('Dados inválidos. Confira os campos e tente de novo.', 400, undefined, codigo);
  }
  if (codigo === '42501') return new ApiError('Sem permissão para esta operação.', 403, undefined, codigo);
  return new ApiError(texto || 'Erro inesperado. Tente novamente.', status, undefined, codigo);
}

// ---------------------------------------------------------------- renovação do token
let renovando = null;

function sessaoExpirada() {
  sessao.limpar();
  aoExpirar();
  return new ApiError('Sessão expirada. Entre novamente.', 401, undefined, 'TOKEN_EXPIRADO');
}

function renovarSessao() {
  if (renovando) return renovando; // várias chamadas simultâneas compartilham a mesma renovação
  renovando = (async () => {
    const atual = lerSessao();
    if (!atual || !atual.refresh_token) throw sessaoExpirada();

    const resposta = await chamar(`${base()}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: cabecalhosAnon(),
      body: JSON.stringify({ refresh_token: atual.refresh_token }),
    });
    const dados = await lerJson(resposta);

    if (!resposta.ok) {
      if (resposta.status >= 400 && resposta.status < 500) throw sessaoExpirada();
      throw erroAuth(resposta.status, dados);
    }
    salvarSessao(dados);
  })().finally(() => {
    renovando = null;
  });
  return renovando;
}

async function tokenAtual() {
  const s = lerSessao();
  if (!s || !s.access_token) throw sessaoExpirada();
  if (s.expires_at - MARGEM_RENOVACAO_S <= Date.now() / 1000) {
    await renovarSessao();
    return lerSessao().access_token;
  }
  return s.access_token;
}

/** fetch com o token do usuário; se vier 401, renova uma vez e repete. */
async function autenticado(url, opcoes = {}, jaRenovou = false) {
  const token = await tokenAtual();
  const resposta = await chamar(url, {
    ...opcoes,
    headers: { apikey: CONFIG.SUPABASE_ANON_KEY, ...(opcoes.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (resposta.status === 401 && !jaRenovou) {
    await renovarSessao();
    return autenticado(url, opcoes, true);
  }
  return resposta;
}

async function rest(metodo, caminho, { corpo, prefer } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const resposta = await autenticado(`${base()}/rest/v1/${caminho}`, {
    method: metodo,
    headers,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  if (resposta.status === 204) return null;
  const dados = await lerJson(resposta);
  if (resposta.status === 401) throw sessaoExpirada();
  if (!resposta.ok) throw erroRest(resposta.status, dados);
  return dados;
}

// ======================================================================
// API usada pela interface
// ======================================================================
async function listar() {
  const linhas = await rest('GET', `contas?select=${COLUNAS}&order=ativa.desc,proximo_vencimento.asc,nome.asc`);
  const hoje = hojeISO();
  return linhas.map((l) => serializarConta(l, hoje));
}

function idValido(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError('ID inválido.', 400);
  return n;
}

export const api = {
  aoExpirar: (fn) => { aoExpirar = fn; },

  // ---------------- autenticação
  async login(email, senha) {
    if (typeof email !== 'string' || typeof senha !== 'string' || !email || !senha) {
      throw new ApiError('Informe e-mail e senha.', 400);
    }
    const resposta = await chamar(`${base()}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: cabecalhosAnon(),
      body: JSON.stringify({ email: email.trim().toLowerCase(), password: senha }),
    });
    const dados = await lerJson(resposta);
    if (!resposta.ok) throw erroAuth(resposta.status, dados);
    return { usuario: salvarSessao(dados) };
  },

  async registrar(nome, email, senha) {
    const v = validarCadastro({ nome, email, senha });
    if (v.detalhes) throw new ApiError('Dados inválidos.', 400, v.detalhes);

    const resposta = await chamar(`${base()}/auth/v1/signup`, {
      method: 'POST',
      headers: cabecalhosAnon(),
      body: JSON.stringify({ email: v.dados.email, password: senha, data: { nome: v.dados.nome } }),
    });
    const dados = await lerJson(resposta);
    if (!resposta.ok) throw erroAuth(resposta.status, dados);

    // Com "Confirm email" ligado o Supabase não devolve sessão: o usuário precisa confirmar.
    if (dados && dados.access_token) return { usuario: salvarSessao(dados) };
    return { precisaConfirmar: true };
  },

  /** Encerra a sessão só neste aparelho (melhor esforço). */
  async sair() {
    const s = lerSessao();
    if (!s) return;
    try {
      await fetch(`${base()}/auth/v1/logout?scope=local`, {
        method: 'POST',
        headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access_token}` },
      });
    } catch { /* offline: a sessão local é apagada de qualquer forma */ }
  },

  // ---------------- contas
  async carregar() {
    const contas = await listar();
    return { contas, resumo: montarResumo(contas, hojeISO()) };
  },

  async criar(corpo) {
    const v = validarConta(corpo);
    if (v.detalhes) throw new ApiError('Dados inválidos.', 400, v.detalhes);
    const { nome, categoria, valor, ciclo, proximo_vencimento } = v.dados;
    const linhas = await rest('POST', `contas?select=${COLUNAS}`, {
      corpo: { nome, categoria, valor, ciclo, proximo_vencimento },
      prefer: 'return=representation',
    });
    return { conta: serializarConta(linhas[0], hojeISO()) };
  },

  async editar(id, corpo) {
    const n = idValido(id);
    const v = validarConta(corpo, { aceitaAtiva: true });
    if (v.detalhes) throw new ApiError('Dados inválidos.', 400, v.detalhes);
    const { nome, categoria, valor, ciclo, proximo_vencimento, ativa } = v.dados;
    const campos = { nome, categoria, valor, ciclo, proximo_vencimento };
    if (ativa !== undefined) campos.ativa = ativa;

    const linhas = await rest('PATCH', `contas?id=eq.${n}&select=${COLUNAS}`, {
      corpo: campos,
      prefer: 'return=representation',
    });
    if (!linhas.length) throw new ApiError('Conta não encontrada.', 404);
    return { conta: serializarConta(linhas[0], hojeISO()) };
  },

  async excluir(id) {
    const n = idValido(id);
    const linhas = await rest('DELETE', `contas?id=eq.${n}&select=id`, { prefer: 'return=representation' });
    if (!linhas.length) throw new ApiError('Conta não encontrada.', 404);
    return null;
  },

  /** "Marcar como Pago": a função SQL registra a baixa e avança o vencimento (numa transação). */
  pagar: (id, vencimentoAtual) =>
    rest('POST', 'rpc/pagar_conta', {
      corpo: { p_conta_id: idValido(id), p_vencimento_atual: vencimentoAtual || null },
    }),

  // ---------------- Web Push
  chavePublica: async () => ({ publicKey: CONFIG.VAPID_PUBLIC_KEY }),

  async inscrever(subscription) {
    const keys = (subscription && subscription.keys) || {};
    await rest('POST', 'rpc/registrar_push', {
      corpo: {
        p_endpoint: subscription && subscription.endpoint,
        p_p256dh: keys.p256dh,
        p_auth: keys.auth,
        p_user_agent: String(navigator.userAgent || '').slice(0, 255),
      },
    });
    return { ok: true };
  },

  async desinscrever(endpoint) {
    await rest('POST', 'rpc/remover_push', { corpo: { p_endpoint: endpoint } });
    return null;
  },

  /** Pede à Edge Function "push-test" que envie uma notificação para os aparelhos do usuário. */
  async testePush() {
    const resposta = await autenticado(`${base()}/functions/v1/push-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const dados = await lerJson(resposta);
    if (resposta.status === 401) throw sessaoExpirada();
    if (!resposta.ok) {
      if (resposta.status === 404 && dados && dados.code === 'NOT_FOUND') {
        throw new ApiError('A função push-test ainda não foi publicada no Supabase.', 404);
      }
      throw new ApiError((dados && (dados.erro || dados.message)) || 'Não foi possível enviar o teste.', resposta.status);
    }
    return dados;
  },
};
