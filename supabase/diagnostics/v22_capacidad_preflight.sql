-- =====================================================================
-- Revisor Judicial Colombia · Preflight de capacidad V22
-- supabase/diagnostics/v22_capacidad_preflight.sql
-- =====================================================================
--
-- ARCHIVO DE SOLO LECTURA.
--
-- No crea, no modifica y no borra nada. No hay INSERT, UPDATE, DELETE,
-- CREATE, ALTER, DROP, TRUNCATE, GRANT, cron.schedule ni pgmq.send. Se puede
-- ejecutar en producción, en horario laboral, cuantas veces se quiera.
--
-- OBJETIVO
--   Medir la capacidad real de la cola judicial ANTES de escribir la
--   migración V22. Sin estos números, cualquier cifra de "tareas por minuto"
--   es una suposición.
--
-- CÓMO SE USA
--   Supabase → SQL Editor → pegar el archivo completo → Run.
--   Cada bloque numerado devuelve su propia tabla de resultados.
--
-- NOTA SOBRE EL ESQUEMA
--   Este archivo se escribió leyendo el código que ya está en producción
--   (`supabase/functions/procesar-cola-judicial/index.ts` y la migración
--   `20260729_actualizacion_automatica_10am_v21814.sql`), no adivinando
--   nombres. Aun así, las columnas que el código NO garantiza —típicamente
--   `revisiones.duracion_ms` y las marcas de tiempo de auditoría— se leen con
--   `to_jsonb(t) ->> 'columna'`, que devuelve NULL si la columna no existe en
--   lugar de abortar la consulta. El bloque 0 imprime el esquema real: si algo
--   sale NULL donde esperabas un número, contrástalo primero contra ese bloque.
--
-- REQUISITOS
--   Extensiones `pg_cron` y `pgmq` instaladas (los bloques 0.C y 0.D lo
--   confirman antes de que los bloques 1, 2 y 6 las usen).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0.A · Esquema real de las tablas de la cola judicial
--       Ejecuta esto PRIMERO. Es la referencia contra la que se valida
--       todo lo demás.
-- ---------------------------------------------------------------------
select
  c.table_name,
  c.ordinal_position as pos,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    'tareas_consulta',
    'lotes_consulta',
    'procesos',
    'revisiones',
    'errores_consulta',
    'actuaciones'
  )
order by c.table_name, c.ordinal_position;


-- ---------------------------------------------------------------------
-- 0.B · Qué tablas existen realmente
-- ---------------------------------------------------------------------
select
  t.nombre as tabla_esperada,
  (to_regclass('public.' || t.nombre) is not null) as existe
from (
  values
    ('tareas_consulta'),
    ('lotes_consulta'),
    ('procesos'),
    ('revisiones'),
    ('errores_consulta'),
    ('actuaciones'),
    ('profiles')
) as t(nombre)
order by t.nombre;


-- ---------------------------------------------------------------------
-- 0.C · Extensiones necesarias
-- ---------------------------------------------------------------------
select
  e.extname as extension,
  e.extversion as version,
  n.nspname as esquema
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname in ('pg_cron', 'pgmq', 'pg_net', 'http')
order by e.extname;


-- ---------------------------------------------------------------------
-- 0.D · Funciones de la cola y del coordinador que el worker invoca
--       Si alguna falta, el worker V21.8.14 no puede operar.
-- ---------------------------------------------------------------------
select
  n.nspname as esquema,
  p.proname as funcion,
  pg_get_function_identity_arguments(p.oid) as argumentos
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'pgmq')
  and p.proname in (
    'cola_leer_consultas',
    'cola_archivar_consulta',
    'cola_reencolar_tarea',
    'crear_lotes_diarios_automaticos',
    'reconciliar_procesos_sin_tarea_v21814',
    'encolar_proceso_automatico_v21814',
    'actualizar_metricas_lote',
    'crear_lote_consulta',
    'send',
    'read',
    'metrics',
    'archive'
  )
order by n.nspname, p.proname;


-- =====================================================================
-- 1. CRON JOBS INSTALADOS
--    Aquí está la palanca de capacidad actual: la frecuencia y el cuerpo
--    de `procesar-cola-judicial-cada-minuto` determinan cuántas tareas por
--    minuto se despachan.
-- =====================================================================
select
  j.jobid,
  j.jobname,
  j.schedule,
  j.active,
  j.database,
  j.username,
  j.command
from cron.job j
order by j.active desc, j.jobname;


-- ---------------------------------------------------------------------
-- 1.B · Solo los jobs del motor judicial, con el veredicto esperado
-- ---------------------------------------------------------------------
select
  esperado.jobname,
  esperado.schedule_esperado,
  j.jobid,
  j.schedule as schedule_real,
  j.active,
  case
    when j.jobid is null                             then 'FALTA'
    when j.active is not true                        then 'INACTIVO'
    when j.schedule is distinct from
         esperado.schedule_esperado                  then 'HORARIO_DISTINTO'
    else 'OK'
  end as veredicto
from (
  values
    ('crear-lotes-diarios-1000-colombia-v21814', '*/5 15-18 * * *'),
    ('reconciliar-procesos-sin-tarea-v21814',    '2-57/5 * * * *'),
    ('procesar-cola-judicial-cada-minuto',       '* * * * *'),
    -- Heredados: deberían salir como FALTA o INACTIVO.
    ('crear-lotes-diarios-0320-colombia',        null),
    ('enviar-reportes-supabase-cada-10-min',     null)
) as esperado(jobname, schedule_esperado)
left join cron.job j on j.jobname = esperado.jobname
order by esperado.jobname;


-- =====================================================================
-- 2. MÉTRICAS DE LA COLA PGMQ
--    `queue_length` es la fila de espera. `oldest_msg_age_sec` es la
--    métrica de dolor: cuánto lleva esperando lo más viejo sin procesar.
-- =====================================================================
select * from pgmq.metrics('consultas_judiciales');


-- ---------------------------------------------------------------------
-- 2.B · Todas las colas, por si existe alguna cola paralela olvidada
-- ---------------------------------------------------------------------
select * from pgmq.metrics_all();


-- =====================================================================
-- 3. TAREAS AGRUPADAS POR ESTADO
-- =====================================================================
select
  t.estado,
  count(*)                                        as tareas,
  min((to_jsonb(t) ->> 'created_at')::timestamptz) as mas_antigua,
  max((to_jsonb(t) ->> 'created_at')::timestamptz) as mas_reciente,
  count(*) filter (where t.queue_msg_id is not null) as con_mensaje_pgmq,
  count(*) filter (where t.queue_msg_id is null)     as sin_mensaje_pgmq
from public.tareas_consulta t
group by t.estado
order by tareas desc;


-- ---------------------------------------------------------------------
-- 3.B · Tareas por estado SOLO del día civil colombiano en curso
-- ---------------------------------------------------------------------
select
  t.estado,
  count(*) as tareas_hoy_bogota
from public.tareas_consulta t
where ((to_jsonb(t) ->> 'created_at')::timestamptz at time zone 'America/Bogota')::date
      = (now() at time zone 'America/Bogota')::date
group by t.estado
order by tareas_hoy_bogota desc;


-- =====================================================================
-- 4. PROCESOS ACTIVOS
--    Esta es la cifra que define el objetivo de capacidad: hoy ~120,
--    la meta es ~800.
-- =====================================================================
select
  count(*)                                                   as procesos_totales,
  count(*) filter (where p.activo and not p.eliminado)       as activos,
  count(*) filter (where p.activo and not p.eliminado
                     and upper(coalesce(p.fuente, '')) not like '%SAMAI%'
                     and upper(coalesce(p.fuente, '')) not like '%TYBA%'
                     and upper(coalesce(p.estado_consulta, '')) not like '%ASISTIDA%'
                     and upper(coalesce(p.estado_consulta, '')) <> 'REQUIERE_VALIDACION_MANUAL')
                                                             as activos_automaticos,
  count(distinct p.cliente_id) filter (where p.activo and not p.eliminado)
                                                             as clientes_con_procesos
from public.procesos p;


-- ---------------------------------------------------------------------
-- 4.B · Reparto por cliente. El cliente más grande marca el peor caso.
-- ---------------------------------------------------------------------
select
  p.cliente_id,
  count(*) filter (where p.activo and not p.eliminado) as procesos_activos,
  count(*) filter (where p.activo and not p.eliminado
                     and upper(coalesce(p.fuente, '')) not like '%SAMAI%'
                     and upper(coalesce(p.fuente, '')) not like '%TYBA%'
                     and upper(coalesce(p.estado_consulta, '')) not like '%ASISTIDA%'
                     and upper(coalesce(p.estado_consulta, '')) <> 'REQUIERE_VALIDACION_MANUAL')
                                                       as automaticos
from public.procesos p
group by p.cliente_id
order by procesos_activos desc;


-- ---------------------------------------------------------------------
-- 4.C · Procesos por estado_consulta
-- ---------------------------------------------------------------------
select
  p.estado_consulta,
  count(*) as procesos
from public.procesos p
where p.activo = true
  and p.eliminado = false
group by p.estado_consulta
order by procesos desc;


-- =====================================================================
-- 5. LOTES RECIENTES Y SUS ESTADOS
-- =====================================================================
select
  l.id                                   as lote_id,
  l.cliente_id,
  l.estado,
  l.origen,
  l.total,
  l.completados,
  l.pendientes,
  l.errores,
  l.metadata ->> 'fecha_colombia'        as fecha_colombia,
  l.metadata ->> 'programado_diario'     as programado_diario,
  l.metadata ->> 'version'               as version,
  (to_jsonb(l) ->> 'created_at')::timestamptz    as creado,
  (to_jsonb(l) ->> 'finalizado_at')::timestamptz as finalizado,
  -- Cuánto tardó el lote en cerrarse de punta a punta.
  (to_jsonb(l) ->> 'finalizado_at')::timestamptz
    - (to_jsonb(l) ->> 'created_at')::timestamptz as duracion_lote
from public.lotes_consulta l
order by (to_jsonb(l) ->> 'created_at')::timestamptz desc nulls last
limit 50;


-- ---------------------------------------------------------------------
-- 5.B · Lotes de los últimos 7 días agrupados por estado
-- ---------------------------------------------------------------------
select
  l.estado,
  count(*)                                          as lotes,
  sum(l.total)                                      as tareas_totales,
  sum(l.completados)                                as completadas,
  sum(l.pendientes)                                 as pendientes,
  sum(l.errores)                                    as errores
from public.lotes_consulta l
where (to_jsonb(l) ->> 'created_at')::timestamptz > now() - interval '7 days'
group by l.estado
order by lotes desc;


-- ---------------------------------------------------------------------
-- 5.C · Detalle del lote diario de hoy por cliente: la foto que
--       determina si el correo de las 11:00 puede salir.
-- ---------------------------------------------------------------------
select
  l.cliente_id,
  l.id                                as lote_id,
  l.estado                            as estado_lote,
  count(t.id)                         as tareas,
  count(t.id) filter (where t.estado = 'PENDIENTE')             as pendientes,
  count(t.id) filter (where t.estado = 'EN_COLA')               as en_cola,
  count(t.id) filter (where t.estado = 'CONSULTANDO')           as consultando,
  count(t.id) filter (where t.estado = 'REINTENTO_PROGRAMADO')  as reintento,
  count(t.id) filter (where t.estado = 'ERROR_TEMPORAL')        as error_temporal,
  count(t.id) filter (where t.estado = 'COMPLETADA')            as completadas,
  count(t.id) filter (where t.estado = 'ERROR_DEFINITIVO')      as error_definitivo
from public.lotes_consulta l
left join public.tareas_consulta t on t.lote_id = l.id
where coalesce(l.metadata ->> 'programado_diario', 'false') = 'true'
  and l.metadata ->> 'fecha_colombia'
      = to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD')
group by l.cliente_id, l.id, l.estado
order by l.cliente_id;


-- =====================================================================
-- 6. HISTORIAL RECIENTE DE cron.job_run_details
--    Crear lotes · reconciliador · worker.
-- =====================================================================
select
  j.jobname,
  d.status,
  d.start_time,
  d.end_time,
  d.end_time - d.start_time as duracion,
  d.return_message
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname in (
  'crear-lotes-diarios-1000-colombia-v21814',
  'reconciliar-procesos-sin-tarea-v21814',
  'procesar-cola-judicial-cada-minuto'
)
order by d.start_time desc
limit 200;


-- ---------------------------------------------------------------------
-- 6.B · Salud agregada por job en las últimas 24 horas.
--       `ejecuciones` del worker ÷ minutos transcurridos = despachos/min
--       reales. Este es el número que V22 tiene que subir.
-- ---------------------------------------------------------------------
select
  j.jobname,
  count(*)                                              as ejecuciones_24h,
  count(*) filter (where d.status = 'succeeded')        as exitosas,
  count(*) filter (where d.status = 'failed')           as fallidas,
  round(avg(extract(epoch from (d.end_time - d.start_time)))::numeric, 3)
                                                        as duracion_media_seg,
  round(max(extract(epoch from (d.end_time - d.start_time)))::numeric, 3)
                                                        as duracion_max_seg,
  min(d.start_time)                                     as primera,
  max(d.start_time)                                     as ultima
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where d.start_time > now() - interval '24 hours'
group by j.jobname
order by ejecuciones_24h desc;


-- ---------------------------------------------------------------------
-- 6.C · Últimos errores de cron, si los hay
-- ---------------------------------------------------------------------
select
  j.jobname,
  d.start_time,
  d.status,
  d.return_message
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where d.status <> 'succeeded'
  and d.start_time > now() - interval '7 days'
order by d.start_time desc
limit 50;


-- =====================================================================
-- 7. DURACIÓN APROXIMADA DE LAS CONSULTAS RECIENTES
--    El worker escribe `duracion_ms` en `public.revisiones` (medido desde
--    el inicio del handler hasta la respuesta de Apps Script). Es la
--    variable que fija el techo real de concurrencia: si una consulta
--    tarda ~20 s, un worker secuencial no puede pasar de 3/min.
--    Si `duracion_ms` no existiera en tu esquema, estas columnas saldrán
--    NULL en vez de fallar; contrástalo con el bloque 0.A.
-- =====================================================================
select
  count(*)                                                     as revisiones_7d,
  round(avg((to_jsonb(r) ->> 'duracion_ms')::numeric) / 1000, 2)  as media_seg,
  round((percentile_cont(0.50) within group (
          order by (to_jsonb(r) ->> 'duracion_ms')::numeric) / 1000)::numeric, 2) as p50_seg,
  round((percentile_cont(0.90) within group (
          order by (to_jsonb(r) ->> 'duracion_ms')::numeric) / 1000)::numeric, 2) as p90_seg,
  round((percentile_cont(0.99) within group (
          order by (to_jsonb(r) ->> 'duracion_ms')::numeric) / 1000)::numeric, 2) as p99_seg,
  round(max((to_jsonb(r) ->> 'duracion_ms')::numeric) / 1000, 2)  as max_seg
from public.revisiones r
where (to_jsonb(r) ->> 'created_at')::timestamptz > now() - interval '7 days';


-- ---------------------------------------------------------------------
-- 7.B · Duración por día y por resultado. Sirve para ver si los errores
--       son los que consumen el tiempo (timeouts de 90 s).
-- ---------------------------------------------------------------------
select
  ((to_jsonb(r) ->> 'created_at')::timestamptz at time zone 'America/Bogota')::date as dia_bogota,
  r.estado_resultado,
  count(*)                                                       as revisiones,
  round(avg((to_jsonb(r) ->> 'duracion_ms')::numeric) / 1000, 2) as media_seg,
  round(max((to_jsonb(r) ->> 'duracion_ms')::numeric) / 1000, 2) as max_seg
from public.revisiones r
where (to_jsonb(r) ->> 'created_at')::timestamptz > now() - interval '7 days'
group by 1, 2
order by 1 desc, revisiones desc;


-- ---------------------------------------------------------------------
-- 7.C · Rendimiento observado: cuántas revisiones se cerraron por minuto
--       en las franjas más cargadas de los últimos 3 días. Es la medida
--       empírica del "~2 procesos/minuto" que hay que superar.
-- ---------------------------------------------------------------------
select
  date_trunc('minute', (to_jsonb(r) ->> 'created_at')::timestamptz) as minuto_utc,
  count(*) as revisiones_en_ese_minuto
from public.revisiones r
where (to_jsonb(r) ->> 'created_at')::timestamptz > now() - interval '3 days'
group by 1
having count(*) > 0
order by revisiones_en_ese_minuto desc, minuto_utc desc
limit 60;


-- =====================================================================
-- 8. TAREAS PENDIENTES, EN REINTENTO, CONSULTANDO Y EN ERROR
--    Vista compacta para decidir si se puede subir la concurrencia.
-- =====================================================================
select
  count(*) filter (where t.estado = 'PENDIENTE')            as pendientes,
  count(*) filter (where t.estado = 'EN_COLA')              as en_cola,
  count(*) filter (where t.estado = 'CONSULTANDO')          as consultando,
  count(*) filter (where t.estado = 'REINTENTO_PROGRAMADO') as reintento_programado,
  count(*) filter (where t.estado = 'ERROR_TEMPORAL')       as error_temporal,
  count(*) filter (where t.estado = 'ERROR_DEFINITIVO')     as error_definitivo,
  count(*) filter (where t.estado = 'COMPLETADA')           as completadas,
  count(*) filter (where t.estado = 'CANCELADA')            as canceladas,
  count(*) filter (where t.estado in (
    'PENDIENTE', 'EN_COLA', 'CONSULTANDO',
    'REINTENTO_PROGRAMADO', 'ERROR_TEMPORAL'
  ))                                                        as trabajo_vivo
from public.tareas_consulta t;


-- ---------------------------------------------------------------------
-- 8.B · Tareas atascadas en CONSULTANDO. El worker fija la invisibilidad
--       PGMQ en 180 s; una tarea bloqueada mucho más que eso indica una
--       ejecución que murió sin liberar el estado. Es el primer riesgo
--       que se amplifica al subir la concurrencia.
-- ---------------------------------------------------------------------
select
  t.id                                                as tarea_id,
  t.proceso_id,
  t.cliente_id,
  t.estado,
  t.intentos,
  t.max_intentos,
  t.queue_msg_id,
  (to_jsonb(t) ->> 'bloqueada_at')::timestamptz       as bloqueada_at,
  now() - (to_jsonb(t) ->> 'bloqueada_at')::timestamptz as bloqueada_hace,
  t.ultimo_error
from public.tareas_consulta t
where t.estado = 'CONSULTANDO'
order by (to_jsonb(t) ->> 'bloqueada_at')::timestamptz asc nulls first
limit 50;


-- ---------------------------------------------------------------------
-- 8.C · Reparto de intentos. Si muchas tareas llegan a intentos >= 2, el
--       coste real por proceso es mayor que 1 consulta y el cálculo de
--       "800 procesos ÷ N por minuto" se queda corto.
-- ---------------------------------------------------------------------
select
  t.intentos,
  count(*) as tareas,
  count(*) filter (where t.estado = 'COMPLETADA')       as completadas,
  count(*) filter (where t.estado = 'ERROR_DEFINITIVO') as error_definitivo
from public.tareas_consulta t
group by t.intentos
order by t.intentos;


-- ---------------------------------------------------------------------
-- 8.D · Desincronización entre tarea y cola: tareas que se creen encoladas
--       pero no tienen mensaje durable en PGMQ, y al revés. Son las que
--       el reconciliador debe recuperar; si crecen, la concurrencia mayor
--       las multiplicará.
-- ---------------------------------------------------------------------
select
  t.estado,
  count(*) filter (where t.queue_msg_id is null)     as sin_msg_id,
  count(*) filter (where t.queue_msg_id is not null) as con_msg_id
from public.tareas_consulta t
where t.estado in (
  'PENDIENTE', 'EN_COLA', 'CONSULTANDO',
  'REINTENTO_PROGRAMADO', 'ERROR_TEMPORAL'
)
group by t.estado
order by t.estado;


-- ---------------------------------------------------------------------
-- 8.E · Procesos automáticos activos SIN tarea viva. Es exactamente lo
--       que persigue `reconciliar_procesos_sin_tarea_v21814`; si el número
--       no baja entre dos ejecuciones, el reconciliador no está corriendo.
-- ---------------------------------------------------------------------
select count(*) as procesos_automaticos_sin_tarea_activa
from public.procesos p
where p.activo = true
  and p.eliminado = false
  and upper(coalesce(p.fuente, '')) not like '%SAMAI%'
  and upper(coalesce(p.fuente, '')) not like '%TYBA%'
  and upper(coalesce(p.estado_consulta, '')) not like '%ASISTIDA%'
  and upper(coalesce(p.estado_consulta, '')) <> 'REQUIERE_VALIDACION_MANUAL'
  and p.estado_consulta in ('PENDIENTE', 'REINTENTO_PROGRAMADO', 'ERROR_TEMPORAL')
  and not exists (
    select 1
    from public.tareas_consulta t
    where t.proceso_id = p.id
      and t.estado in (
        'PENDIENTE', 'EN_COLA', 'CONSULTANDO',
        'REINTENTO_PROGRAMADO', 'ERROR_TEMPORAL'
      )
  );


-- ---------------------------------------------------------------------
-- 8.F · Errores recientes por tipo. `DEFINITIVO` frente a `TEMPORAL`
--       dice si subir la concurrencia va a multiplicar reintentos contra
--       la fuente judicial.
-- ---------------------------------------------------------------------
select
  e.tipo_error,
  e.reintentable,
  count(*) as errores_7d,
  min(left(e.mensaje, 120)) as ejemplo_mensaje
from public.errores_consulta e
where (to_jsonb(e) ->> 'created_at')::timestamptz > now() - interval '7 days'
group by e.tipo_error, e.reintentable
order by errores_7d desc;


-- =====================================================================
-- 9. VEREDICTO DE CAPACIDAD
--    Traduce lo anterior a la pregunta operativa: con el ritmo observado,
--    ¿cuánto tarda el barrido diario hoy y cuánto tardaría con 800?
-- =====================================================================
with automaticos as (
  select count(*)::numeric as n
  from public.procesos p
  where p.activo = true
    and p.eliminado = false
    and upper(coalesce(p.fuente, '')) not like '%SAMAI%'
    and upper(coalesce(p.fuente, '')) not like '%TYBA%'
    and upper(coalesce(p.estado_consulta, '')) not like '%ASISTIDA%'
    and upper(coalesce(p.estado_consulta, '')) <> 'REQUIERE_VALIDACION_MANUAL'
),
ritmo as (
  -- Tareas realmente terminadas por minuto en la última hora de trabajo.
  select coalesce(
    (select count(*)::numeric
       from public.revisiones r
      where (to_jsonb(r) ->> 'created_at')::timestamptz > now() - interval '1 hour')
    / 60.0, 0) as por_minuto_ultima_hora
)
select
  a.n                                                  as procesos_automaticos_hoy,
  round(r.por_minuto_ultima_hora, 2)                   as tareas_por_minuto_observadas,
  case when r.por_minuto_ultima_hora > 0
       then round(a.n / r.por_minuto_ultima_hora, 1)
  end                                                  as minutos_barrido_hoy,
  round(a.n / 2.0, 1)                                  as minutos_teoricos_a_2_por_min,
  round(a.n / 4.0, 1)                                  as minutos_teoricos_a_4_por_min,
  round(a.n / 6.0, 1)                                  as minutos_teoricos_a_6_por_min,
  round(a.n / 8.0, 1)                                  as minutos_teoricos_a_8_por_min,
  round(800 / 2.0 / 60, 2)                             as horas_800_a_2_por_min,
  round(800 / 4.0 / 60, 2)                             as horas_800_a_4_por_min,
  round(800 / 6.0 / 60, 2)                             as horas_800_a_6_por_min,
  round(800 / 8.0 / 60, 2)                             as horas_800_a_8_por_min
from automaticos a
cross join ritmo r;


-- =====================================================================
-- FIN DEL PREFLIGHT · No se modificó ningún dato.
-- =====================================================================
