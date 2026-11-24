-- =====================================================================
-- Controle de Pagamentos — Schema Supabase (PostgreSQL)
--
-- Como usar: Supabase → SQL Editor → New query → cole TUDO → Run.
-- Pode ser executado mais de uma vez sem problemas.
--
-- Segurança: todas as tabelas têm Row Level Security (RLS). Cada usuário só
-- enxerga e altera os próprios dados; a chave publicável (pública) do
-- navegador não consegue ler nada de outros usuários.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Cálculo do próximo vencimento (usado ao "Marcar como Pago")
--    semanal: +7 dias
--    mensal : mesmo dia do mês seguinte (usa o "dia âncora": 31/jan -> 28/fev -> 31/mar)
--    anual  : mesmo dia/mês do ano seguinte (29/fev cai em 28/fev nos anos não bissextos)
-- ---------------------------------------------------------------------
create or replace function public.proximo_vencimento_ciclo(p_data date, p_ciclo text, p_ancora integer)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_primeiro date;
  v_dias integer;
begin
  if p_ciclo = 'semanal' then
    return p_data + 7;
  elsif p_ciclo = 'mensal' then
    v_primeiro := (date_trunc('month', p_data::timestamp) + interval '1 month')::date;
  elsif p_ciclo = 'anual' then
    v_primeiro := make_date(extract(year from p_data)::integer + 1, extract(month from p_data)::integer, 1);
  else
    raise exception 'Ciclo desconhecido: %', p_ciclo;
  end if;

  v_dias := extract(day from (v_primeiro + interval '1 month' - interval '1 day'))::integer;
  return v_primeiro + (least(coalesce(p_ancora, extract(day from p_data)::integer), v_dias) - 1);
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Contas, boletos e assinaturas (RF02)
-- ---------------------------------------------------------------------
create table if not exists public.contas (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome                text not null check (char_length(btrim(nome)) between 1 and 100),
  categoria           text not null check (char_length(btrim(categoria)) between 1 and 50),
  valor               numeric(10,2) not null check (valor > 0),
  ciclo               text not null default 'mensal' check (ciclo in ('mensal', 'anual', 'semanal')),
  proximo_vencimento  date not null,
  -- dia do mês original do vencimento (preenchido pelo gatilho abaixo)
  dia_ancora          smallint not null default 1 check (dia_ancora between 1 and 31),
  ativa               boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists contas_user_idx on public.contas (user_id);
create index if not exists contas_vencimento_idx on public.contas (proximo_vencimento) where ativa;

create or replace function public.contas_antes_de_gravar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nome := btrim(new.nome);
  new.categoria := btrim(new.categoria);

  if tg_op = 'INSERT' then
    new.dia_ancora := extract(day from new.proximo_vencimento)::smallint;
  else
    new.user_id := old.user_id;        -- o dono nunca muda
    new.created_at := old.created_at;
    -- Se o usuário trocou a data na mão, a âncora acompanha.
    -- Quando é a função pagar_conta avançando o ciclo, a âncora é preservada.
    if new.proximo_vencimento is distinct from old.proximo_vencimento
       and coalesce(current_setting('app.avancando_ciclo', true), '') <> 'on' then
      new.dia_ancora := extract(day from new.proximo_vencimento)::smallint;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists contas_antes_de_gravar on public.contas;
create trigger contas_antes_de_gravar
  before insert or update on public.contas
  for each row execute function public.contas_antes_de_gravar();

alter table public.contas enable row level security;

drop policy if exists contas_select on public.contas;
drop policy if exists contas_insert on public.contas;
drop policy if exists contas_update on public.contas;
drop policy if exists contas_delete on public.contas;

create policy contas_select on public.contas for select to authenticated
  using (user_id = (select auth.uid()));
create policy contas_insert on public.contas for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy contas_update on public.contas for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy contas_delete on public.contas for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.contas from anon;
revoke all on public.contas from authenticated;
grant select, delete on public.contas to authenticated;
grant insert (nome, categoria, valor, ciclo, proximo_vencimento) on public.contas to authenticated;
grant update (nome, categoria, valor, ciclo, proximo_vencimento, ativa) on public.contas to authenticated;
grant all on public.contas to service_role;

-- ---------------------------------------------------------------------
-- 3) Histórico de baixas ("Marcar como Pago")
-- ---------------------------------------------------------------------
create table if not exists public.pagamentos (
  id               bigint generated always as identity primary key,
  conta_id         bigint not null references public.contas (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  valor_pago       numeric(10,2) not null,
  data_vencimento  date not null,
  pago_em          timestamptz not null default now()
);

create index if not exists pagamentos_conta_idx on public.pagamentos (conta_id, pago_em desc);
create index if not exists pagamentos_user_idx on public.pagamentos (user_id, pago_em desc);

alter table public.pagamentos enable row level security;
drop policy if exists pagamentos_select on public.pagamentos;
create policy pagamentos_select on public.pagamentos for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.pagamentos from anon;
revoke all on public.pagamentos from authenticated;
grant select on public.pagamentos to authenticated;   -- escrita só pela função pagar_conta
grant all on public.pagamentos to service_role;

-- ---------------------------------------------------------------------
-- 4) Marcar como Pago: registra a baixa e avança o vencimento (numa transação)
--    Erros "PTxxx" viram HTTP xxx na API do Supabase (PT404 -> 404, PT409 -> 409).
-- ---------------------------------------------------------------------
create or replace function public.pagar_conta(p_conta_id bigint, p_vencimento_atual date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_conta public.contas%rowtype;
  v_novo date;
begin
  if v_uid is null then
    raise exception 'Autenticação necessária.' using errcode = 'PT401';
  end if;

  select * into v_conta
    from public.contas
   where id = p_conta_id and user_id = v_uid
     for update;

  if not found then
    raise exception 'Conta não encontrada.' using errcode = 'PT404';
  end if;
  if not v_conta.ativa then
    raise exception 'Conta pausada. Reative-a antes de dar baixa.' using errcode = 'PT409';
  end if;
  -- Evita pagar duas vezes (duplo clique ou tela desatualizada)
  if p_vencimento_atual is not null and p_vencimento_atual <> v_conta.proximo_vencimento then
    raise exception 'Esta conta já foi atualizada. Recarregue a lista.' using errcode = 'PT409';
  end if;

  insert into public.pagamentos (conta_id, user_id, valor_pago, data_vencimento)
  values (v_conta.id, v_uid, v_conta.valor, v_conta.proximo_vencimento);

  v_novo := public.proximo_vencimento_ciclo(v_conta.proximo_vencimento, v_conta.ciclo, v_conta.dia_ancora);

  perform set_config('app.avancando_ciclo', 'on', true);   -- só nesta transação
  update public.contas set proximo_vencimento = v_novo where id = v_conta.id;
  perform set_config('app.avancando_ciclo', 'off', true);

  return jsonb_build_object(
    'conta', jsonb_build_object('id', v_conta.id, 'proximo_vencimento', v_novo),
    'pagamento', jsonb_build_object('valor_pago', v_conta.valor, 'vencimento_quitado', v_conta.proximo_vencimento)
  );
end;
$$;

revoke all on function public.pagar_conta(bigint, date) from public, anon;
grant execute on function public.pagar_conta(bigint, date) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Inscrições Web Push (um usuário pode ter vários aparelhos)
--    Sem acesso direto pelo navegador: tudo passa pelas funções abaixo.
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth_key    text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;   -- sem policies: só funções e service_role
revoke all on public.push_subscriptions from anon;
revoke all on public.push_subscriptions from authenticated;
grant all on public.push_subscriptions to service_role;

-- Só serviços push oficiais; uma inscrição não muda de dono automaticamente.
create or replace function public.registrar_push(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_host text;
begin
  if v_uid is null then
    raise exception 'Autenticação necessária.' using errcode = 'PT401';
  end if;

  v_host := lower(substring(p_endpoint from '^https://([^/:?#]+)'));
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 2048
     or p_endpoint ~ '^https://[^/]+:[0-9]+'
     or v_host is null
     or not (
       v_host in ('fcm.googleapis.com', 'updates.push.services.mozilla.com',
                  'web.push.apple.com', 'api.push.apple.com')
       or v_host like '%.notify.windows.com'
     )
     or coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]+$' or char_length(p_p256dh) > 255
     or coalesce(p_auth, '') !~ '^[A-Za-z0-9_-]+$' or char_length(p_auth) > 255 then
    raise exception 'Inscrição push inválida.' using errcode = 'PT400';
  end if;

  if exists (
    select 1 from public.push_subscriptions
    where endpoint = p_endpoint and user_id <> v_uid
  ) then
    raise exception 'Inscrição já vinculada a outro usuário.' using errcode = 'PT409';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 255))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth_key = excluded.auth_key,
        user_agent = excluded.user_agent;
end;
$$;

create or replace function public.remover_push(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Autenticação necessária.' using errcode = 'PT401';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = v_uid;
end;
$$;

revoke all on function public.registrar_push(text, text, text, text) from public, anon;
revoke all on function public.remover_push(text) from public, anon;
grant execute on function public.registrar_push(text, text, text, text) to authenticated;
grant execute on function public.remover_push(text) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Controle de alertas já enviados (RN02) — evita notificação duplicada
--    'vespera' = vence amanhã; 'dia' = vence hoje
-- ---------------------------------------------------------------------
create table if not exists public.notificacoes_enviadas (
  id               bigint generated always as identity primary key,
  conta_id         bigint not null references public.contas (id) on delete cascade,
  tipo             text not null check (tipo in ('vespera', 'dia')),
  data_vencimento  date not null,
  enviada_em       timestamptz not null default now(),
  unique (conta_id, tipo, data_vencimento)
);

alter table public.notificacoes_enviadas enable row level security;   -- sem policies: só service_role
revoke all on public.notificacoes_enviadas from anon;
revoke all on public.notificacoes_enviadas from authenticated;
grant all on public.notificacoes_enviadas to service_role;

-- Chamada só pela Edge Function "alertas" (chave secreta). Em uma única operação:
-- acha as contas ativas que vencem hoje/amanhã, "reserva" cada uma (se já foi avisada,
-- é ignorada) e devolve só as recém-reservadas. Também apaga reservas com mais de 60 dias.
create or replace function public.reservar_alertas(p_hoje date)
returns table (
  r_user_id uuid,
  r_tipo text,
  r_conta_id bigint,
  r_nome text,
  r_valor numeric,
  r_data_vencimento date
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notificacoes_enviadas n where n.data_vencimento < p_hoje - 60;

  return query
  with candidatas as (
    select c.id as cid, c.user_id as uid, c.nome as cnome, c.valor as cvalor,
           c.proximo_vencimento as cvenc,
           case when c.proximo_vencimento = p_hoje then 'dia' else 'vespera' end as ctipo
      from public.contas c
     where c.ativa and c.proximo_vencimento in (p_hoje, p_hoje + 1)
  ),
  reservadas as (
    insert into public.notificacoes_enviadas (conta_id, tipo, data_vencimento)
    select k.cid, k.ctipo, k.cvenc from candidatas k
    on conflict (conta_id, tipo, data_vencimento) do nothing
    returning conta_id as rid, tipo as rtipo
  )
  select k.uid, k.ctipo, k.cid, k.cnome, k.cvalor, k.cvenc
    from reservadas r
    join candidatas k on k.cid = r.rid and k.ctipo = r.rtipo
   order by k.uid, k.ctipo, k.cnome;
end;
$$;

revoke all on function public.reservar_alertas(date) from public, anon, authenticated;
grant execute on function public.reservar_alertas(date) to service_role;
