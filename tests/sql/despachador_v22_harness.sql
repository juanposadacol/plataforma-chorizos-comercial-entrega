-- =====================================================================
-- Banco de pruebas del despachador V22 contra un PostgreSQL local.
--
-- Reemplaza pg_cron, pgmq, pg_net y Vault por dobles controlables, de forma
-- que `despachar_cola_judicial_v22()` se pueda ejecutar de verdad y se pueda
-- CONTAR cuántas veces habría invocado al worker.
--
-- No se conecta a Supabase. No sale ni una petición de red: net.http_post es
-- un doble que solo inserta una fila en una tabla de registro.
-- =====================================================================

create schema if not exists cron;
create schema if not exists pgmq;
create schema if not exists net;
create schema if not exists vault;

-- --------- Doble de PGMQ: la profundidad es regulable a voluntad ---------
create table if not exists pgmq._profundidad_simulada (
  queue_name text primary key,
  queue_length bigint not null default 0
);

create or replace function pgmq.metrics(queue_name text)
returns table (
  queue_name text,
  queue_length bigint,
  newest_msg_age_sec integer,
  oldest_msg_age_sec integer,
  total_messages bigint,
  scrape_time timestamptz
)
language sql as $$
  select
    $1,
    coalesce((select p.queue_length from pgmq._profundidad_simulada p
               where p.queue_name = $1), 0),
    10, 120, 0::bigint, now();
$$;

-- --------- Doble de pg_net: registra en vez de llamar ---------
create table if not exists net._llamadas (
  id bigserial primary key,
  url text,
  headers jsonb,
  body jsonb,
  timeout_milliseconds integer,
  creado_at timestamptz default now()
);

create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 5000
)
returns bigint
language plpgsql as $$
declare
  v_id bigint;
begin
  insert into net._llamadas (url, headers, body, timeout_milliseconds)
  values (url, headers, body, timeout_milliseconds)
  returning id into v_id;
  return v_id;
end;
$$;

-- --------- Doble de Vault ---------
create table if not exists vault.decrypted_secrets (
  name text primary key,
  decrypted_secret text
);

-- --------- Doble de pg_cron ---------
create table if not exists cron.job (
  jobid bigserial primary key,
  jobname text unique,
  schedule text,
  active boolean default true,
  database text default 'postgres',
  username text default 'postgres',
  command text
);

create or replace function cron.schedule(p_jobname text, p_schedule text, p_command text)
returns bigint
language plpgsql as $$
declare
  v_id bigint;
begin
  insert into cron.job (jobname, schedule, command)
  values (p_jobname, p_schedule, p_command)
  on conflict (jobname) do update
    set schedule = excluded.schedule,
        command  = excluded.command,
        active   = true
  returning cron.job.jobid into v_id;
  return v_id;
end;
$$;

create or replace function cron.unschedule(jobid bigint)
returns boolean
language plpgsql as $$
begin
  delete from cron.job where cron.job.jobid = $1;
  return true;
end;
$$;

-- --------- Roles que la migración referencia en sus GRANT ---------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;

-- --------- Estado inicial que la migración espera encontrar ---------
insert into vault.decrypted_secrets (name, decrypted_secret) values
  ('worker_function_url',  'https://proyecto.supabase.co/functions/v1/procesar-cola-judicial'),
  ('worker_shared_secret', 'secreto-de-prueba-no-real')
on conflict (name) do nothing;

-- El job de V21.8.14 que la migración debe DESACTIVAR, no borrar.
insert into cron.job (jobname, schedule, command, active) values
  ('procesar-cola-judicial-cada-minuto', '* * * * *',
   'select net.http_post(...) ; select net.http_post(...) ;', true)
on conflict (jobname) do nothing;

insert into pgmq._profundidad_simulada (queue_name, queue_length)
values ('consultas_judiciales', 0)
on conflict (queue_name) do nothing;

-- --------- Utilidades del banco de pruebas ---------
create or replace function pgmq._fijar_profundidad(p_valor bigint)
returns void language sql as $$
  insert into pgmq._profundidad_simulada (queue_name, queue_length)
  values ('consultas_judiciales', p_valor)
  on conflict (queue_name) do update set queue_length = excluded.queue_length;
$$;

create or replace function net._reiniciar()
returns void language sql as $$
  delete from net._llamadas;
$$;

create or replace function net._contar()
returns bigint language sql as $$
  select count(*) from net._llamadas;
$$;
