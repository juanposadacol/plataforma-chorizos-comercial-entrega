# Monitor de actividad y disponibilidad de Supabase

Documento operativo del workflow `.github/workflows/supabase-keepalive.yml`.
Está dirigido a quien administra la infraestructura técnica, **no al vendedor**.

## 1. Propósito

El proyecto Supabase del plan Free puede pausarse tras un período prolongado sin
actividad. El workflow hace, tres veces por semana, **una sola consulta de solo
lectura** contra la API REST del proyecto. Con eso persigue dos objetivos:

1. **Actividad legítima.** La llamada es exactamente la misma que hace la tienda
   pública cuando un visitante abre el catálogo. No es tráfico artificial ni un
   truco contra los términos del servicio.
2. **Monitoreo.** Si Supabase deja de responder (proyecto pausado, credenciales
   rotadas, RPC eliminada, caída del servicio), el workflow falla y GitHub envía
   una notificación por correo al dueño del repositorio. Es una alarma temprana
   antes de que el vendedor descubra la falla frente a un cliente.

La automatización **no** modifica pedidos, clientes, pagos, inventario, costos ni
ningún otro dato productivo.

## 2. Advertencia: es una solución de mejor esfuerzo

Supabase **no garantiza oficialmente** que la actividad automatizada impida la
pausa de un proyecto Free. Los criterios de pausa los define Supabase y pueden
cambiar sin aviso.

Por lo tanto:

- Este workflow es un **mecanismo de actividad y monitoreo de mejor esfuerzo**.
- **No es una garantía de disponibilidad ni un sustituto de un plan de pago.**
- La **única garantía oficial** contra pausas por inactividad es el plan **Supabase
  Pro**. Si la tienda pasa a ser el canal de ventas principal, la recomendación
  técnica es migrar a Pro y conservar este workflow únicamente como monitoreo.

## 3. Calendario de ejecución

| Concepto | Valor |
| --- | --- |
| Cron (UTC) | `17 14 * * 1,3,6` |
| Días | lunes, miércoles y sábado |
| Hora UTC | 14:17 |
| Hora Colombia (UTC-5) | 09:17 a. m. aprox. |
| Ejecución manual | sí, mediante `workflow_dispatch` |
| Rama | únicamente la rama predeterminada (`main`) |
| Timeout | 5 minutos |
| Ejecuciones simultáneas | bloqueadas por `concurrency` |

Colombia no aplica horario de verano, así que la hora local no se desplaza a lo
largo del año. GitHub Actions **no garantiza puntualidad exacta** en los cron:
retrasos de varios minutos, y ocasionalmente de más de una hora en momentos de
alta carga, son normales y no indican falla.

> GitHub deshabilita automáticamente los cron de repositorios **públicos** sin
> actividad durante unos 60 días. Si eso ocurre, GitHub avisa por correo y basta
> con reactivar el workflow desde la pestaña **Actions**.

## 4. Qué consulta exactamente

```
POST {SUPABASE_URL}/rest/v1/rpc/get_catalog_prices
Headers: apikey: {SUPABASE_PUBLISHABLE_KEY}
         Content-Type: application/json
Body: {}
```

La clave pública se envía **solamente** en el header `apikey`. El workflow **no**
manda `Authorization: Bearer`: las publishable keys de Supabase
(`sb_publishable_...`) no son JWT, y ese header está reservado para el token de
sesión de un usuario autenticado, que aquí no existe. Sin sesión, la petición se
ejecuta con el rol de base de datos `anon`.

`public.get_catalog_prices()` está definida en
`supabase/migrations/202607170002_transactional_api.sql` y verificada como
segura para este uso:

- Es `language sql` y `stable`: PostgreSQL prohíbe escrituras en una función
  declarada `stable`.
- Solo ejecuta `select` sobre `products`, `categories` y las tablas de precios.
- Tiene `grant execute ... to anon`, confirmado y protegido por la migración
  `202607180007_harden_anon_default_privileges.sql`.
- No inserta auditoría, no toca inventario, no crea pedidos y no dispara
  notificaciones.
- Sin sesión de usuario, `current_customer_id()` devuelve `null` y la RPC
  entrega precios públicos: no expone datos de ningún cliente.

Si en el futuro esta RPC cambia de comportamiento, hay que revisar este
documento antes de conservar el workflow.

## 5. Secretos requeridos

Se usan exclusivamente dos secretos de repositorio. Sus valores **nunca** se
escriben en el YAML ni se imprimen en los registros.

| Secreto | Contenido |
| --- | --- |
| `SUPABASE_URL` | `https://<referencia-del-proyecto>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Clave **publishable** del proyecto; normalmente empieza por `sb_publishable_` |

Es la misma clave pública que ya consume el frontend a través de sus variables
`VITE_` (ver `.env.example` y `src/lib/env.ts`) y que, por diseño, viaja al
navegador de cualquier visitante de la tienda.

### Cómo agregarlos

1. Abrir el repositorio en GitHub.
2. **Settings → Secrets and variables → Actions**.
3. Pestaña **Secrets** → botón **New repository secret**.
4. Crear `SUPABASE_URL` con la URL del proyecto (sin barra final).
5. Repetir con `SUPABASE_PUBLISHABLE_KEY` y la clave publishable.

Los valores se obtienen en Supabase: **Project Settings → API Keys → Project URL**
y la clave marcada como **publishable** (`sb_publishable_...`). En proyectos
antiguos que aún no migraron al nuevo formato, el equivalente es la clave legada
`anon` / `public`, un JWT que empieza por `eyJ`; el workflow funciona con ambas
porque envía la clave en el header `apikey`.

### Qué significa "publishable"

- Es una clave **pública y de bajos privilegios**: está pensada para publicarse
  en el navegador y no otorga por sí misma acceso a nada.
- **La seguridad real no la aporta la clave**, sino las políticas **RLS** y los
  **`GRANT`** de PostgreSQL. Con esta clave, la petición corre como el rol `anon`,
  que en este proyecto solo puede ejecutar tres funciones
  (`get_catalog_prices`, `get_public_settings`, `get_order_tracking`), tal como
  fija la migración `202607180007_harden_anon_default_privileges.sql`.
- Se envía **únicamente** en el header `apikey`, nunca como `Authorization: Bearer`.

### Prohibido: claves secretas

**Nunca** se deben usar en este workflow —ni en ningún otro flujo de GitHub
Actions de este repositorio— las siguientes credenciales:

- una **secret key** `sb_secret_...`;
- la clave legada **`service_role`**;
- la **contraseña de la base de datos** ni una cadena de conexión directa.

Todas ellas ignoran RLS y permiten leer y modificar todos los datos, incluidos
clientes, pedidos y pagos. Ninguna hace falta para una lectura del catálogo
público. Si alguna se filtra en un log público, hay que rotarla de inmediato
desde Supabase.

## 6. Ejecución manual

1. Ir a la pestaña **Actions** del repositorio.
2. En la lista lateral, seleccionar **Supabase Keep Alive**.
3. Pulsar **Run workflow** (arriba a la derecha).
4. Dejar la rama en `main` (el job se omite en cualquier otra rama).
5. Confirmar con **Run workflow** y esperar unos segundos a que aparezca la
   ejecución en la lista.

## 7. Cómo comprobar que una ejecución fue exitosa

1. **Actions → Supabase Keep Alive**: la ejecución debe mostrar un check verde.
2. Abrir la ejecución, entrar al job `keepalive` y desplegar el paso
   *Read public catalog*.
3. Debe verse algo como:

```
Supabase read-only check succeeded with HTTP 200
Checked at UTC: 2026-07-29T14:17:32Z
```

El registro solo muestra el resultado, el código HTTP y la fecha UTC. No imprime
la clave, la URL con credenciales, el catálogo, ni datos de clientes, pedidos o
pagos: la respuesta se guarda en un archivo temporal que se borra al terminar.

## 8. Qué hacer si falla

Un check rojo significa que la API de Supabase no respondió correctamente. El
mensaje del log indica el caso:

| Mensaje | Causa probable | Acción |
| --- | --- | --- |
| `Missing SUPABASE_URL` / `Missing SUPABASE_PUBLISHABLE_KEY` | El secreto no existe o está vacío | Recrear el secreto (sección 5) |
| `transport error (curl exit N)` | DNS, red o Supabase no alcanzable tras 3 reintentos | Reintentar manualmente; si persiste, revisar el estado del proyecto en Supabase |
| `HTTP 401` / `HTTP 403` | Publishable key revocada o mal copiada, o el rol `anon` perdió `execute` sobre la RPC | Regenerar/actualizar `SUPABASE_PUBLISHABLE_KEY`; verificar los `grant` de la migración `202607180007` |
| `HTTP 404` | La RPC `get_catalog_prices` no existe en ese proyecto, o la URL apunta al proyecto equivocado | Verificar `SUPABASE_URL` y que las migraciones estén aplicadas |
| `HTTP 5xx` | Incidente de Supabase o proyecto pausado | Consultar `status.supabase.com` y el panel del proyecto; reanudar si aparece pausado |

Comprobación cruzada rápida: abrir la tienda pública en el navegador. Si el
catálogo tampoco carga, la falla es real y afecta al vendedor; si el catálogo
carga bien, lo más probable es un problema de credenciales del workflow.

Ante una falla verdadera lo primero es **reanudar el proyecto en Supabase**
(*Restore project* en el panel). Nunca hay que resolver un fallo de este workflow
ejecutando migraciones, `supabase db push` ni despliegues.

## 9. Responsabilidad: el cliente final no administra esto

El vendedor **no debe** administrar Supabase, GitHub ni Netlify, ni crear
secretos, ni interpretar los correos de fallo de GitHub Actions. Su única
interacción con el sistema es la tienda y el panel administrativo de la
aplicación.

Toda la operación descrita en este documento corresponde al responsable técnico
del proyecto. Si esa responsabilidad cambia de persona, hay que traspasar el
acceso al repositorio y al proyecto de Supabase, y revisar este documento.
