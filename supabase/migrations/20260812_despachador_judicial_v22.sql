-- =====================================================================
-- Revisor Judicial Colombia V22.0
-- Despachador judicial configurable
-- =====================================================================
--
-- PROBLEMA QUE CORRIGE
--
--   El job `procesar-cola-judicial-cada-minuto` invoca al worker un número
--   FIJO de veces por minuto (≈2), tenga la cola 5 tareas o 800. El caudal es
--   constante e independiente de la presión real, así que:
--
--     · con la cola vacía se gastan ~2.880 invocaciones diarias en balde;
--     · con 800 procesos el barrido tarda 6 h 40 min y termina a las 16:40,
--       fuera de la ventana 11:00-15:00 en la que Apps Script puede enviar el
--       correo. Los últimos clientes se quedan sin reporte, en silencio.
--
-- QUÉ HACE ESTA MIGRACIÓN
--
--   Sustituye ese despacho ciego por un coordinador que mira la cola antes de
--   llamar a nadie:
--
--     · si la cola está vacía        → no invoca al worker (ahorra cuota);
--     · si hay trabajo               → invoca least(profundidad, concurrencia);
--     · la concurrencia es una fila de `public.configuracion_judicial`,
--       no un número escrito en el código.
--
--   Objetivo de V22.0: ~4 tareas/minuto. Subir a 6 u 8 después es un UPDATE.
--
-- QUÉ **NO** TOCA (deliberadamente)
--
--   · supabase/functions/procesar-cola-judicial/index.ts — NO se redespliega.
--   · crear_lotes_diarios_automaticos(), el reconciliador y el trigger de alta.
--   · El esquema de tareas_consulta / lotes_consulta / procesos.
--   · La barrera REPORT_REFRESH_PENDING (vive en Netlify).
--   · Apps Script.
--
--   El reclamo de mensajes sigue siendo responsabilidad exclusiva del worker
--   vía `cola_leer_consultas` → `pgmq.read` con visibility timeout. Esta
--   migración NO añade una segunda forma de sacar mensajes de la cola: solo
--   cuenta cuántos hay y llama al worker más veces. Por eso no puede
--   introducir duplicados.
--
-- ROLLBACK
--   supabase/rollback/20260812_despachador_judicial_v22_rollback.sql
--   Rollback inmediato sin desinstalar nada:
--     update public.configuracion_judicial
--        set valor = '2' where clave = 'despacho_max_workers_por_minuto';
--
-- REQUISITOS YA INSTALADOS POR V21
--   pg_cron, pgmq (cola `consultas_judiciales`), pg_net, Supabase Vault con
--   `worker_function_url` y `worker_shared_secret`.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Configuración. Un parámetro por fila; nada de números mágicos.
-- ---------------------------------------------------------------------
create table if not exists public.configuracion_judicial (
  clave        text primary key,
  valor        text not null,
  descripcion  text,
  updated_at   timestamptz not null default now()
);

comment on table public.configuracion_judicial is
  'Parámetros operativos del motor judicial V22. Cambiar la concurrencia es un '
  'UPDATE de una fila: no requiere migración, redespliegue ni recrear cron jobs.';

-- `on conflict do nothing` para que reaplicar la migración NUNCA pise un valor
-- que el operador haya ajustado en producción.
insert into public.configuracion_judicial (clave, valor, descripcion) values
  ('despacho_activo', 'true',
   'Interruptor general del despachador. false detiene el despacho sin desprogramar el cron.'),
  ('despacho_max_workers_por_minuto', '4',
   'Tope de invocaciones del worker por ejecución del despachador. V22.0 arranca en 4. Etapas previstas: 4 -> 6 -> 8.'),
  ('despacho_timeout_ms', '120000',
   'Timeout de cada net.http_post hacia la Edge Function, en milisegundos.')
on conflict (clave) do nothing;

revoke all on table public.configuracion_judicial from public, anon, authenticated;
grant select, update on table public.configuracion_judicial to service_role, postgres;

alter table public.configuracion_judicial enable row level security;

-- ---------------------------------------------------------------------
-- 2. Lectores tipados. Devuelven el valor por defecto si la clave falta o
--    trae basura, para que una fila mal editada no deje la cola parada.
-- ---------------------------------------------------------------------
create or replace function public.configuracion_judicial_texto(
  p_clave text,
  p_defecto text
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(trim(c.valor), '')
       from public.configuracion_judicial c
      where c.clave = p_clave),
    p_defecto
  );
$$;

create or replace function public.configuracion_judicial_entero(
  p_clave text,
  p_defecto integer,
  p_minimo integer default 0,
  p_maximo integer default 60
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_texto text := public.configuracion_judicial_texto(p_clave, p_defecto::text);
  v_valor integer;
begin
  begin
    v_valor := v_texto::integer;
  exception when others then
    v_valor := p_defecto;
  end;
  -- El acotado es la red de seguridad: un '800' escrito por error no puede
  -- lanzar 800 invocaciones simultáneas contra Apps Script.
  return greatest(p_minimo, least(coalesce(v_valor, p_defecto), p_maximo));
end;
$$;

create or replace function public.configuracion_judicial_booleano(
  p_clave text,
  p_defecto boolean
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select upper(public.configuracion_judicial_texto(p_clave, p_defecto::text))
         in ('TRUE', 'T', 'SI', 'SÍ', '1', 'Y', 'YES');
$$;

revoke all on function public.configuracion_judicial_texto(text, text) from public;
revoke all on function public.configuracion_judicial_entero(text, integer, integer, integer) from public;
revoke all on function public.configuracion_judicial_booleano(text, boolean) from public;
grant execute on function public.configuracion_judicial_texto(text, text) to service_role, postgres;
grant execute on function public.configuracion_judicial_entero(text, integer, integer, integer) to service_role, postgres;
grant execute on function public.configuracion_judicial_booleano(text, boolean) to service_role, postgres;

-- ---------------------------------------------------------------------
-- 3. El despachador.
--
--    Nunca lanza excepción: devuelve siempre un jsonb, porque su salida es lo
--    único que queda registrado en cron.job_run_details y un fallo silencioso
--    del despachador es indistinguible de una cola vacía.
-- ---------------------------------------------------------------------
create or replace function public.despachar_cola_judicial_v22()
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq, net, vault
as $$
declare
  v_activo        boolean;
  v_concurrencia  integer;
  v_timeout_ms    integer;
  v_profundidad   bigint;
  v_a_despachar   integer;
  v_url           text;
  v_secreto       text;
  v_invocados     integer := 0;
  i               integer;
begin
  v_activo := public.configuracion_judicial_booleano('despacho_activo', true);
  if not v_activo then
    return jsonb_build_object(
      'ok', true, 'version', '22.0', 'estado', 'DESACTIVADO', 'invocados', 0
    );
  end if;

  v_concurrencia := public.configuracion_judicial_entero(
    'despacho_max_workers_por_minuto', 4, 0, 20
  );
  v_timeout_ms := public.configuracion_judicial_entero(
    'despacho_timeout_ms', 120000, 5000, 300000
  );

  if v_concurrencia < 1 then
    return jsonb_build_object(
      'ok', true, 'version', '22.0', 'estado', 'CONCURRENCIA_CERO', 'invocados', 0
    );
  end if;

  -- Medir ANTES de invocar. Esta es la diferencia con V21.8.14.
  begin
    select m.queue_length
      into v_profundidad
      from pgmq.metrics('consultas_judiciales') m;
  exception when others then
    return jsonb_build_object(
      'ok', false, 'version', '22.0', 'estado', 'COLA_NO_DISPONIBLE',
      'invocados', 0, 'error', sqlerrm
    );
  end;

  -- Cola vacía: no se invoca al worker. Aquí es donde V22 deja de malgastar
  -- las ~2.880 invocaciones diarias que V21.8.14 hacía para nada.
  if coalesce(v_profundidad, 0) <= 0 then
    return jsonb_build_object(
      'ok', true, 'version', '22.0', 'estado', 'COLA_VACIA',
      'profundidad', 0, 'concurrencia', v_concurrencia, 'invocados', 0
    );
  end if;

  -- Nunca más invocaciones que mensajes: con 3 en cola se llama 3 veces,
  -- no `concurrencia` veces.
  v_a_despachar := least(v_profundidad, v_concurrencia)::integer;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'worker_function_url' limit 1;
  select decrypted_secret into v_secreto
    from vault.decrypted_secrets where name = 'worker_shared_secret' limit 1;

  if nullif(trim(coalesce(v_url, '')), '') is null
     or nullif(trim(coalesce(v_secreto, '')), '') is null then
    return jsonb_build_object(
      'ok', false, 'version', '22.0', 'estado', 'FALTAN_SECRETOS_VAULT',
      'profundidad', v_profundidad, 'invocados', 0,
      'detalle', 'Faltan worker_function_url o worker_shared_secret en Vault.'
    );
  end if;

  -- net.http_post es asíncrono: encola la petición y devuelve request_id sin
  -- bloquear. Las N llamadas salen en milisegundos y el worker las atiende en
  -- paralelo; cada una reclama SU mensaje vía pgmq.read con vt=180 s.
  for i in 1..v_a_despachar loop
    begin
      perform net.http_post(
        url     => v_url,
        headers => jsonb_build_object(
                     'content-type', 'application/json',
                     'x-worker-secret', v_secreto
                   ),
        body    => jsonb_build_object(
                     'origen', 'DESPACHADOR_V22',
                     'secuencia', i
                   ),
        timeout_milliseconds => v_timeout_ms
      );
      v_invocados := v_invocados + 1;
    exception when others then
      -- Una llamada fallida no debe cancelar las demás ni abortar el cron.
      null;
    end;
  end loop;

  return jsonb_build_object(
    'ok', v_invocados = v_a_despachar,
    'version', '22.0',
    'estado', 'DESPACHADO',
    'profundidad', v_profundidad,
    'concurrencia', v_concurrencia,
    'invocados', v_invocados,
    'fecha_bogota', to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI:SS')
  );
end;
$$;

revoke all on function public.despachar_cola_judicial_v22() from public;
grant execute on function public.despachar_cola_judicial_v22() to service_role, postgres;

-- ---------------------------------------------------------------------
-- 4. Cron.
--
--    El job de V21.8.14 se DESACTIVA, no se borra: `cron.job.command` conserva
--    el cuerpo original y el rollback es un `active = true`. Borrarlo obligaría
--    a reconstruirlo de memoria, y ese cuerpo no está versionado en el repo.
-- ---------------------------------------------------------------------
do $$
declare
  j bigint;
begin
  for j in
    select jobid from cron.job where jobname = 'despachar-cola-judicial-v22'
  loop
    perform cron.unschedule(j);
  end loop;
end $$;

select cron.schedule(
  'despachar-cola-judicial-v22',
  '* * * * *',
  $$select public.despachar_cola_judicial_v22();$$
);

update cron.job
set active = false
where jobname = 'procesar-cola-judicial-cada-minuto';

commit;

-- ---------------------------------------------------------------------
-- VERIFICACIÓN (solo lectura)
-- ---------------------------------------------------------------------
select clave, valor, descripcion
from public.configuracion_judicial
order by clave;

select jobid, jobname, schedule, active
from cron.job
where jobname in (
  'despachar-cola-judicial-v22',
  'procesar-cola-judicial-cada-minuto',
  'crear-lotes-diarios-1000-colombia-v21814',
  'reconciliar-procesos-sin-tarea-v21814'
)
order by jobname;

-- Esperado: exactamente una fila activa `despachar-cola-judicial-v22` con
-- `* * * * *`, y `procesar-cola-judicial-cada-minuto` presente pero inactivo.
