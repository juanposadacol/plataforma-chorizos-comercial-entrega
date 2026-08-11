-- =====================================================================
-- ROLLBACK de V22.0 → V21.8.14
-- supabase/rollback/20260812_despachador_judicial_v22_rollback.sql
-- =====================================================================
--
-- ANTES DE EJECUTAR ESTO, CONSIDERA EL ROLLBACK BARATO
--
--   El 90 % de los sustos se resuelven bajando el caudal, sin desinstalar
--   nada y sin perder la telemetría del despachador:
--
--     update public.configuracion_judicial
--        set valor = '2', updated_at = now()
--      where clave = 'despacho_max_workers_por_minuto';
--
--   O deteniendo el despacho por completo, dejando el cron programado:
--
--     update public.configuracion_judicial
--        set valor = 'false', updated_at = now()
--      where clave = 'despacho_activo';
--
--   Ambos surten efecto en el siguiente minuto.
--
-- ESTE ARCHIVO ES EL ROLLBACK TOTAL: deja el sistema idéntico a V21.8.14.
--
-- QUÉ **NO** HAY QUE DESHACER
--   · La Edge Function nunca se modificó → no hay que redesplegarla.
--   · Netlify no cambió → NO hace falta ningún deploy ni gastar créditos.
--   · Apps Script no cambió.
--   · Ninguna fila de procesos, tareas_consulta, lotes_consulta, revisiones
--     ni actuaciones fue reescrita por V22.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Reactivar el despachador original de V21.8.14.
--    La migración V22 lo desactivó sin borrarlo justamente para esto: su
--    `command` sigue intacto en cron.job.
-- ---------------------------------------------------------------------
update cron.job
set active = true
where jobname = 'procesar-cola-judicial-cada-minuto';

-- ---------------------------------------------------------------------
-- 2. Desprogramar el despachador V22.
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

-- ---------------------------------------------------------------------
-- 3. Retirar las piezas de V22.
-- ---------------------------------------------------------------------
drop function if exists public.despachar_cola_judicial_v22();
drop function if exists public.configuracion_judicial_booleano(text, boolean);
drop function if exists public.configuracion_judicial_entero(text, integer, integer, integer);
drop function if exists public.configuracion_judicial_texto(text, text);
drop table if exists public.configuracion_judicial;

commit;

-- ---------------------------------------------------------------------
-- VERIFICACIÓN (solo lectura)
-- ---------------------------------------------------------------------
select jobid, jobname, schedule, active
from cron.job
where jobname in (
  'despachar-cola-judicial-v22',
  'procesar-cola-judicial-cada-minuto',
  'crear-lotes-diarios-1000-colombia-v21814',
  'reconciliar-procesos-sin-tarea-v21814'
)
order by jobname;

-- Esperado tras el rollback:
--   · `despachar-cola-judicial-v22` NO aparece;
--   · `procesar-cola-judicial-cada-minuto` aparece con active = true;
--   · el coordinador diario y el reconciliador siguen activos, intactos.

select to_regclass('public.configuracion_judicial') as debe_ser_null;
