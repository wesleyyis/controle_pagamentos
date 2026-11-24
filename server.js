'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const webpush = require('web-push');
const { pool, testarConexao } = require('./db');

// ---------------------------------------------------------------------
// Validação de ambiente (falha rápida se algo essencial estiver faltando)
// ---------------------------------------------------------------------
const obrigatorias = [
  'DB_HOST',
  'DB_USER',
  'DB_NAME',
  'JWT_SECRET',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
];
const faltando = obrigatorias.filter((k) => !process.env[k]);
if (faltando.length) {
  console.error(`[config] Variáveis ausentes no .env: ${faltando.join(', ')}`);
  console.error('[config] Copie .env.example para .env e preencha (use "npm run vapid" para as chaves VAPID).');
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.warn('[config] JWT_SECRET curto: use pelo menos 32 caracteres aleatórios.');
}

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ---------------------------------------------------------------------
// App
// ---------------------------------------------------------------------
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Necessário atrás do ngrok/proxy para o rate limit ler o IP correto
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Segurança de cabeçalhos. O CSS do Tailwind é gerado no build e servido localmente;
// a CSP libera apenas o próprio site e o Supabase (Auth/PostgREST/Edge Functions).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'https://*.supabase.co'],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null, // não força HTTPS em testes via IP local
      },
    },
  })
);

app.use(express.json({ limit: '10kb' }));

// Limita tentativas de login/cadastro (anti força bruta)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});
app.use('/api/auth', authLimiter);

// ---------------------------------------------------------------------
// Rotas da API
// ---------------------------------------------------------------------
app.get('/api/health', async (_req, res) => {
  try {
    await testarConexao();
    res.json({ status: 'ok', banco: 'conectado' });
  } catch (err) {
    console.error('[health] Falha no banco:', err.message);
    res.status(503).json({ status: 'erro', banco: 'indisponivel' });
  }
});

app.use('/api/auth',   require('./src/routes/auth'));    // cadastro e login (JWT)
app.use('/api/contas', require('./src/routes/contas'));  // CRUD + marcar como pago + resumo
app.use('/api/push',   require('./src/routes/push'));    // chave pública e inscrição

// 404 apenas para a API (o resto cai nos arquivos estáticos)
app.use('/api', (_req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

// ---------------------------------------------------------------------
// Frontend estático (PWA)
// ---------------------------------------------------------------------
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      // O Service Worker e o manifest nunca devem ficar presos em cache HTTP,
      // senão atualizações do app demoram a chegar no celular.
      const nome = path.basename(filePath);
      if (nome === 'sw.js' || nome === 'manifest.json') {
        res.setHeader('Cache-Control', 'no-cache');
      }
      if (nome === 'sw.js') {
        res.setHeader('Service-Worker-Allowed', '/');
      }
    },
  })
);

// ---------------------------------------------------------------------
// Tratamento de erros
// ---------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON inválido.' });
  }
  console.error('[erro]', err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

// ---------------------------------------------------------------------
// Inicialização e encerramento gracioso
// ---------------------------------------------------------------------
async function iniciar() {
  try {
    await testarConexao();
    console.log('[db] Conexão com o MySQL OK.');
  } catch (err) {
    console.error('[db] Não foi possível conectar ao MySQL:', err.message);
    console.error('[db] Verifique se o MySQL do XAMPP está ligado e se o schema.sql foi importado.');
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`[http] Servidor rodando em http://localhost:${PORT}`);
  });

  // Agendador diário de alertas de vencimento (node-cron)
  require('./src/jobs/alertas').iniciar();

  const encerrar = (sinal) => {
    console.log(`\n[sys] ${sinal} recebido. Encerrando...`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => encerrar('SIGINT'));
  process.on('SIGTERM', () => encerrar('SIGTERM'));
}

if (require.main === module) {
  iniciar();
}

module.exports = app;