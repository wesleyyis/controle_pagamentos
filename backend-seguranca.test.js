'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validarInscricao, endpointPermitido } = require('./src/lib/validacao-push');
const ler = (relativo) => fs.readFileSync(path.join(__dirname, relativo), 'utf8');

test('endpoint push so aceita servicos oficiais (sem SSRF)', () => {
  assert.ok(endpointPermitido('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(endpointPermitido('https://updates.push.services.mozilla.com/wpush/v2/abc'));
  assert.ok(endpointPermitido('https://web.push.apple.com/abc'));
  assert.ok(endpointPermitido('https://wns2-brs1.notify.windows.com/?token=abc'));

  assert.ok(!endpointPermitido('http://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(!endpointPermitido('https://127.0.0.1:8443/abc'));
  assert.ok(!endpointPermitido('https://localhost/abc'));
  assert.ok(!endpointPermitido('https://fcm.googleapis.com.evil.com/abc'));
  assert.ok(!endpointPermitido('https://user@evil.com/abc'));
  assert.ok(!endpointPermitido('https://fcm.googleapis.com:8443/abc'));
  assert.ok(!endpointPermitido('java script:alert(1)'));
  assert.ok(!endpointPermitido(null));
});

test('validarInscricao exige chaves base64url', () => {
  const base = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: 'abc-123_', auth: 'xyz' },
  };
  assert.ok(validarInscricao(base));
  assert.equal(validarInscricao({ ...base, keys: { ...base.keys, p256dh: 'abc+/=' } }), null);
  assert.equal(validarInscricao({ ...base, keys: { ...base.keys, auth: '' } }), null);
  assert.equal(validarInscricao({ ...base, keys: null }), null);
  assert.equal(validarInscricao(null), null);
});

test('inscricao nao muda de dono no MySQL nem no Postgres', () => {
  const rota = ler('src/routes/push.js');
  assert.doesNotMatch(rota, /usuario_id\s*=\s*VALUES\(usuario_id\)/);
  assert.match(rota, /res\.status\(409\)/);

  const sql = ler('supabase/01_schema.sql');
  assert.doesNotMatch(sql, /set user_id = excluded\.user_id/);
  assert.match(sql, /PT409/);
  assert.match(sql, /notify\.windows\.com/);
});

test('configuracao de exemplo cobre todas as variaveis obrigatorias', () => {
  const exemplo = ler('.env.example');
  for (const chave of [
    'DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET',
    'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT',
  ]) {
    assert.match(exemplo, new RegExp(`^${chave}=`, 'm'), `falta ${chave} no .env.example`);
  }
});

test('agendamento SQL pode ser reexecutado', () => {
  const sql = ler('supabase/02_agendamento.sql');
  assert.match(sql, /if not exists \(select 1 from vault\.secrets/);
  assert.match(sql, /cron\.unschedule\('cp-alertas-diarios'\)/);
  assert.ok(sql.indexOf('cron.unschedule') < sql.indexOf('cron.schedule('));
  assert.doesNotMatch(sql, /'<<<ROTACIONAR_CRON_SECRET>>>'[\s\S]{0,80}vault\.create_secret\('[^<]/);
});
