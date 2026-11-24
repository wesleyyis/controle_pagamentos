# Controle de Pagamentos

> **Acesso ao app:** [https://pagamentox.netlify.app/](https://pagamentox.netlify.app/)

PWA (Progressive Web App) para acompanhar contas fixas, boletos e assinaturas, com dashboard de gastos, marcação de pagamento e alertas **Web Push** de vencimento mesmo com o app fechado.

A versão publicada é **100% estática** (Netlify) e usa o **Supabase** como backend (Auth + PostgREST + Edge Functions + pg_cron). Existe também um backend legado **Node/Express + MySQL** mantido apenas para desenvolvimento local.

---

## Funcionalidades

- Login e cadastro com Supabase Auth e opção **“Manter conectado neste aparelho”**.
- CRUD de contas: nome, categoria, valor, ciclo (`mensal`, `anual`, `semanal`), vencimento e pausa (`ativa`).
- Dashboard com:
  - gasto fixo mensal;
  - projeção anual;
  - compromissos ativos;
  - contas atrasadas, que vencem hoje e próximas.
- **Marcar como pago**: a RPC `pagar_conta` registra a baixa e avança o vencimento na mesma transação.
- Normalização de ciclos (RN01): mensal = valor; anual = valor ÷ 12; semanal = valor × 52 ÷ 12.
- Vencimentos sempre em `America/Sao_Paulo`, inclusive a correção do dia 31 em fevereiro.
- Web Push com VAPID: aviso **1 dia antes** e **no dia** do vencimento, com botão de teste no app.
- Funcionamento offline básico via Service Worker e cache local.
- Layout responsivo, PWA instalável, ícones e manifest.

---

## Arquitetura

```
┌──────────────────────┐        ┌─────────────────────────────────────┐
│  Netlify (estático)  │        │  Supabase                           │
│  public/             │ ─────▶ │  Auth (GoTrue)                      │
│  ├─ index.html       │ fetch  │  PostgREST (tabelas + RLS)          │
│  ├─ css/tailwind.css │        │  Edge Functions: alertas, push-test  │
│  ├─ js/*.js          │        │  pg_cron + pg_net + Vault            │
│  └─ sw.js            │        └─────────────────────────────────────┘
└──────────────────────┘

Backend legado (opcional, local):
  server.js → Express → MySQL (database/schema.sql)
  src/jobs/alertas.js → node-cron → web-push
```

> **Atenção:** o caminho legado e o pg_cron do Supabase têm tabelas de idempotência separadas. Não rode os dois agendadores de alertas ao mesmo tempo, ou o usuário pode receber notificações duplicadas.

---

## Requisitos

- **Node.js >= 18** e npm.
- Conta no [Supabase](https://supabase.com/).
- Conta no [Netlify](https://www.netlify.com/) para publicar.
- Opcional: MySQL/XAMPP, se quiser usar o backend legado local.

---

## Instalação

```powershell
git clone https://github.com/wesleyyis/controle_pagamentos.git
cd controle_pagamentos
npm install
```

---

## Configuração do Supabase (caminho de produção)

### 1. Banco de dados

No **SQL Editor** do Supabase, rode:

1. `supabase/01_schema.sql` — cria tabelas, funções, RLS e policies. É seguro reexecutar.
2. `supabase/03_testes_opcionais.sql` — verificações manuais opcionais.

### 2. Chaves públicas no frontend

Edite `public/js/config.js`:

```js
export const CONFIG = {
  SUPABASE_URL: 'https://<seu-projeto>.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_...',
  VAPID_PUBLIC_KEY: '<chave pública VAPID em base64url>',
};
```

A chave publicável e a VAPID pública **podem** ficar no navegador. A segurança vem do RLS.

### 3. Chaves VAPID

Gere o par:

```powershell
npm run vapid
```

- `VAPID_PUBLIC_KEY` → `public/js/config.js`.
- `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` → **Edge Function Secrets** do Supabase (e `.env`, se usar o backend legado).

Formato do subject: `mailto:seu-email@exemplo.com`.

### 4. Edge Functions

Faça login/link da CLI, se necessário:

```powershell
npx supabase login
npx supabase link --project-ref <seu-project-ref>
```

Defina os secrets:

```powershell
npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:... CRON_SECRET=...
```

Publique as funções:

```powershell
npx supabase functions deploy alertas --use-api --no-verify-jwt
npx supabase functions deploy push-test --use-api
```

Para rodar localmente:

```powershell
npx supabase functions serve --env-file supabase/.env
```

### 5. Agendamento dos alertas

Gere um `CRON_SECRET` aleatório, defina como secret da função (passo anterior) e rode no SQL Editor:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'cp_cron_secret'),
  'NOVO_VALOR'
);
```

Depois rode `supabase/02_agendamento.sql`. Ele é idempotente:

- cria os segredos do Vault apenas se não existirem;
- remove o job anterior antes de reagendar;
- não sobrescreve um segredo já configurado.

O job dispara a Edge Function `alertas` todo dia às **11:00 UTC (08:00 Brasília)**.

---

## Deploy no Netlify

1. Conecte o repositório ao Netlify.
2. Build command: **vazio**.
3. Publish directory: `public`.
4. Faça commit de `public/css/tailwind.css`.

> O Netlify não roda build. O CSS do Tailwind é gerado localmente com `npm run css` e versionado. Se ele faltar, o site abre sem estilo.

A CSP já está configurada em `netlify.toml` e em `server.js`: apenas `'self'` e `https://*.supabase.co`.

---

## Backend legado (opcional)

Útil para desenvolvimento local com MySQL:

```powershell
Copy-Item .env.example .env
```

Preencha `.env` e importe `database/schema.sql` (e, se vier de uma versão antiga, `database/migracao_001_dia_ancora.sql`).

```powershell
npm run dev
```

Health check: `http://localhost:3000/api/health`.

Variáveis principais:

| Variável | Descrição |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Conexão MySQL |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Assinatura dos tokens do backend legado |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push |
| `CRON_SCHEDULE`, `CRON_TIMEZONE` | Agendador local (padrão: `0 8 * * *`, `America/Sao_Paulo`) |
| `ALERTAS_RODAR_AO_INICIAR` | Roda os alertas uma vez ao subir (dev) |

`.env` está no `.gitignore` e **nunca** deve ser commitado.

---

## Scripts

| Comando | Uso |
|---|---|
| `npm test` | Roda os 31 testes (lógica legada, frontend e segurança) |
| `npm run css` | Gera `public/css/tailwind.css` (minificado) |
| `npm run css:watch` | Regenera o CSS em tempo real |
| `npm run dev` | Servidor legado com `node --watch` |
| `npm start` | Servidor legado |
| `npm run alertas` | Executa o job de alertas uma vez |
| `npm run vapid` | Gera par de chaves VAPID |

Rode `npm run css` sempre que alterar classes Tailwind em `public/index.html` ou `public/js/**/*.js`.

---

## Estrutura do projeto

```
.
├── public/                 # PWA publicada no Netlify
│   ├── css/
│   │   ├── app.css         # Ajustes próprios (safe-area, diálogos)
│   │   └── tailwind.css    # Gerado (não editar à mão)
│   ├── icons/
│   ├── js/
│   │   ├── api.js          # Auth/PostgREST/Edge Functions via fetch
│   │   ├── app.js          # UI e eventos
│   │   ├── calculos.js     # RN01 e resumo
│   │   ├── datas.js        # Datas em America/Sao_Paulo
│   │   ├── validacao.js    # Validação do formulário
│   │   ├── push.js         # Inscrição VAPID no navegador
│   │   ├── config.js       # Chaves públicas
│   │   └── package.json    # Habilita ESM só para testes do frontend
│   ├── index.html
│   ├── manifest.json
│   └── sw.js               # Service Worker (cache + push)
├── supabase/
│   ├── 01_schema.sql
│   ├── 02_agendamento.sql
│   ├── 03_testes_opcionais.sql
│   └── functions/
├── src/
│   ├── lib/                # Lógica compartilhada do backend legado
│   ├── routes/             # Express
│   ├── jobs/               # Alertas
│   └── middleware/
├── database/               # Schema e migração MySQL
├── logica.test.js
├── frontend.test.mjs
├── backend-seguranca.test.js
├── tailwind.config.js
├── tailwind.input.css
├── netlify.toml
└── server.js
```

---

## Segurança

- RLS habilitado nas tabelas do Supabase; escrita de push e histórico passa por funções `security definer`.
- Endpoints de push são aceitos somente de serviços oficiais (FCM, Mozilla, Apple, WNS) — evita SSRF.
- Uma inscrição push **não muda de dono** automaticamente (retorna `409`).
- CSP rígida, sem CDN, sem `unsafe-inline` e sem `unsafe-eval`.
- Logout revoga a sessão no Supabase e limpa `localStorage`/`sessionStorage`.
- Ao marcar **“Manter conectado”**, o refresh token passa a ficar em `localStorage` para evitar novo login a cada visita. Em aparelho compartilhado, desmarque a opção.
- Nunca commite `.env`, `supabase/.env` ou segredos. O arquivo `supabase/02_agendamento.sql` contém apenas placeholders.

Se um segredo chegou a ser versionado, rotacione-o primeiro e depois remova do histórico com `git filter-repo`.

---

## Solução de problemas

| Sintoma | Causa provável | Ação |
|---|---|---|
| “Configure o Supabase…” | `config.js` com valores placeholder | Preencha URL e chave publicável |
| Login não entra | Confirmação de e-mail ligada | Confirme o e-mail; o app mostra aviso |
| Sem notificações no iPhone | PWA não instalada na Tela de Início | Compartilhar → Adicionar à Tela de Início |
| Push parou após trocar VAPID | Inscrição antiga com outra chave | O app renova sozinho ao entrar; se persistir, desative e ative de novo |
| Banner “Sem conexão” | CSP ou rede bloqueando Supabase | Confira `connect-src` e o console |
| Site sem estilo | `tailwind.css` não commitado | Rode `npm run css` e faça commit |
| Alertas duplicados | Legado e pg_cron rodando juntos | Desative um dos agendadores |
| `CRON_SECRET` inválido (401 em `net._http_response`) | Segredo divergente | Atualize o secret da função **e** o Vault |
