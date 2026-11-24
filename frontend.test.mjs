import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const ler = (relativo) => fs.readFileSync(path.join(raiz, relativo), 'utf8');

// Node 26 expõe um localStorage experimental; use stubs em memória nos testes.
const memLocal = new Map();
const memSessao = new Map();
const storagem = (map) => ({
  getItem: (chave) => (map.has(chave) ? map.get(chave) : null),
  setItem: (chave, valor) => map.set(chave, String(valor)),
  removeItem: (chave) => map.delete(chave),
  clear: () => map.clear(),
});
Object.defineProperty(globalThis, 'sessionStorage', { value: storagem(memSessao), configurable: true });

test('frontend: hojeISO respeita America/Sao_Paulo', async () => {
  const { hojeISO } = await import('./public/js/datas.js');
  assert.equal(hojeISO(new Date('2026-11-18T02:00:00Z')), '2026-11-17');
  assert.equal(hojeISO(new Date('2026-11-18T12:00:00Z')), '2026-11-18');
});

test('frontend: totais mensal e anual por ciclo', async () => {
  const { totais } = await import('./public/js/calculos.js');
  const t = totais([
    { valor: 100, ciclo: 'mensal' },
    { valor: 1200, ciclo: 'anual' },
    { valor: 50, ciclo: 'semanal' },
  ]);
  assert.equal(t.mensal, 416.67);
  assert.equal(t.anual, 5000);
});

test('frontend: validarConta aceita valor brasileiro e aponta erros por campo', async () => {
  const { validarConta } = await import('./public/js/validacao.js');

  const ok = validarConta({
    nome: ' Aluguel ',
    categoria: 'Casa',
    valor: '1.500,00',
    ciclo: 'mensal',
    proximo_vencimento: '2026-12-05',
  });
  assert.equal(ok.dados.nome, 'Aluguel');
  assert.equal(ok.dados.valor, 1500);

  const ruim = validarConta({
    nome: '', categoria: '', valor: -5, ciclo: 'diario', proximo_vencimento: '2026-02-30',
  });
  assert.deepEqual(
    Object.keys(ruim.detalhes).sort(),
    ['categoria', 'ciclo', 'nome', 'proximo_vencimento', 'valor']
  );
});

test('chave VAPID publica do navegador e base64url de 65 bytes', () => {
  const encontrada = /VAPID_PUBLIC_KEY:\s*'([^']+)'/.exec(ler('public/js/config.js'));
  assert.ok(encontrada, 'VAPID_PUBLIC_KEY nao encontrada em config.js');

  const chave = encontrada[1];
  const preenchimento = '='.repeat((4 - (chave.length % 4)) % 4);
  const bytes = Buffer.from(
    chave.replace(/-/g, '+').replace(/_/g, '/') + preenchimento,
    'base64'
  );
  assert.equal(bytes.length, 65, 'A chave publica VAPID deve ter 65 bytes');
});

test('app.js e push.js so chamam metodos existentes da api', async () => {
  const { api, sessao } = await import('./public/js/api.js');
  const alvos = new Set();

  for (const arquivo of ['public/js/app.js', 'public/js/push.js']) {
    for (const m of ler(arquivo).matchAll(/\b(api|sessao)\.([A-Za-z_$][\w$]*)\s*\(/g)) {
      alvos.add(`${m[1]}.${m[2]}`);
    }
  }

  assert.ok(alvos.has('api.carregar'), 'carregarDados deve usar api.carregar()');
  assert.ok(!alvos.has('sessao.salvar'), 'sessao.salvar() nao existe mais');

  for (const alvo of alvos) {
    const [nomeObjeto, metodo] = alvo.split('.');
    const objeto = nomeObjeto === 'api' ? api : sessao;
    assert.equal(typeof objeto[metodo], 'function', `${alvo} nao existe na API exportada`);
  }
});

test('CSP do Express libera o Supabase', () => {
  const bloco = /connectSrc:\s*\[([^\]]*)\]/.exec(ler('server.js'));
  assert.ok(bloco, 'connectSrc nao encontrado em server.js');
  assert.match(bloco[1], /https:\/\/\*\.supabase\.co/);
});

test('logout revoga a sessao no Supabase e fecha dialogos abertos', () => {
  const codigo = ler('public/js/app.js');
  assert.match(codigo, /await api\.sair\(\)/);
  assert.match(codigo, /querySelectorAll\('dialog\[open\]'\)/);
});

test('service worker e unico, registrado e com precache completo', () => {
  assert.ok(fs.existsSync(path.join(raiz, 'public/sw.js')), 'public/sw.js deve existir');
  assert.ok(!fs.existsSync(path.join(raiz, 'public/js/sw.js')), 'copia duplicada deve ser removida');

  const sw = ler('public/sw.js');
  assert.match(sw, /const VERSAO = 'v4'/);
  assert.ok(sw.includes("'/css/tailwind.css'"), 'precache deve incluir o CSS local');
  for (const modulo of ['config.js', 'datas.js', 'calculos.js', 'validacao.js']) {
    assert.ok(sw.includes(`'/js/${modulo}'`), `precache falta /js/${modulo}`);
  }
  assert.match(ler('public/js/app.js'), /serviceWorker\.register\('\/sw\.js'\)/);
});

test('manter conectado persiste a sessao; sem isso ela some ao fechar a aba', () => {
  const api = ler('public/js/api.js');
  const app = ler('public/js/app.js');
  const html = ler('public/index.html');

  assert.match(api, /Boolean\(localStorage\.getItem\(SESSAO_KEY\)\)/);
  assert.match(api, /persistir \? localStorage : sessionStorage/);
  assert.match(api, /async login\(email, senha, manterConectado/);
  assert.match(api, /async registrar\(nome, email, senha, manterConectado/);
  assert.match(api, /salvarSessao\(dados, manterConectado\)/);
  assert.match(api, /salvarSessao\(dados, persistir\)/);
  assert.match(api, /limpar\(\)[\s\S]{0,240}localStorage\.removeItem\(SESSAO_KEY\)/);

  assert.match(app, /manter-conectado/);
  assert.match(app, /api\.login\(dados\.email, dados\.senha, manterConectado\)/);
  assert.match(app, /api\.registrar\(dados\.nome, dados\.email, dados\.senha, manterConectado\)/);
  assert.match(html, /name="manter-conectado" checked/);

  // O cache de dados continua volátil por aba.
  assert.match(app, /sessionStorage\.getItem\(CACHE_KEY\)/);
  assert.match(app, /sessionStorage\.setItem\(\s*CACHE_KEY/);
});

test('Tailwind e servido localmente, sem CDN na CSP', () => {
  assert.ok(fs.existsSync(path.join(raiz, 'public/css/tailwind.css')), 'CSS local deve existir');

  const html = ler('public/index.html');
  assert.match(html, /<link rel="stylesheet" href="\/css\/tailwind\.css">/);
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com/);

  for (const arquivo of ['server.js', 'netlify.toml', 'public/sw.js']) {
    assert.doesNotMatch(ler(arquivo), /cdn\.tailwindcss\.com/, `${arquivo} ainda referencia o CDN`);
  }
});
