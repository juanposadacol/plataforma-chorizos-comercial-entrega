"use strict";

/*
 * Contratos del despachador judicial V22.
 *
 * Estas pruebas son estáticas, igual que las de V21.8.11 y V21.8.14: leen el
 * SQL y el worker y comprueban que las garantías siguen escritas donde deben.
 * El comportamiento ejecutable del despachador (cuántas veces invoca al worker
 * según la profundidad de la cola) se verifica en `despachador-v22.sql.test.js`
 * contra un PostgreSQL real.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const MIGRACION_PATH = path.join(
  ROOT,
  "supabase/migrations/20260812_despachador_judicial_v22.sql"
);
const ROLLBACK_PATH = path.join(
  ROOT,
  "supabase/rollback/20260812_despachador_judicial_v22_rollback.sql"
);
const PREFLIGHT_PATH = path.join(
  ROOT,
  "supabase/diagnostics/v22_capacidad_preflight.sql"
);
const WORKER_PATH = path.join(
  ROOT,
  "supabase/functions/procesar-cola-judicial/index.ts"
);
const MIGRACION_V21814_PATH = path.join(
  ROOT,
  "supabase/migrations/20260729_actualizacion_automatica_10am_v21814.sql"
);

const migracion = fs.readFileSync(MIGRACION_PATH, "utf8");
const rollback = fs.readFileSync(ROLLBACK_PATH, "utf8");
const preflight = fs.readFileSync(PREFLIGHT_PATH, "utf8");
const worker = fs.readFileSync(WORKER_PATH, "utf8");
const migracionV21814 = fs.readFileSync(MIGRACION_V21814_PATH, "utf8");

test("1. la concurrencia es configuración, no un número mágico", () => {
  assert.match(migracion, /create table if not exists public\.configuracion_judicial/);
  assert.match(migracion, /'despacho_max_workers_por_minuto', '4'/);
  assert.match(migracion, /'despacho_activo', 'true'/);
  // El despachador debe LEER la concurrencia, nunca llevarla escrita en el for.
  assert.match(
    migracion,
    /v_concurrencia := public\.configuracion_judicial_entero\(\s*'despacho_max_workers_por_minuto'/
  );
  assert.match(migracion, /for i in 1\.\.v_a_despachar loop/);
  assert.doesNotMatch(migracion, /for i in 1\.\.[0-9]+ loop/);
});

test("2. reaplicar la migración no pisa un valor ajustado en producción", () => {
  assert.match(migracion, /on conflict \(clave\) do nothing/);
  assert.doesNotMatch(migracion, /on conflict \(clave\) do update/);
});

test("3. con la cola vacía no se invoca al worker", () => {
  assert.match(migracion, /if coalesce\(v_profundidad, 0\) <= 0 then/);
  const vacia = migracion.indexOf("'COLA_VACIA'");
  const bucle = migracion.indexOf("for i in 1..v_a_despachar loop");
  assert.ok(vacia > -1, "debe existir el estado COLA_VACIA");
  assert.ok(
    vacia < bucle,
    "el retorno por cola vacía debe ocurrir ANTES del bucle de invocación"
  );
});

test("4. nunca se invoca más veces que mensajes hay en la cola", () => {
  assert.match(
    migracion,
    /v_a_despachar := least\(v_profundidad, v_concurrencia\)::integer/
  );
});

test("5. se mide la cola antes de despachar, no después", () => {
  const medicion = migracion.indexOf("pgmq.metrics('consultas_judiciales')");
  const bucle = migracion.indexOf("for i in 1..v_a_despachar loop");
  assert.ok(medicion > -1, "debe consultarse pgmq.metrics");
  assert.ok(medicion < bucle, "la medición debe preceder al despacho");
});

test("6. un valor corrupto o absurdo queda acotado y no tumba la cola", () => {
  assert.match(migracion, /return greatest\(p_minimo, least\(coalesce\(v_valor, p_defecto\), p_maximo\)\)/);
  assert.match(migracion, /exception when others then\s*\n\s*v_valor := p_defecto;/);
  // El tope duro impide que un '999' mal tecleado dispare 999 invocaciones.
  assert.match(migracion, /'despacho_max_workers_por_minuto', 4, 0, 20/);
});

test("7. el despachador no lanza excepción: siempre devuelve jsonb", () => {
  assert.match(migracion, /returns jsonb/);
  for (const estado of [
    "DESACTIVADO",
    "CONCURRENCIA_CERO",
    "COLA_NO_DISPONIBLE",
    "COLA_VACIA",
    "FALTAN_SECRETOS_VAULT",
    "DESPACHADO"
  ]) {
    assert.match(
      migracion,
      new RegExp(`'${estado}'`),
      `falta el estado ${estado} en la respuesta del despachador`
    );
  }
  // Una llamada HTTP fallida no puede cancelar las demás.
  assert.match(migracion, /exception when others then\s*\n\s*--[^\n]*\n\s*null;/);
});

test("8. los secretos siguen en Vault y nunca en la tabla de configuración", () => {
  assert.match(migracion, /from vault\.decrypted_secrets where name = 'worker_function_url'/);
  assert.match(migracion, /from vault\.decrypted_secrets where name = 'worker_shared_secret'/);
  assert.match(migracion, /'x-worker-secret', v_secreto/);
  // Si faltan, no se invoca a nadie.
  assert.match(migracion, /'FALTAN_SECRETOS_VAULT'/);
  const insertConfig = migracion.slice(
    migracion.indexOf("insert into public.configuracion_judicial"),
    migracion.indexOf("on conflict (clave) do nothing")
  );
  assert.doesNotMatch(insertConfig, /secret|token|key|url/i);
});

test("9. la tabla de configuración no queda expuesta al navegador", () => {
  assert.match(
    migracion,
    /revoke all on table public\.configuracion_judicial from public, anon, authenticated/
  );
  assert.match(migracion, /alter table public\.configuracion_judicial enable row level security/);
  assert.match(
    migracion,
    /grant select, update on table public\.configuracion_judicial to service_role, postgres/
  );
});

test("10. el job de V21.8.14 se desactiva pero NO se borra (ruta de rollback)", () => {
  assert.match(
    migracion,
    /update cron\.job\s*\nset active = false\s*\nwhere jobname = 'procesar-cola-judicial-cada-minuto'/
  );
  assert.doesNotMatch(
    migracion,
    /unschedule[\s\S]{0,200}procesar-cola-judicial-cada-minuto/
  );
  assert.match(migracion, /select cron\.schedule\(\s*\n?\s*'despachar-cola-judicial-v22',\s*\n?\s*'\* \* \* \* \*'/);
});

test("11. el rollback devuelve el sistema exactamente a V21.8.14", () => {
  assert.match(
    rollback,
    /update cron\.job\s*\nset active = true\s*\nwhere jobname = 'procesar-cola-judicial-cada-minuto'/
  );
  assert.match(rollback, /drop function if exists public\.despachar_cola_judicial_v22\(\)/);
  assert.match(rollback, /drop table if exists public\.configuracion_judicial/);
  assert.match(rollback, /unschedule/);
  // El rollback barato debe estar documentado en el propio archivo.
  assert.match(rollback, /despacho_max_workers_por_minuto/);
});

test("12. REGRESIÓN V21.8.14: el worker no fue modificado", () => {
  // Una tarea por invocación, con reclamo atómico y visibilidad de 180 s.
  assert.match(worker, /const WORKER_VERSION = "V21\.8\.14"/);
  assert.match(worker, /p_cantidad: 1/);
  assert.match(worker, /p_visibilidad_segundos: 180/);
  assert.match(worker, /supabase\.rpc\("cola_leer_consultas"/);
  assert.match(worker, /supabase\.rpc\("cola_reencolar_tarea"/);
  assert.match(worker, /cola_archivar_consulta/);
});

test("13. REGRESIÓN V21.8.14: idempotencia y anti-duplicado intactos", () => {
  // Una tarea ya finalizada se archiva sin volver a consultar la fuente.
  assert.match(
    worker,
    /\["COMPLETADA", "ERROR_DEFINITIVO", "CANCELADA"\]\.includes\(upper\(task\.estado\)\)/
  );
  // Las actuaciones se deduplican por (proceso_id, hash_contenido).
  assert.match(worker, /onConflict: "proceso_id,hash_contenido", ignoreDuplicates: true/);
  // Una sola tarea viva por proceso dentro del lote.
  assert.match(migracionV21814, /tareas_lote_proceso_uk/);
  assert.match(migracionV21814, /lotes_consulta_diario_cliente_fecha_v21814_uk/);
});

test("14. REGRESIÓN V21.8.14: reintentos y backoff intactos", () => {
  assert.match(
    worker,
    /Math\.min\(900, 60 \* \(2 \*\* Math\.max\(0, attempt - 1\)\)\)/
  );
  assert.match(worker, /attempt >= Number\(task\.max_intentos \?\? 3\)/);
  assert.match(worker, /estado: "ERROR_TEMPORAL"/);
  assert.match(worker, /estado: "ERROR_DEFINITIVO"/);
  // El multirregistro heredado sigue sin consumir intento.
  assert.match(worker, /const attemptsForQueue = duplicateLegacy \? Math\.max\(0, attempt - 1\) : attempt/);
});

test("15. V22 no toca el coordinador diario, el reconciliador ni el trigger", () => {
  for (const funcion of [
    "crear_lotes_diarios_automaticos",
    "reconciliar_procesos_sin_tarea_v21814",
    "encolar_proceso_automatico_v21814",
    "trg_encolar_proceso_nuevo_v21814"
  ]) {
    assert.doesNotMatch(
      migracion,
      new RegExp(`create or replace function public\\.${funcion}`),
      `V22 no debe redefinir ${funcion}`
    );
  }
  // Tampoco debe alterar el esquema de las tablas de la cola.
  assert.doesNotMatch(migracion, /alter table public\.(tareas_consulta|lotes_consulta|procesos)/);
  assert.doesNotMatch(migracion, /drop (table|function|trigger)/i);
});

test("16. V22 no reclama mensajes: ese sigue siendo trabajo del worker", () => {
  // El despachador solo MIDE la cola. Si leyera mensajes habría dos rutas de
  // reclamo y sí podrían aparecer duplicados.
  assert.match(migracion, /pgmq\.metrics\('consultas_judiciales'\)/);
  assert.doesNotMatch(migracion, /pgmq\.read\s*\(/);
  assert.doesNotMatch(migracion, /pgmq\.pop\s*\(/);
  assert.doesNotMatch(migracion, /pgmq\.send\s*\(/);
  assert.doesNotMatch(migracion, /pgmq\.delete\s*\(/);
});

test("17. el preflight de capacidad es estrictamente de solo lectura", () => {
  /*
   * Se comprueba el SQL ejecutable, no la prosa: la cabecera del preflight
   * enumera en un comentario las palabras que promete no usar, y sin quitar
   * los comentarios esa promesa se leería como una infracción.
   */
  const sinComentarios = preflight
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
  const prohibidos = [
    /\binsert\s+into\b/i,
    /\bupdate\s+\w+\s+set\b/i,
    /\bdelete\s+from\b/i,
    /\bcreate\s+(table|function|index|trigger|schema)\b/i,
    /\bdrop\s+/i,
    /\balter\s+table\b/i,
    /\btruncate\b/i,
    /\bgrant\b/i,
    /cron\.schedule/i,
    /cron\.unschedule/i,
    /pgmq\.send/i
  ];
  for (const patron of prohibidos) {
    assert.doesNotMatch(
      sinComentarios,
      patron,
      `el preflight no puede contener ${patron}`
    );
  }
  assert.match(sinComentarios, /pgmq\.metrics\('consultas_judiciales'\)/);
  assert.match(sinComentarios, /from cron\.job_run_details/);
});
