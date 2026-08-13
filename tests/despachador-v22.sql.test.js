"use strict";

/*
 * Comportamiento REAL del despachador V22 contra un PostgreSQL local.
 *
 * Ejecuta `despachar_cola_judicial_v22()` de verdad y cuenta cuántas veces
 * habría invocado al worker. pg_cron, PGMQ, pg_net y Vault se sustituyen por
 * dobles (`tests/sql/despachador_v22_harness.sql`), de modo que la prueba
 * NUNCA abre una conexión de red ni toca Supabase.
 *
 * Se omite si no hay un PostgreSQL disponible, igual que las demás pruebas
 * del proyecto que dependen de servicios externos. Para ejecutarla:
 *
 *   createdb rj_v22_test
 *   RJ_TEST_PG="postgres://postgres@localhost:5432/rj_v22_test" npm test
 *
 * La base indicada se reinicia en cada ejecución, así que debe ser una base
 * desechable. La prueba se niega a correr contra un host que parezca remoto.
 */

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const HARNESS = path.join(ROOT, "tests/sql/despachador_v22_harness.sql");
const MIGRACION = path.join(
  ROOT,
  "supabase/migrations/20260812_despachador_judicial_v22.sql"
);
const ROLLBACK = path.join(
  ROOT,
  "supabase/rollback/20260812_despachador_judicial_v22_rollback.sql"
);

const PG_URL = process.env.RJ_TEST_PG || "";

function psqlDisponible() {
  try {
    execFileSync("psql", ["--version"], { stdio: "ignore" });
    return true;
  } catch (_) {
    return false;
  }
}

/*
 * Salvaguarda: esta prueba borra y recrea objetos. Solo puede apuntar a una
 * base local desechable, nunca a Supabase ni a ningún host remoto.
 */
function esLocal(url) {
  if (!url) return false;
  if (/supabase\.(co|com|in)/i.test(url)) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "::1", ""].includes(host);
  } catch (_) {
    return false;
  }
}

const habilitada = Boolean(PG_URL) && esLocal(PG_URL) && psqlDisponible();

function psql(sql) {
  return execFileSync("psql", [PG_URL, "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql], {
    encoding: "utf8"
  }).trim();
}

function psqlArchivo(file) {
  return execFileSync("psql", [PG_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", file], {
    encoding: "utf8"
  });
}

/** Fija la profundidad de la cola, limpia el registro de llamadas y despacha. */
function despachar(profundidad) {
  psql(`select pgmq._fijar_profundidad(${profundidad}); select net._reiniciar();`);
  const respuesta = JSON.parse(psql("select public.despachar_cola_judicial_v22();"));
  const invocados = Number(psql("select net._contar();"));
  return { respuesta, invocados };
}

function configurar(clave, valor) {
  psql(
    `update public.configuracion_judicial set valor = '${valor}', updated_at = now() where clave = '${clave}';`
  );
}

test("despachador V22 contra PostgreSQL real", { skip: !habilitada && "RJ_TEST_PG no apunta a un PostgreSQL local disponible" }, async t => {
  // Estado limpio: dobles + migración V22.
  psql("drop schema if exists public cascade; create schema public;");
  psql("drop schema if exists cron cascade; drop schema if exists pgmq cascade;");
  psql("drop schema if exists net cascade; drop schema if exists vault cascade;");
  psqlArchivo(HARNESS);
  psqlArchivo(MIGRACION);

  await t.test("1. cola vacía: no se invoca al worker ni una vez", () => {
    const { respuesta, invocados } = despachar(0);
    assert.equal(respuesta.estado, "COLA_VACIA");
    assert.equal(respuesta.invocados, 0);
    assert.equal(invocados, 0);
  });

  await t.test("2. varias tareas en cola: se despacha la concurrencia configurada", () => {
    const { respuesta, invocados } = despachar(50);
    assert.equal(respuesta.estado, "DESPACHADO");
    assert.equal(respuesta.concurrencia, 4);
    assert.equal(invocados, 4);
  });

  await t.test("3. menos tareas que la concurrencia: no se sobre-invoca", () => {
    assert.equal(despachar(1).invocados, 1);
    assert.equal(despachar(2).invocados, 2);
    assert.equal(despachar(3).invocados, 3);
    assert.equal(despachar(4).invocados, 4);
  });

  await t.test("4. carga objetivo de 800 procesos: sigue acotado a la concurrencia", () => {
    const { respuesta, invocados } = despachar(800);
    assert.equal(respuesta.profundidad, 800);
    assert.equal(invocados, 4);
  });

  await t.test("5. la concurrencia se cambia sin migración ni redespliegue", () => {
    for (const etapa of [4, 6, 8]) {
      configurar("despacho_max_workers_por_minuto", String(etapa));
      const { respuesta, invocados } = despachar(800);
      assert.equal(respuesta.concurrencia, etapa);
      assert.equal(invocados, etapa, `la etapa de ${etapa}/min debe invocar ${etapa} veces`);
    }
    configurar("despacho_max_workers_por_minuto", "4");
  });

  await t.test("6. despacho_activo=false detiene el despacho en seco", () => {
    configurar("despacho_activo", "false");
    const { respuesta, invocados } = despachar(800);
    assert.equal(respuesta.estado, "DESACTIVADO");
    assert.equal(invocados, 0);
    configurar("despacho_activo", "true");
  });

  await t.test("7. una concurrencia absurda queda acotada al tope duro", () => {
    configurar("despacho_max_workers_por_minuto", "999");
    assert.equal(despachar(800).invocados, 20);
    configurar("despacho_max_workers_por_minuto", "4");
  });

  await t.test("8. un valor corrupto cae al defecto en vez de parar la cola", () => {
    configurar("despacho_max_workers_por_minuto", "no-es-un-numero");
    const { respuesta, invocados } = despachar(800);
    assert.equal(respuesta.estado, "DESPACHADO");
    assert.equal(invocados, 4);
    configurar("despacho_max_workers_por_minuto", "4");
  });

  await t.test("9. sin secretos en Vault no se invoca a nadie", () => {
    psql("delete from vault.decrypted_secrets where name = 'worker_shared_secret';");
    const { respuesta, invocados } = despachar(800);
    assert.equal(respuesta.estado, "FALTAN_SECRETOS_VAULT");
    assert.equal(respuesta.ok, false);
    assert.equal(invocados, 0);
    psql(
      "insert into vault.decrypted_secrets values ('worker_shared_secret', 'secreto-de-prueba');"
    );
  });

  await t.test("10. cada invocación lleva la credencial del worker", () => {
    despachar(3);
    const filas = Number(
      psql(
        "select count(*) from net._llamadas where headers->>'x-worker-secret' is not null and url like '%procesar-cola-judicial%';"
      )
    );
    assert.equal(filas, 3);
  });

  await t.test("11. la migración es idempotente y respeta el valor del operador", () => {
    configurar("despacho_max_workers_por_minuto", "6");
    psqlArchivo(MIGRACION);
    assert.equal(
      psql(
        "select valor from public.configuracion_judicial where clave = 'despacho_max_workers_por_minuto';"
      ),
      "6"
    );
    configurar("despacho_max_workers_por_minuto", "4");
  });

  await t.test("12. la migración desactiva el job de V21.8.14 sin borrarlo", () => {
    assert.equal(
      psql(
        "select active from cron.job where jobname = 'procesar-cola-judicial-cada-minuto';"
      ),
      "f"
    );
    assert.equal(
      psql("select active from cron.job where jobname = 'despachar-cola-judicial-v22';"),
      "t"
    );
    // El cuerpo original se conserva: es lo que hace posible el rollback.
    assert.ok(
      psql(
        "select command from cron.job where jobname = 'procesar-cola-judicial-cada-minuto';"
      ).length > 0
    );
  });

  await t.test("13. el rollback restituye exactamente V21.8.14", () => {
    psqlArchivo(ROLLBACK);
    assert.equal(
      psql(
        "select active from cron.job where jobname = 'procesar-cola-judicial-cada-minuto';"
      ),
      "t"
    );
    assert.equal(
      psql("select count(*) from cron.job where jobname = 'despachar-cola-judicial-v22';"),
      "0"
    );
    assert.equal(psql("select to_regclass('public.configuracion_judicial') is null;"), "t");
    assert.equal(
      psql(
        "select count(*) from pg_proc where proname = 'despachar_cola_judicial_v22';"
      ),
      "0"
    );
  });
});

test("el banco de pruebas SQL existe y no abre conexiones de red", () => {
  const harness = fs.readFileSync(HARNESS, "utf8");
  // net.http_post es un doble que solo registra en una tabla.
  assert.match(harness, /create or replace function net\.http_post/);
  assert.match(harness, /insert into net\._llamadas/);
  assert.doesNotMatch(harness, /https?:\/\/(?!proyecto\.supabase\.co)/);
});
