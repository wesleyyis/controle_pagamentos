-- =====================================================================
-- Agendamento diário dos alertas (pg_cron + pg_net -> Edge Function "alertas")
--
-- ANTES de rodar:
--   1) publique a função:  npx supabase functions deploy alertas --use-api --no-verify-jwt
--   2) defina CRON_SECRET nos secrets das funções (veja o passo a passo)
--   3) troque os dois valores marcados com <<< >>> abaixo
--
-- Rode este arquivo UMA vez (os segredos do Vault têm nome único).
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Segredos no Vault (não ficam em texto puro no job)
select vault.create_secret('https://xsvrdoosdlcxjbblujsm.supabase.co', 'cp_project_url');
select vault.create_secret('71bae14b948691d75895fc8cbd8e13131f8d35e93035e9097a342610479caeee', 'cp_cron_secret');

-- Todo dia às 11:00 UTC = 08:00 em Brasília (o Brasil não usa horário de verão).
-- Para outro horário, mude só o "0 11 * * *" (minuto hora dia mês dia-da-semana, em UTC).
select cron.schedule(
  'cp-alertas-diarios',
  '0 11 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cp_project_url') || '/functions/v1/alertas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cp_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) as request_id;
  $$
);

-- ---------------------------------------------------------------------
-- Conferência e diagnóstico (rode quando quiser)
-- ---------------------------------------------------------------------
-- Job cadastrado:
--   select jobid, jobname, schedule, active from cron.job where jobname = 'cp-alertas-diarios';
-- Últimas execuções do agendador:
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
-- Respostas HTTP da função (200 = ok, 401 = CRON_SECRET diferente):
--   select id, status_code, content, created from net._http_response order by created desc limit 5;
-- Para disparar agora, sem esperar as 08h (cria uma execução única):
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'cp_project_url') || '/functions/v1/alertas',
--     headers := jsonb_build_object('Content-Type','application/json',
--       'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cp_cron_secret')),
--     body := '{}'::jsonb, timeout_milliseconds := 30000);
-- Para pausar/remover o agendamento:
--   select cron.unschedule('cp-alertas-diarios');
