-- =====================================================================
-- Agendamento diário dos alertas (pg_cron + pg_net -> Edge Function "alertas")
--
-- ANTES de rodar:
--   1) publique a função:  npx supabase functions deploy alertas --use-api --no-verify-jwt
--   2) defina CRON_SECRET nos secrets das funções (veja o passo a passo)
--   3) troque os dois valores marcados com <<< >>> abaixo
--   IMPORTANTE: rotacione o CRON_SECRET antes de preencher; o valor antigo ficou no historico do Git.
--
-- Pode rodar quantas vezes quiser; segredos existentes nao sao sobrescritos.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Segredos no Vault (não ficam em texto puro no job)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cp_project_url') then
    perform vault.create_secret('<<<PROJECT_URL>>>', 'cp_project_url');
  end if;
  if not exists (select 1 from vault.secrets where name = 'cp_cron_secret') then
    perform vault.create_secret('<<<ROTACIONAR_CRON_SECRET>>>', 'cp_cron_secret');
  end if;
end $$;

-- Todo dia às 11:00 UTC = 08:00 em Brasília (o Brasil não usa horário de verão).
-- Para outro horário, mude só o "0 11 * * *" (minuto hora dia mês dia-da-semana, em UTC).
-- Reagenda: remove o job anterior se existir.
select cron.unschedule('cp-alertas-diarios')
where exists (select 1 from cron.job where jobname = 'cp-alertas-diarios');

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
