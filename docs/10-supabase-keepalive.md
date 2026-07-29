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
Body: {}
```

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
| `SUPABASE_ANON_KEY` | Clave pública `anon` del proyecto |

Son los mismos valores que ya usa el frontend (`VITE_SUPABASE_URL` y
`VITE_SUPABASE_ANON_KEY`), que por diseño viajan al navegador de cualquier
visitante. La clave `anon` está limitada por RLS y por los `grant` de la base de
datos.

### Cómo agregarlos

1. Abrir el repositorio en GitHub.
2. **Settings → Secrets and variables → Actions**.
3. Pestaña **Secrets** → botón **New repository secret**.
4. Crear `SUPABASE_URL` con la URL del proyecto (sin barra final).
5. Repetir con `SUPABASE_ANON_KEY` y la clave pública `anon`.

Los valores se obtienen en Supabase: **Project Settings → API → Project URL** y
**Project API keys → `anon` / `public`**.

### Prohibido: `service_role`

**Nunca** se debe usar la clave `service_role` en este workflow ni en ningún otro
flujo de GitHub Actions de este repositorio. Esa clave ignora RLS y permite leer
y modificar todos los datos, incluidos clientes, pedidos y pagos. Si alguna vez
se filtra en un log público, hay que rotarla de inmediato desde Supabase.

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
| `Missing SUPABASE_URL` / `Missing SUPABASE_ANON_KEY` | El secreto no existe o está vacío | Recrear el secreto (sección 5) |
| `transport error (curl exit N)` | DNS, red o Supabase no alcanzable tras 3 reintentos | Reintentar manualmente; si persiste, revisar el estado del proyecto en Supabase |
| `HTTP 401` / `HTTP 403` | Clave `anon` rotada, o `anon` perdió `execute` sobre la RPC | Actualizar el secreto; verificar los `grant` de la migración `202607180007` |
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
