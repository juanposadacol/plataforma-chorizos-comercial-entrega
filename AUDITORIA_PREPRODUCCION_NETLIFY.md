# Auditoría integral pre-producción — El Rey del Chorizo

Auditoría de solo lectura. No se modificó código, datos, migraciones ni configuración. No se hicieron commits ni push. No se ejecutaron despliegues.

---

## 1. Resumen ejecutivo

La plataforma tiene una arquitectura backend (PostgreSQL + RLS + RPC `SECURITY DEFINER`) sólida y, en general, bien diseñada: RLS está habilitado en las 36 tablas de `public`, no existe ninguna política que permita a un cliente autenticado leer/escribir directamente `orders`/`payments`/`customers`/`order_items` (todo pasa por vistas `customer_*` filtradas por `auth.uid()` o por funciones `SECURITY DEFINER`), los montos se recalculan siempre en el servidor, el costo histórico del pedido queda congelado, y el stock/costo de producto está protegido por un trigger que bloquea su edición directa. Verificado en vivo contra la base de datos productiva: `anon` no puede leer ninguna tabla de negocio, el catálogo público solo expone `public_price` (nunca costos), y el seguimiento de pedidos usa un token no adivinable, no el UUID/consecutivo del pedido.

Sin embargo, la auditoría encontró **hallazgos ALTO sin resolver** que bloquean la aprobación sin observaciones: un vacío real de idempotencia en pagos (`register_payment`/`deliver_and_pay_order` regeneran la llave de idempotencia en cada llamada y el frontend nunca envía una propia, por lo que un reintento de red puede registrar un pago duplicado), un bug de UI que muestra el saldo pendiente incorrecto al abrir "Entregar y pagar" desde el listado de pedidos, la ausencia de un `ErrorBoundary` en las rutas públicas de la tienda (el fix de "pantalla en blanco" solo cubre `/admin`), y la ausencia total de integración continua (no hay `.github/workflows`, y la única suite SQL con pgTAP nunca se ejecuta automáticamente). Ninguno de estos hallazgos corrompe datos existentes ni representa una brecha de seguridad activa hoy, pero sí representan riesgo comercial real si se despliega sin corregirlos.

**Veredicto: APROBADO CON OBSERVACIONES NO BLOQUEANTES es INCORRECTO dado que existen hallazgos ALTO.** Ver veredicto final en la sección 38.

---

## 2. Fecha y hora de la auditoría

- UTC: 2026-07-19 19:16:23
- America/Bogota: 2026-07-19 14:16:23

## 3. Commit auditado

```
185420155aaf32dc001c79009d54ed8e1ea6bffc
fix: stop shifting PostgreSQL DATE columns back a day in the admin UI
2026-07-19 13:43:42 -0500
```

## 4. Rama auditada

`main`

## 5. Estado del working tree

```
$ git status
On branch main
Your branch is up to date with 'origin/main'.
nothing to commit, working tree clean
```

Confirmado antes y después de la auditoría: sin cambios sin commitear, sin archivos no rastreados relevantes, sin conflictos. Único archivo `.env*` rastreado es `.env.example` (root y `supabase/functions/`); ningún secreto real está versionado.

---

## 6. Arquitectura identificada

- **Frontend**: React 19 + TypeScript + Vite 8, Tailwind, React Router, TanStack Query, Recharts, jsPDF, vite-plugin-pwa. Dos superficies: tienda pública (`/`, `/pedido-confirmado`, `/seguir`, `/mis-pedidos`) y panel admin (`/admin/*`, protegido por `AdminGuard`).
- **Backend**: Supabase (PostgreSQL 17.6 gestionado) — toda la lógica de negocio vive en funciones PL/pgSQL `SECURITY DEFINER` (no hay servidor Node/Express propio). RLS habilitado en las 36 tablas `public`.
- **Creación de pedidos**: pasa por una Edge Function (`create-order`), no por una llamada RPC directa desde el navegador — la función usa `service_role` internamente y expone al cliente solo un endpoint HTTP con su propia validación Zod, CORS, rate limiting e idempotencia.
- **Otras Edge Functions**: `invite-staff` (alta de personal, requiere rol admin), `process-whatsapp-outbox` (worker con secreto compartido, no expuesto a navegador).
- **Notificaciones**: patrón outbox (`notifications`/`notification_deliveries`) con reintentos; una falla de WhatsApp nunca revierte el pedido.
- **Despliegue objetivo**: Netlify (SPA), con `netlify.toml` ya configurado (build, publish, redirects SPA, CSP y headers de seguridad).
- **Proyecto Supabase auditado**: `rkksmtdbcrfaaiufehke` ("Chorizos ensayo"), vinculado (`supabase link`) y consultado en vivo durante esta auditoría.

## 7. Inventario de componentes

- 12 migraciones SQL cronológicas (`supabase/migrations/`), 1 archivo de seed (`supabase/seed.sql`), 1 suite pgTAP (`supabase/tests/transactional_api_test.sql`, 20 aserciones).
- 3 Edge Functions (`create-order`, `invite-staff`, `process-whatsapp-outbox`) + `_shared/` (CORS, cliente, esquema Zod).
- ~40 páginas/componentes en `src/pages/admin` y `src/features/admin`.
- 4 archivos de test Vitest (88 pruebas): `src/domain/commerce.test.ts` (20, sobre un **modelo de dominio paralelo en JS**, no sobre las RPC reales), `src/features/admin/admin-helpers.test.ts`, `src/features/admin/dashboard-dates.test.ts`, `src/lib/format.test.ts`.
- 15 enums Postgres, ~36 tablas, 9 vistas (`store_products`, `store_product_variants`, `store_product_images`, `public_app_settings`, `customer_self`, `customer_orders`, `customer_order_items`, `customer_payments`, `customer_receivables`).
- Documentación existente en `docs/01`–`docs/09` (arquitectura, modelo de datos, instalación, manuales, seguridad WhatsApp, pruebas, decisiones).

---

## 8. Resultado de typecheck

```
$ npm run typecheck
> tsc -b --pretty false
(sin salida — 0 errores)
```
**Verificado.**

## 9. Resultado de lint

```
$ npm run lint
> eslint . --max-warnings=0
(sin salida — 0 errores, 0 warnings)
```
**Verificado.**

## 10. Resultado de tests

```
$ npm test
Test Files  4 passed (4)
     Tests  88 passed (88)
```
**Verificado**, pero ver el hallazgo **H-14** (Fase 15): estas 88 pruebas no ejercitan ninguna RPC real de Supabase; 20 de ellas validan un modelo de dominio paralelo en TypeScript (`src/domain/commerce.ts`), no el código PL/pgSQL que realmente corre en producción. La única suite que sí prueba las RPC reales (pgTAP, 20 aserciones) no se ejecuta en ningún script ni pipeline.

## 11. Resultado de build

```
$ npm run build
tsc -b && vite build
✓ 2785 modules transformed
✓ built in ~1.6-2.1s
dist/ generado correctamente (index.html, assets con hash, sw.js, manifest.webmanifest)
```
**Verificado**, build reproducible ejecutado dos veces con resultado idéntico salvo hashes de archivo. Advertencia no bloqueante de Vite: varios chunks superan 500 kB sin minificar dividir (`index-*.js` ~663 kB, `ReportsPage-*.js` ~440 kB, `BarChart-*.js` ~353 kB) — no impide el despliegue, pero afecta tiempo de carga inicial.

Verificación adicional sobre `dist/`:
- Sin `service_role`, `SUPABASE_ACCESS_TOKEN` ni tokens de WhatsApp en el bundle — la única coincidencia de `service_role` está en comentarios JSDoc del propio SDK `@supabase/supabase-js` ("never expose your service_role key in the browser"), no una clave real.
- Sin variables `VITE_*` inesperadas en el bundle (solo las 4 documentadas en `.env.example`).
- Las coincidencias de `localhost` en el bundle provienen del propio `supabase-js` (fallback interno del SDK, `http://localhost:9999` para GoTrue local) y de `src/lib/env.ts` (fallback solo cuando `window` es `undefined`, es decir, nunca en un navegador real) — no hay URL de producción hardcodeada.
- La anon key pública (`sb_publishable_...`) sí está en el bundle — **esperado y correcto**, es la clave pública protegida por RLS, no un secreto.

## 12. Resultado de npm audit

```
$ npm audit
found 0 vulnerabilities
```
**Verificado.** `package-lock.json` lockfileVersion 3, consistente con `package.json` (mismo nombre/versión).

---

## 13. Auditoría de base de datos

Ver también §14–16 (migraciones, RPC, RLS) para el detalle completo con evidencia; investigación delegada a un agente especializado que leyó las 12 migraciones línea por línea, complementada con introspección en vivo (`pg_tables`, `pg_policies`, `information_schema.role_table_grants`, `pg_views`) contra el proyecto productivo.

- Columnas monetarias: **verificado** — todas `numeric(16,2)` (cantidades `numeric(16,3)`); cero columnas `float`/`double precision`/`real` en todo el esquema.
- CHECK constraints: fuertes en `orders` (`orders_amounts_check`, `orders_paid_check`, `orders_discount_check`), `order_items` (subtotal/total/costo/utilidad atados exactamente a `quantity × unit_price`/`unit_cost`), `purchases`, `accounts_receivable`/`accounts_payable`. **Gap real** (H-10, ver §21): `orders.gross_profit`/`orders.sales_cost` no tienen CHECK/trigger que los reconcilie contra `order_items` — exactamente la clase de columna que permitió el bug de costo cero que tuvo que repararse manualmente en `202607190001`.
- Claves foráneas e índices: presentes y razonables en las tablas revisadas (`orders_customer_idx`, `orders_status_idx`, `order_items_product_idx`, etc.).
- Timestamps: `created_at`/`updated_at` `timestamptz not null default now()` de forma consistente; fechas comerciales (`sale_date`, `delivered_at`) correctamente tratadas en América/Bogotá en las funciones de reporte (ver §28).
- Inmutabilidad histórica: **verificado** — `order_status_history` tiene un trigger `order_status_history_immutable` que bloquea UPDATE/DELETE incluso para admins; `inventory_movements` tiene protección equivalente (append-only).
- Trazabilidad: `audit_logs` registra `CREATE`/`STATUS_CHANGE` con actor, valores antes/después y razón; `order_status_history` registra actor, fecha, estado anterior, estado nuevo, motivo y nota (columna real es `new_status`, no `status` — confirmado consistente en todo el código SQL).

## 14. Auditoría de migraciones

Las 12 migraciones se aplican en orden sin contradicciones reconstruibles desde cero: sin `drop table`, sin `truncate`, sin UPDATE/DELETE masivo fuera de bloques `do $$` acotados. Único DML de reparación de datos en toda la historia: `202607190001_fix_dashboard_reports_bogota_costs.sql:712-782`, acotado estrictamente a filas con la firma exacta del bug de costo cero (`unit_cost=0 and product.average_cost=0 and product.current_cost>0`), idempotente, con `RAISE NOTICE` de antes/después — **verificado seguro**.

Hallazgos de esta fase:
- **H-11 (BAJO)**: `request_rate_limits` se crea dos veces con CHECK contradictorio (`> 0` en la migración 1 vs `>= 0` en la migración 2, esta última con `if not exists` por lo que nunca se ejecuta en la práctica) — deriva de documentación, sin efecto en runtime.
- **H-12 (BAJO)**: columnas `products.featured`/`products.image_url` añadidas en `202607180002_add_product_display_columns.sql` pero nunca leídas por ninguna función/vista posterior (todo el código usa `is_featured`/`main_image_url`) — código muerto, no un defecto funcional.
- **H-01 (INFORMATIVO, ya corregido)**: entre `202607170001` y `202607180007`, los privilegios por defecto de Postgres/Supabase (`alter default privileges ... to anon`) otorgaron silenciosamente a `anon` SELECT/INSERT/UPDATE/DELETE sobre ~32 tablas de negocio y EXECUTE sobre toda función `SECURITY DEFINER`, nunca revocados explícitamente por las migraciones tempranas. La propia migración `202607180007` lo documenta y lo corrige; la propia migración caracteriza el riesgo como "no explotable en ese momento porque RLS y `require_staff()` seguían bloqueando todo," pero es "precisamente la capa de defensa en profundidad que se suponía debía evitarse." **Verificado en vivo que hoy está corregido** (ver §16): `anon` no puede leer ninguna tabla de negocio directamente.

## 15. Auditoría de RPC

Ver tabla resumen y hallazgos detallados por función. Todas las funciones `SECURITY DEFINER` revisadas fijan `search_path` explícitamente (`pg_catalog, public, pg_temp`), sin excepción.

| Función | Rol requerido | Idempotencia | Bloqueos de carrera | Validación server-side de dinero | Hallazgo |
|---|---|---|---|---|---|
| `create_order` | solo `service_role` (vía Edge Function, valida identidad real internamente) | UUID único + `exception when unique_violation` — robusta | `for update` en orden determinístico sobre products/variants | Sí — precio vía `resolve_product_price_internal`, costo histórico vía `nullif(average_cost,0)…` (bug de costo-cero **confirmado corregido**) | — |
| `transition_order_status` | `superadmin,admin,vendedor,bodega` (con reglas finas adicionales) | Mismo-estado hace no-op (idempotente); versión optimista (`p_expected_version`) | `for update` en `orders` y cada reserva | No aplica (sin montos de cliente) | — |
| `register_payment` (9-arg) | `superadmin,admin,vendedor,contabilidad`; solo contabilidad/admin puede `approved` | Llave de idempotencia consultada primero, **sin** `exception when unique_violation` (a diferencia de `create_order`) | `for update` en `orders`, `accounts_receivable`, `cash_accounts` | Sí — `amount_paid`/`payment_status` recalculados desde `sum(payments)`, nunca confiados del cliente; rechaza sobrepago | **H-06** (race de idempotencia sin manejar), **H-05** (frontend nunca envía llave propia) |
| `register_payment` (5-arg, texto) | igual, delega al de 9-arg | **Sin protección**: genera una llave nueva en cada llamada | igual (delegado) | igual (delegado) | **H-05** |
| `deliver_and_pay_order` | `superadmin,admin,vendedor,contabilidad` | Entrega idempotente por estado; **pago no** — llave por defecto `gen_random_uuid()` y el frontend nunca la pasa explícita | `for update` en `orders`; delega en `transition_order_status`/`register_payment` | Sí — rechaza `p_amount > saldo` | **H-05** (crítico para esta función), **H-13** (rol `contabilidad` puede fallar en pedido no entregado) |
| `receive_purchase` | `superadmin,admin,bodega,contabilidad` | Idempotente por estado (no por llave — correcto para este caso de uso) | `for update` en purchase/items/products | Sí — costo promedio ponderado recalculado en servidor | — |
| `create_inventory_adjustment` | `superadmin,admin,bodega` | No aplica (ajuste explícito, exige nota obligatoria) | `for update` en producto | Sí | — |
| `get_dashboard_metrics` | `superadmin,admin,vendedor,bodega,contabilidad` | `stable`, solo lectura | N/A | N/A | — |
| `report_sales_by_day` y demás `report_*` | igual | `stable`, solo lectura | N/A | N/A | — |

**H-13 (ALTO, hallazgo nuevo de esta auditoría, verificado por lectura directa)**: `deliver_and_pay_order` exige rol en `{superadmin,admin,vendedor,contabilidad}` (`202607180004_admin_flexible_transitions.sql:355`), pero cuando el pedido **no** está ya entregado, delega internamente en `transition_order_status`, que exige rol en `{superadmin,admin,vendedor,bodega}` (`202607180004_admin_flexible_transitions.sql:44`) — **`contabilidad` está en la primera lista pero no en la segunda**. Un usuario con rol únicamente `contabilidad` que use "Entregar y pagar" sobre un pedido que aún no está entregado (el caso de uso principal de esa función) recibirá un error de permisos (`42501`) y la transacción completa se revertirá (sin corrupción, pero la acción falla). Si el pedido ya está `delivered`, la función omite la llamada interna y `contabilidad` sí puede registrar el pago — el bug solo se manifiesta en el flujo principal.
- Cómo reproducir: con un usuario cuyo único rol sea `contabilidad`, llamar `deliver_and_pay_order` sobre un pedido en cualquier estado distinto de `delivered`.
- Recomendación: alinear las listas de roles (agregar `contabilidad` a `transition_order_status`, o restringir `deliver_and_pay_order` a los mismos roles que `transition_order_status` más una verificación separada para el registro de pago).

---

## 16. Auditoría de RLS y GRANT

**Verificado en vivo** (no solo por lectura de migraciones) vía `pg_tables.rowsecurity` e `information_schema.role_table_grants` contra el proyecto productivo:

- RLS habilitado (`rowsecurity = true`) en las **36** tablas de `public`, sin excepción.
- `authenticated` tiene GRANT de tabla `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE` sobre casi todas las tablas de negocio (`orders`, `payments`, `customers`, `products`, etc.) — **esto significa que RLS es la única barrera real**, no el GRANT. Verificado que las políticas son correctas (tabla siguiente).
- `anon` solo tiene SELECT sobre tablas de catálogo público (`brands`, `categories`, `delivery_methods`, `payment_methods`, `public_app_settings`, `store_products`, `store_product_variants`, `store_product_images`) — **cero** GRANT sobre `orders`/`payments`/`customers`/`products` (tabla base) para `anon`.

### Prueba en vivo con la anon key (REST API real, sin credenciales de staff)

| Endpoint | Resultado | Interpretación |
|---|---|---|
| `GET /rest/v1/orders` (anon) | `401` `permission denied for table orders` | Correcto — bloqueado |
| `GET /rest/v1/customers` (anon) | `401` `permission denied for table customers` | Correcto — bloqueado |
| `GET /rest/v1/payments` (anon) | `401` `permission denied for table payments` | Correcto — bloqueado |
| `GET /rest/v1/products` (anon, tabla base) | `401` `permission denied for table products` | Correcto — el catálogo público se sirve vía RPC/vista, no la tabla base |
| `POST /rest/v1/rpc/get_catalog_prices` (anon) | `200`, devuelve `public_price`/`effective_price`/`stock_available`, **sin** `current_cost`/`average_cost` | Correcto — catálogo público sin fuga de costos |
| `POST /rest/v1/rpc/get_dashboard_metrics` (anon) | `401` `permission denied for function get_dashboard_metrics` | Correcto — bloqueado |
| `POST /rest/v1/rpc/get_order_tracking` con `p_tracking_token` real de PED-00000001 (anon) | `200`, devuelve el detalle de ese pedido únicamente | Correcto — seguimiento de invitado funcional |
| `POST /rest/v1/rpc/get_order_tracking` con un UUID adivinado | `200`, `null` | Correcto — no filtra existencia de otros pedidos |
| `GET /rest/v1/orders?id=eq.<uuid real>` (anon, intento de IDOR directo) | `401` `permission denied for table orders` | Correcto — imposible saltarse el token de seguimiento leyendo la tabla directo |

### Matriz de RLS (extracto de las tablas de mayor riesgo; matriz completa de 36 tablas verificada, ver evidencia del agente de migraciones)

| Objeto | Rol | SELECT | INSERT | UPDATE | DELETE | EXECUTE | Resultado |
|---|---|---|---|---|---|---|---|
| `orders` (tabla base) | anon | ✗ (sin policy) | ✗ | ✗ | ✗ | — | Bloqueado — verificado en vivo |
| `orders` (tabla base) | authenticated sin rol staff | ✗ (sin policy que aplique) | ✗ | ✗ | ✗ | — | Bloqueado por diseño — el cliente usa `customer_orders` (vista) |
| `orders` (tabla base) | vendedor/bodega/contabilidad | ✓ (`operational_staff_read`) | ✗ | ✗ | ✗ | — | Solo lectura para staff operativo |
| `orders` (tabla base) | admin/superadmin | ✓ | ✓ | ✓ | ✓ (`administrators_all`, `is_admin()`) | — | Control total solo para administradores |
| `customer_orders` (vista) | authenticated (cliente) | ✓, filtrado `c.auth_user_id = auth.uid()` | — | — | — | — | Correcto — solo sus propios pedidos |
| `payments` (tabla base) | contabilidad | ✓/✓/✓ (`accounting_staff_*`) | ✓ | ✓ | ✗ | — | Coherente con el rol |
| `products` (tabla base, incl. `current_cost`) | vendedor/bodega | ✓ (`operational_staff_read`, sin restricción de columna) | ✗ | ✗ | ✗ | — | **H-09** — ver abajo |
| `products`/`product_variants` (`stock_on_hand`,`stock_reserved`,`current_cost`,`average_cost`) | cualquiera (incl. admin vía UPDATE directo) | — | — | Bloqueado por trigger salvo dentro de una RPC transaccional (`app.inventory_write`) | — | — | Verificado — "Editar producto" no puede tocar stock/costo directamente |
| `customers.pin_hash` | vendedor/bodega/contabilidad | ✓ (GRANT de tabla completa) | — | — | — | — | **H-08** — ver abajo |
| Toda función `SECURITY DEFINER` sensible | `public`/`anon` | — | — | — | — | ✗ (`revoke all from public`, re-grant explícito) | Correcto |

**H-09 (INFORMATIVO / requiere confirmación de política de negocio)**: `vendedor` y `bodega` pueden leer `products.current_cost`/`products.average_cost` y `order_items.unit_cost`/`gross_profit` (política `operational_staff_read`, sin restricción de columna) — es decir, personal de ventas y bodega ven el margen exacto de cada producto/pedido, no solo `contabilidad`/administradores. Puede ser una decisión de negocio deliberada; se marca como **no verificable sin confirmación del cliente** si es intencional.

**H-08 (MEDIO)**: `customers.pin_hash` (hash bcrypt del PIN de acceso del cliente) es legible por **todo** el personal autenticado (vendedor, bodega, contabilidad), no solo administradores — consecuencia documentada explícitamente en `202607180006_fix_admin_panel_permissions.sql:37-38` como una decisión deliberada al corregir el bug de "permission denied for table customers" (la corrección debía restaurar SELECT a nivel de tabla completa porque PostgREST exige SELECT de tabla para resolver `select *`, no solo columnas). El hash no revela el PIN en texto plano, pero amplía innecesariamente la superficie de exposición a roles (bodega) sin necesidad operativa de ese dato.

---

## 17. Auditoría de pedidos

Verificado (lectura de código + prueba en vivo contra PED-00000001):

1. **Creación**: pasa por Edge Function `create-order` → RPC `create_order` (solo `service_role`). El payload del navegador se sanea (`sanitizeOrderPayload`) para excluir cualquier precio/subtotal/total — únicamente `customer.{name,phone}`, `items[].{product_id,quantity}`, datos de entrega, `payment_method_id`, notas.
2. **Validación de cliente**: teléfono normalizado y validado por regex; nombre 2-140 caracteres; identidad re-verificada server-side contra `auth.uid()`/teléfono, no confiada del payload.
3. **Validación de productos/cantidades**: `quantity > 0`, `≤ 9999`, entero (`trunc(v_quantity) = v_quantity`) — decimales rechazados a nivel de base de datos independientemente de la unidad del producto.
4. **Precio público / especial**: resuelto exclusivamente vía `resolve_product_price_internal` con precedencia `especial > volumen > lista > público` — confirmado por prueba pgTAP existente y por lectura directa del código.
5. **Descuento/domicilio/total**: calculados en servidor; `orders_amounts_check` garantiza `total = subtotal - descuento + domicilio + impuesto` a nivel de constraint.
6. **Costo histórico**: `order_items.unit_cost` se congela al crear el pedido; bug de costo-cero **confirmado corregido** (ver §15, §21).
7. **Reserva de inventario**: `for update` + inserción en `inventory_reservations`/`inventory_movements` (tipo `reservation`) dentro de la misma transacción que crea el pedido.
8. **Consecutivo**: `order_number` vía secuencia dedicada (`order_number_seq`), formato `PED-00000001`.
9. **Estado inicial**: `new`; `payment_status` inicial `credit` (si el método lo permite) o `pending`.
10. **Notificaciones**: inserción en `notifications`/`notification_deliveries` ocurre **después** de confirmar el pedido; una falla de WhatsApp (verificado en la Edge Function) nunca revierte el pedido ya creado.
11. **Idempotencia**: `idempotency_key uuid not null unique` + `exception when unique_violation` — la más robusta de todas las funciones auditadas. **Gap** (H-04, ver §15 y frontend): el cliente genera una llave **nueva** en cada intento de `submit()`, por lo que un reintento manual tras un fallo percibido (no un doble clic, que sí está protegido por el botón deshabilitado) podría crear un pedido duplicado si el servidor sí procesó el primer intento.
12. **PED-00000001 específicamente**: verificado en vivo, sin modificarlo — ver §20.

## 18. Auditoría de pagos

Ver tabla de RPC en §15. Resumen de invariantes verificadas por lectura directa del código de `register_payment`:

- `p_amount <= 0` rechazado — **sin pagos cero/negativos posibles vía esta RPC**.
- Pedido `cancelled`/`returned` rechaza cualquier pago nuevo.
- Método de pago debe estar activo; si `requires_reference` es verdadero, la referencia es obligatoria (mecanismo confirmado; qué métodos tienen `requires_reference=true` en los datos reales es una verificación de datos, no de código — **pendiente de prueba manual** con los datos de producción reales).
- Solo `superadmin/admin/contabilidad` puede aprobar un pago (`p_status = 'approved'`).
- **Sobrepago bloqueado a nivel de RPC**: `v_approved_total + p_amount > total_amount` → excepción `23514`. Combinado con el CHECK `orders_paid_check` (`amount_paid <= total_amount`), es **imposible por dos capas independientes** que `amount_paid` supere `total_amount`.
- `payment_status` se deriva siempre de la suma real de pagos aprobados (`paid` solo si `≥ total`, `partial` si `> 0`) — nunca puede quedar `paid` con saldo positivo por construcción.
- `orders.amount_paid`, `accounts_receivable.balance_amount` y `customers.outstanding_balance`/`total_paid` se recalculan desde cero en cada llamada (no incrementales) — reduce el riesgo de drift, aunque no hay un CHECK/trigger que lo garantice de forma independiente (H-10).

**Hallazgo crítico de esta sección — H-05 (ALTO)**: ni `PaymentsPage.tsx` ni `DeliverAndPayModal.tsx` pasan un `p_idempotency_key` explícito al invocar `register_payment`/`deliver_and_pay_order` (grep confirmado: cero ocurrencias de `idempotency` en ambos archivos). Ambas RPC generan `gen_random_uuid()` por defecto en **cada** invocación. Un reintento de red (timeout del lado del cliente donde el servidor sí procesó el pago) genera un **pago genuinamente distinto y no deduplicado**. El caso de pago total se autolimita parcialmente porque `deliver_and_pay_order` recalcula el saldo real antes de pagar (si ya está pagado, `v_pay_amount = 0` y no paga de nuevo) — pero un pago **parcial** explícito (`p_amount` fijo, p. ej. abono de $50.000) reintentado sin que el balance llegue a cubrir el total **sí puede duplicarse**, porque el chequeo de sobrepago (`v_approved_total + p_amount > total`) no lo bloquea si la suma sigue siendo ≤ total.
- Cómo reproducir: registrar un pago parcial ($50.000 de $120.000) vía `PaymentsPage`; simular una respuesta lenta/timeout del lado del cliente después de que el servidor ya procesó el pago; reintentar manualmente el mismo monto — se registran dos pagos de $50.000.
- Recomendación (no aplicada, solo reportada): generar un `idempotency_key` estable por intento de pago en el frontend (mismo patrón que `create-order`) y reenviarlo explícitamente en reintentos; adicionalmente, envolver el `insert` de `register_payment` en un `exception when unique_violation` (H-06) para que una carrera con la misma llave devuelva el resultado existente en vez de un error crudo de PostgreSQL.

## 19. Auditoría de estados

### Matriz de transiciones (verificada por lectura directa de `transition_order_status`, `202607180004_admin_flexible_transitions.sql`)

| Desde \ Hacia | pending_confirmation | confirmed | preparing | ready | dispatched | delivered | cancelled | returned |
|---|---|---|---|---|---|---|---|---|
| **new** — admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| **new** — vendedor/bodega | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| **pending_confirmation** — admin | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| **pending_confirmation** — no-admin | — | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| **confirmed** — admin | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| **confirmed** — no-admin | — | — | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| **preparing** — admin | — | — | — | ✓ | ✓ | ✓ | ✓ | ✗ |
| **preparing** — no-admin | — | — | — | ✓ | ✗ | ✗ | ✓ | ✗ |
| **dispatched** — cualquiera | — | — | — | — | — | ✓ | ✓ | ✗ |
| **delivered** — cualquiera | ✗ | ✗ | ✗ | ✗ | ✗ | (no-op) | ✗ | ✓ |
| **cancelled** — cualquiera | ✗ (terminal, sin salida) | | | | | | | |
| **returned** — cualquiera | ✗ (terminal, sin salida) | | | | | | | |

Notas verificadas:
- **`new → delivered` directo por admin**: confirmado (línea 65 de la función). Coincide con el requisito de negocio ya implementado.
- **`delivered → delivered`**: la función corta en `if p_new_status = v_order.status then return ... end if;` **antes** de tocar inventario/historial — **confirmado que repetir "Entregado" no duplica movimientos de inventario**.
- **`delivered → cancelled`**: no está en la lista de transiciones válidas para nadie (ni admin) — solo `delivered → returned` existe. Correcto: un pedido ya entregado no puede "cancelarse", debe devolverse (lo que sí revierte stock y estadísticas de cliente correctamente).
- **`cancelled → delivered` (o cualquier salida de `cancelled`/`returned`)**: bloqueado — ambos estados caen en `else false` en ambas ramas (admin/no-admin), es decir, son verdaderamente terminales.
- **Motivo obligatorio**: `cancelled`/`returned` exigen `p_reason` o, si se omite, `p_notes` como respaldo — nunca se puede cancelar/devolver sin al menos uno de los dos.
- **Reingreso de stock**: `cancelled` libera reservas activas (`reservation_release`); `returned` libera reservas `fulfilled` y **suma** de vuelta a `stock_on_hand` — verificado que usa el `unit_cost` histórico de la reserva, no el costo actual.
- **Condición de carrera / doble ejecución**: `select ... for update` sobre `orders` al inicio de la función serializa cualquier par de llamadas concurrentes sobre el mismo pedido; combinado con el corte de "mismo estado", una doble ejecución (doble clic, reintento de red) es segura por diseño — **verificado en el código**, no solo inferido.
- **Historial**: cada transición inserta en `order_status_history` con `changed_by` (`auth.uid()`), `previous_status`, `new_status`, `reason`, `notes` — trazabilidad completa confirmada.

### Restricciones desde la UI (verificado por el agente de frontend)

`OrdersTable.tsx` y `OrderDetailPage.tsx` ofrecen **todos** los estados en el `<select>` sin restringir por adyacencia — la aplicación real de la matriz de arriba depende enteramente del servidor (correcto, ya que el servidor sí la aplica), pero significa que un `vendedor` que intente seleccionar `delivered` desde `new` en la UI recibirá un error del servidor en vez de tener la opción deshabilitada de antemano — **BAJO**, UX mejorable, no un riesgo de seguridad ni de datos.

## 20. Auditoría de inventario

Verificado por lectura de `create_order`, `transition_order_status`, `receive_purchase`, `create_inventory_adjustment`, y por el trigger `guard_inventory_columns`:

- **Stock no editable directo desde "Editar producto"**: **confirmado**. Trigger `products_guard_inventory`/`product_variants_guard_inventory` (`202607170002_transactional_api.sql:580-602`) bloquea cualquier UPDATE de `stock_on_hand`, `stock_reserved`, `current_cost`, `average_cost` salvo que la transacción actual tenga `set_config('app.inventory_write','transactional_api',true)` — ese `set_config` solo lo emiten las RPC transaccionales confiables. Un UPDATE directo desde el panel de "Editar producto" (que no pasa por esas RPC) sería rechazado con `42501 Stock and cost must be changed through an inventory transaction`.
- **stock = entradas - salidas ± ajustes**: modelado correctamente vía `inventory_movements` (tabla append-only, con `stock_on_hand_before`/`stock_on_hand_after` en cada fila) — no existe un cálculo derivado separado que pudiera divergir; `stock_on_hand` se actualiza atómicamente junto con el movimiento, dentro de la misma transacción, bajo `for update`.
- **Valor de inventario = stock disponible × costo vigente**: confirmado en `get_dashboard_metrics`/`report_inventory_snapshot`, ambos usando `coalesce(nullif(average_cost,0), nullif(current_cost,0), 0)` — corrige el mismo bug de "costo cero" para la valorización, no solo para pedidos nuevos.
- **Entregar dos veces no duplica salidas**: confirmado en §19 (corte por mismo-estado).
- **Registrar pago no cambia inventario**: confirmado — `register_payment` no toca ninguna columna de `products`/`inventory_movements`.
- **Cambiar estado sin entregar no descuenta stock indebidamente**: confirmado — el descuento de `stock_on_hand` solo ocurre en la rama `p_new_status = 'delivered'`.
- **Cancelar/devolver no duplica reposiciones**: confirmado — ambas ramas operan sobre reservas con estado específico (`active` para cancelar, `fulfilled` para devolver) y las marcan (`released`/`cancelled`) de forma que una segunda ejecución no encontraría más filas que procesar (la transición en sí ya estaría bloqueada por la matriz de estados de todas formas).

### PED-00000001 (sin modificar — solo lectura)

Verificado en vivo, estado actual idéntico al esperado:

| Campo | Valor verificado |
|---|---|
| `status` | `delivered` |
| `payment_status` | `paid` |
| `total_amount` | `120000.00` |
| `amount_paid` | `120000.00` |
| saldo (`total - paid`) | `0.00` |
| `sales_cost` | `80000.00` |
| `gross_profit` | `40000.00` |
| margen (`gross_profit/total*100`) | `33.33` |
| `created_at` (UTC / Bogotá) | `2026-07-18 20:06:30.98+00` / `2026-07-18 15:06:30.98` |
| `delivered_at` (UTC / Bogotá) | `2026-07-18 23:33:32.46+00` / `2026-07-18 18:33:32.46` |
| suma `order_items` (unidades/ingreso/costo/utilidad) | `8` / `120000.00` / `80000.00` / `40000.00` — **coincide exactamente** con las columnas denormalizadas de `orders` |
| pagos | 1 pago, `120000.00`, `approved` — sin duplicados |
| `deleted_at` | `null` |

**No se modificó ningún campo de este pedido durante la auditoría.**

## 21. Auditoría de costos y utilidad

- **Costo del pedido = Σ(cantidad × unit_cost histórico)**: verificado — `order_items.unit_cost` se congela en `create_order` y **no** se recalcula si el `current_cost` del producto cambia después (no hay ningún trigger/función que toque `order_items.unit_cost` tras la creación, salvo la migración de reparación puntual ya documentada y ya aplicada a los datos afectados).
- **Utilidad bruta = ventas netas − costo histórico**: verificado en `order_items_profit_check` (constraint a nivel de fila) y en el cálculo agregado de `get_dashboard_metrics`.
- **Margen = utilidad bruta / ventas netas × 100**: verificado, con protección explícita contra división por cero (`case when net_sales = 0 then 0 else ...`) en todas las funciones de reporte.
- **Bug de costo cero (histórico) — confirmado corregido**: causa raíz era `coalesce(average_cost, current_cost, 0)` sin `nullif`, que nunca caía a `current_cost` porque `average_cost` por defecto es `0` (no `null`) hasta la primera compra recibida. Corregido con `coalesce(nullif(average_cost,0), nullif(current_cost,0), 0)` en `create_order`, `get_dashboard_metrics` (valorización de inventario) y `report_inventory_snapshot` — **verificado que el patrón corregido no tiene reapariciones del patrón sin `nullif` en ningún lugar del esquema actual**.
- **H-10 (MEDIO)**: `orders.gross_profit`/`orders.sales_cost` no tienen CHECK/trigger que los reconcilie automáticamente contra `sum(order_items.total_cost)` — son columnas denormalizadas mantenidas solo por disciplina de las funciones RPC. Es exactamente la clase de columna que permitió que el bug de costo cero pasara desapercibido hasta una auditoría manual. Recomendación: agregar un trigger de reconciliación o, como mínimo, una prueba de regresión automatizada que compare periódicamente `orders.sales_cost` contra `sum(order_items.total_cost)`.

## 22. Auditoría de clientes

- Creación/edición/búsqueda: RLS confirma que solo `vendedor`/`contabilidad` pueden insertar/actualizar clientes (`staff_customers_insert`/`staff_customers_update`); `bodega` solo lectura; administradores control total.
- Documento/celular: `customers` valida formato de celular vía `normalize_phone` + regex en `create_order`; duplicados por celular normalizado se resuelven reutilizando el cliente existente (no se crean duplicados silenciosos).
- Clasificación/crédito/cupo/lista de precios: columnas presentes (`classification`, `credit_limit`, `credit_days`, `price_list_id`); lógica de crédito usada en `create_order` (`v_payment.allows_credit`) para decidir `payment_status` inicial y crear `accounts_receivable`.
- **H-08 (MEDIO)**: exposición de `pin_hash` a todo el personal — ver §16.
- Vista de autoservicio (`customer_self`) correctamente filtrada por `auth.uid()`, sin exponer `pin_hash` (la vista declara columnas explícitas, no `select *`).

## 23. Auditoría de productos

- Creación/edición/activación vía panel admin — RLS: solo `is_admin()` puede insertar/actualizar/eliminar productos; staff operativo (`vendedor,bodega,contabilidad`) solo lectura.
- SKU, precio público, costo actual, presentación, unidad, imagen, stock mínimo: columnas presentes y tipadas correctamente (`numeric` para precios/costos).
- **Venta sin stock**: controlada por `allow_backorder` a nivel de producto/variante; si es `false` y `track_inventory` es `true`, `create_order` rechaza con `OUT_OF_STOCK` cuando `stock_available < quantity`.
- Producto destacado: `is_featured`, usado correctamente en `store_products` (la columna duplicada `featured` de `202607180002` no se usa — H-12).
- Stock no editable directo: ver §20 (trigger `guard_inventory_columns`).

## 24. Auditoría de compras

- `receive_purchase`: rol `superadmin,admin,bodega,contabilidad`; bloquea sobre-recepción (`received_quantity ≤ remaining`); recalcula costo promedio ponderado en servidor; `for update` en purchase/items/products evita condiciones de carrera.
- Costo unitario y actualización de costo vigente: `current_cost`/`average_cost` se actualizan atómicamente dentro de la misma transacción que registra el movimiento de inventario tipo `purchase`.
- Deuda con proveedor: `accounts_payable` con las mismas garantías de CHECK que `accounts_receivable`.
- Idempotencia: por estado (no por llave) — correcto para este caso de uso, ya que no existe un escenario análogo de "doble compra" por reintento de red (la compra ya existe como fila antes de recibirse).

## 25. Auditoría de proveedores

RLS: `bodega`/`contabilidad` solo lectura (`warehouse_staff_read`); solo administradores pueden crear/editar/eliminar proveedores (`administrators_all`). No se encontraron rutas de creación de proveedor accesibles a `vendedor`.

## 26. Auditoría de gastos

- RLS: `contabilidad` control de lectura/inserción/actualización; solo admin puede eliminar.
- **Gastos reducen utilidad neta, no utilidad bruta**: **verificado** — `get_dashboard_metrics` calcula `net_profit = gross_profit - operating_expenses`, con `gross_profit` calculado únicamente a partir de `orders`/`order_items` (sin restar gastos ahí). Filtrado correcto: solo gastos `status='posted'` de categorías marcadas `is_operating_expense`.
- Fechas: `expense_date` es `date` puro (sin hora/zona) — correctamente tratado por `formatSqlDate`/`isBareSqlDate` en el frontend tras el fix de fechas de la sesión anterior (verificado, no reaparece el patrón de `new Date("YYYY-MM-DD")` sin protección para este campo).

## 27. Auditoría de reportes

Ver también §28 (fechas). Verificado en vivo comparando la salida real de la RPC contra lo que debería mostrar la UI:

```json
// public.get_dashboard_metrics() — invocado con sesión staff simulada, en vivo
{
  "sales_today": 0, "sales_yesterday": 120000,
  "sales_current_week": 120000, "sales_current_month": 120000,
  "average_ticket": 120000, "gross_profit": 40000, "gross_margin": 33.33,
  "net_profit": 40000, "delivered_orders": 1, "new_orders": 1,
  "collected": 120000, "accounts_receivable": 0, "units_sold": 8,
  "order_status_counts": {"delivered": 1}
}
```

```
-- public.report_sales_by_day('2026-07-01','2026-07-19') — invocado en vivo
sale_date  | delivered_orders | net_sales | sales_cost | gross_profit | gross_margin
2026-07-17 | 0                | 0         | 0          | 0             | 0
2026-07-18 | 1                | 120000.00 | 80000.00   | 40000.00      | 33.33
```

Coincide exactamente con los valores exigidos: venta $120.000, costo $80.000, utilidad $40.000, margen 33,33%, 8 unidades, 1 pedido entregado, ticket promedio $120.000, recaudado $120.000, por cobrar $0. `sales_today = 0` es correcto (el "hoy" real de la base de datos es 19/07; la venta fue el 18/07 = "ayer").

Dashboard, reportes, CSV/Excel/PDF y gráfica: **verificado por el agente de frontend** que las cuatro superficies derivan de la misma fuente (`rows`/`metrics` desde la RPC), sin cálculo cliente-side paralelo que pudiera divergir — confirmado sin duplicación de lógica financiera en el frontend tras la corrección de la sesión anterior.

## 28. Auditoría de fechas y zona horaria

- **Fecha de venta**: `report_sales_by_day` agrupa por `(delivered_at at time zone 'America/Bogota')::date` — verificado en vivo que `2026-07-18` (no `17`) es la fecha correcta para PED-00000001, y que `2026-07-17` queda en cero.
- **Encabezados del dashboard** (`sales_today/yesterday/week/month`): usan `date_trunc('day'|'week'|'month', now() at time zone 'America/Bogota') at time zone 'America/Bogota'` — patrón correcto de doble conversión, verificado matemáticamente y en vivo.
- **`report_*` con parámetros `date`**: reciben strings `YYYY-MM-DD` del frontend; confirmado por prueba directa que el cast de un string con offset horario a tipo `date` en Postgres toma literalmente el Y-M-D sin desplazamiento — no hay riesgo de off-by-one en el paso de parámetros.
- **Bug de "17/07 en vez de 18/07" en la tabla de Reportes**: causa raíz — no era la SQL (que siempre devolvió `2026-07-18` correctamente), sino `new Date("2026-07-18")` en el frontend, que ECMA-262 interpreta como medianoche UTC; al formatear esa fecha en zona `America/Bogota` (UTC-5), retrocede al día calendario anterior. **Confirmado corregido**: `formatSqlDate`/`isBareSqlDate` (`src/lib/format.ts`) detectan un valor `YYYY-MM-DD` puro por su forma (nunca por el nombre de la columna) y lo formatean por interpolación de texto, sin construir nunca un objeto `Date`. `formatAdminDate` fue endurecido para usar la misma protección, cubriendo automáticamente todos los demás sitios de la app que ya usaban ese helper (pagos, compras, gastos, fecha de entrega solicitada, vigencia de listas de precio).
- **H-15 (BAJO/INFORMATIVO)**: `formatDate`/`formatDateTime` (`src/lib/format.ts:11-24`, funciones distintas de `formatAdminDate`) **no** tienen el mismo guardia `isBareSqlDate`. Hoy no hay ningún llamado activo que les pase una fecha `DATE` pura (verificado por grep — solo se usan con `created_at`, siempre timestamptz completo), por lo que no hay bug activo, pero es una trampa latente sin cobertura de prueba si un futuro cambio las reutiliza con un campo `DATE`.
- **Pruebas de regresión existentes**: `src/lib/format.test.ts` y `src/features/admin/dashboard-dates.test.ts` cubren explícitamente el caso reportado (`formatSqlDate("2026-07-18") === "18/07/2026"`), límites de semana (lunes) y mes (día 1) en Bogotá, y timestamps UTC de madrugada que caen en el día Bogotá anterior — **todas pasan** (ver §10).

## 29. Auditoría de autenticación

- Sesión: `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true`, clave de almacenamiento propia (`chorizos-auth-v3`) — configuración estándar y correcta de `supabase-js`.
- Login de clientes: OTP por celular (`signInWithOtp`/`verifyOtp`, tipo `sms`).
- Protección de `/admin/*`: `AdminGuard` (client-side) redirige si no hay sesión o si `access.isStaff` es falso; **la barrera real no es esta** sino que `access` (roles) se obtiene de `get_my_access()`, una función `SECURITY DEFINER` que deriva los roles desde `auth.uid()` en el servidor — no es falsificable manipulando `localStorage`. Verificado adicionalmente que toda RPC/tabla sensible exige su propio chequeo de rol server-side (§15, §16), por lo que la app **no depende únicamente de ocultar botones**.
- Usuario sin rol: pantalla "Acceso restringido" con salida a la tienda — no hay bucle de redirección ni crash.
- Primer inicio de sesión forzado: usuarios con `must_change_password=true` se redirigen a un flujo dedicado antes de llegar al panel.
- Recuperación de contraseña / invitación de staff: `invite-staff` exige rol `admin`/`superadmin` (y `superadmin` para asignar `superadmin`); si `provision_staff_roles` falla tras crear el usuario de Auth, la función **elimina** el usuario recién creado para evitar una cuenta huérfana sin roles — patrón de compensación correcto dado que la API de Auth no es transaccional con Postgres.
- **No verificable en esta auditoría** (requeriría credenciales de staff reales o crear una sesión de prueba, lo cual está fuera del alcance de solo lectura): flujo completo de expiración de token/refresco automático en un navegador real, comportamiento exacto de cierre de sesión en múltiples pestañas. Marcado como **pendiente de prueba manual** (ver §36).

## 30. Auditoría de Edge Functions

| Función | Auth | CORS | Idempotencia | Secretos | Listo para Netlify |
|---|---|---|---|---|---|
| `create-order` | `verify_jwt=false` + validación manual de bearer token opcional (permite invitado); `service_role` solo interno | Allowlist vía `ALLOWED_ORIGINS` (env), sin wildcard por defecto | UUID `x-idempotency-key` requerido, validado por regex | `SUPABASE_SERVICE_ROLE_KEY` leída de `Deno.env`, nunca expuesta | Sí — dominio Netlify se agrega solo vía secreto, sin cambio de código |
| `invite-staff` | Igual patrón; exige rol admin/superadmin vía `get_my_access()` | Igual allowlist | Rate-limit 10/hora por admin | Igual | Sí |
| `process-whatsapp-outbox` | Secreto compartido `x-outbox-secret` con comparación de tiempo constante (`safeEqual`) — no JWT, correcto para un worker servidor-a-servidor | Sin CORS (no se llama desde navegador) | Lease vía `claim_notification_deliveries` (`120s`) evita doble envío entre invocaciones concurrentes | `WHATSAPP_ACCESS_TOKEN`/`SUPABASE_SERVICE_ROLE_KEY` de `Deno.env`; respuesta de Meta redactada antes de loguear | Sí |

- **Falla de WhatsApp no revierte el pedido**: confirmado — el commit del pedido ocurre primero (vía la RPC), y el "despertar" del worker de WhatsApp está envuelto en `.catch()` dentro de `EdgeRuntime.waitUntil`, sin afectar la respuesta `201` ya enviada al cliente.
- **Confirmación al usuario aunque falle la notificación**: confirmado por el mismo mecanismo.
- **Errores trazables**: sí — cada función loguea código/hint estructurado, nunca el objeto de error completo ni PII/tokens.

## 31. Auditoría de CORS

- Mecanismo único y centralizado (`supabase/functions/_shared/http.ts`): un solo env var `ALLOWED_ORIGINS` (lista separada por comas), leído en cada request (no compilado). Si no está configurado, el header de origen permitido cae a `"null"` (falla cerrado para CORS de navegador) y `isAllowedOrigin` también rechaza.
- **Agregar el dominio de Netlify no requiere cambio de código** — solo `supabase secrets set ALLOWED_ORIGINS=https://...,https://tu-sitio.netlify.app`, confirmado por `docs/04-instalacion.md` y por el propio código.
- Ningún wildcard peligroso está en el valor por defecto documentado (`.env.example`); el código sí soporta técnicamente `*` si un operador lo configurara así, pero no hay `Access-Control-Allow-Credentials` en ninguna respuesta, por lo que un `*` no combinaría con credenciales (los navegadores ya lo bloquean por su cuenta). **BAJO** — riesgo solo de mala configuración operativa, no un defecto de código.

## 32. Auditoría de variables de entorno

| Variable | Dónde se usa | Expuesta al navegador | Estado |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `src/lib/env.ts` | Sí (por diseño, pública) | Documentada en `.env.example` |
| `VITE_SUPABASE_ANON_KEY` | `src/lib/env.ts` | Sí (por diseño, pública, protegida por RLS) | Documentada |
| `VITE_APP_URL` | `src/lib/env.ts` (definida pero **sin ningún consumidor** en `src/`, código muerto) | Sí, si se define | Documentada — **H-16 (BAJO)**, variable/export sin uso |
| `VITE_ENABLE_DEMO_DATA` | `src/lib/env.ts` | Sí | Documentada |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions únicamente (`Deno.env`) | **No** — confirmado ausente del bundle | Correcto, nunca con prefijo `VITE_` |
| `SUPABASE_ACCESS_TOKEN` | Solo scripts locales/CLI | No | Correcto |
| `ALLOWED_ORIGINS`, `STAFF_INVITE_REDIRECT_URL`, `WHATSAPP_ACCESS_TOKEN`, `OUTBOX_WORKER_SECRET` | Edge Functions / Supabase secrets | No | Correcto — nunca con prefijo `VITE_` |

`STAFF_INVITE_REDIRECT_URL` se lee de `Deno.env` y se omite del payload de invitación si no está definida (usa el default de Supabase Auth) — mover de localhost a Netlify es un cambio de secreto, no de código.

---

## 33. Preparación para Netlify

| Configuración | Valor esperado | Valor encontrado | Estado | Acción necesaria |
|---|---|---|---|---|
| Build command | `npm run build` | `npm run build` (`netlify.toml:2`) | ✅ | Ninguna |
| Publish directory | `dist` | `dist` (`netlify.toml:3`) | ✅ | Ninguna |
| Node version | ≥20.19 | `NODE_VERSION="20"` (`netlify.toml:6`); `engines.node ">=20.19"` en `package.json` | ✅ (Netlify provee Node 20.x reciente) | Confirmar con un build real en Netlify que el patch exacto sea ≥20.19 |
| npm version | Sin pin explícito | No fijada en `netlify.toml`/`package.json` | ⚠️ INFORMATIVO | Opcional: fijar `NPM_VERSION` si se requiere reproducibilidad exacta |
| package-lock consistente | Sí | `lockfileVersion 3`, nombre/versión coincide con `package.json` | ✅ | Ninguna |
| SPA redirect | `/* → /index.html 200` | Presente en `netlify.toml` (no hay `public/_redirects`, pero no hace falta) | ✅ | Ninguna |
| Recarga directa de `/admin/pedidos/:id`, seguimiento, etc. | Debe servir `index.html` | Cubierto por el redirect catch-all | ✅ (no probado en un despliegue real — **pendiente de prueba post-despliegue**) | Verificar tras el primer deploy |
| Variables `VITE_*` necesarias | 4 documentadas | Coinciden exactamente con `import.meta.env` usado en `src/` | ✅ | Configurar en Netlify UI |
| Variables privadas fuera del cliente | Ninguna con `VITE_` | Confirmado — ver §32 | ✅ | Ninguna |
| Rutas absolutas locales / `C:\Users\...` | Ninguna en `src/` | Confirmado ausente | ✅ | Ninguna |
| URLs hardcodeadas a localhost en producción | Ninguna | Solo fallbacks internos del SDK y `env.ts` (nunca alcanzados en un navegador real) | ✅ | Ninguna |
| Assets/imágenes válidos | — | `public/assets`, `og.png`, `offline.html` presentes | ✅ | Ninguna |
| Service worker | Configurado si existe | `vite-plugin-pwa`, `registerType:'autoUpdate'`, `navigateFallback:/offline.html` | ⚠️ INFORMATIVO | Ver riesgo de caché inmutable de `/assets/*` tras redeploy — documentar aviso de "recarga forzada" en el runbook |
| HTTPS | Requerido | Netlify lo provee por defecto | ✅ | Ninguna |
| CSP / headers | Recomendado | Presente y completo en `netlify.toml` (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP con `connect-src`/`img-src` a `*.supabase.co`) | ✅ | Ninguna |
| Tamaño de bundle | Advertencia si >500kB | Varios chunks >500kB (`index-*.js` ~663kB) | ⚠️ BAJO | Recomendable code-splitting adicional, no bloqueante |
| Favicon/metadatos | Presentes | OG tags, Twitter card, favicon, título, todos presentes en `index.html` | ✅ | Ninguna |
| Supabase Auth URL Configuration | Debe incluir el dominio Netlify final | **No verificable desde el repositorio** — es configuración del panel de Supabase, no del código | ⏳ PENDIENTE | Agregar el dominio Netlify a "Redirect URLs" en Supabase Auth antes de ir a vivo |
| `ALLOWED_ORIGINS` | Debe incluir el dominio Netlify final | Actualmente apunta a localhost/dev (según `.env.example`); no verificable si ya se configuró el secreto real en el proyecto productivo desde este repositorio | ⏳ PENDIENTE | `supabase secrets set ALLOWED_ORIGINS=...` con el dominio final antes de ir a vivo |
| `STAFF_INVITE_REDIRECT_URL` | Debe apuntar al dominio Netlify final | Igual — no verificable el valor del secreto en vivo desde el repo | ⏳ PENDIENTE | `supabase secrets set STAFF_INVITE_REDIRECT_URL=...` |
| Proceso de rollback | Debe existir | No documentado explícitamente en `docs/` más allá de lo genérico de Netlify (rollback a deploy anterior vía UI) | ⚠️ MEDIO | Documentar el procedimiento (ver §37) |

## 34. Matriz de riesgos (hallazgos)

Severidades: CRÍTICO / ALTO / MEDIO / BAJO / INFORMATIVO.

---

**ID: H-05**
**Severidad:** ALTO
**Módulo:** Pagos
**Descripción:** `register_payment`/`deliver_and_pay_order` regeneran su llave de idempotencia por defecto en cada llamada, y el frontend (`PaymentsPage.tsx`, `DeliverAndPayModal.tsx`) nunca envía una llave propia — confirmado por grep (cero ocurrencias de `idempotency` en ambos archivos).
**Evidencia:** `supabase/migrations/202607180005_fix_register_payment_enum_cast.sql:23` (`p_idempotency_key uuid default gen_random_uuid()`); `supabase/migrations/202607180004_admin_flexible_transitions.sql:340`; grep de `idempotency` en `src/pages/admin/PaymentsPage.tsx` y `src/features/admin/orders/DeliverAndPayModal.tsx` sin resultados.
**Archivo o función:** `register_payment` (9-arg y 5-arg), `deliver_and_pay_order`; `src/pages/admin/PaymentsPage.tsx`, `src/features/admin/orders/DeliverAndPayModal.tsx`.
**Impacto:** un reintento de red tras un timeout percibido por el cliente (pero éxito real en el servidor) puede registrar un pago parcial duplicado — dinero contado dos veces en caja/cartera.
**Cómo reproducir:** registrar un abono parcial; simular latencia/timeout después de que el servidor ya procesó la petición; reintentar con el mismo monto.
**Recomendación:** generar una llave de idempotencia estable en el frontend por intento de pago y reenviarla en reintentos (mismo patrón que `create-order`); agregar manejo de `unique_violation` en `register_payment` (ver H-06).
**Bloquea producción:** Sí

---

**ID: H-13**
**Severidad:** ALTO
**Módulo:** Pedidos / Pagos (roles)
**Descripción:** `deliver_and_pay_order` acepta el rol `contabilidad`, pero delega en `transition_order_status`, que no lo acepta — un usuario solo-`contabilidad` no puede usar "Entregar y pagar" sobre un pedido que aún no está entregado (el caso de uso principal de la función).
**Evidencia:** `supabase/migrations/202607180004_admin_flexible_transitions.sql:44` (`require_staff(['superadmin','admin','vendedor','bodega'])`) vs. línea 355 (`require_staff(['superadmin','admin','vendedor','contabilidad'])`).
**Archivo o función:** `transition_order_status`, `deliver_and_pay_order`.
**Impacto:** bloquea una operación comercial principal para un rol explícitamente autorizado a usarla; falla de forma segura (transacción revertida, sin corrupción) pero interrumpe el flujo de trabajo.
**Cómo reproducir:** con un usuario cuyo único rol sea `contabilidad`, invocar `deliver_and_pay_order` sobre un pedido en estado distinto de `delivered`.
**Recomendación:** alinear las listas de roles entre ambas funciones.
**Bloquea producción:** Sí

---

**ID: H-14**
**Severidad:** ALTO
**Módulo:** Frontend / Resiliencia
**Descripción:** El `ErrorBoundary` solo envuelve `/admin/*`; ninguna ruta pública de la tienda (`/`, `/pedido-confirmado`, `/seguir`, `/mis-pedidos`) tiene protección contra un error de renderizado — el bug histórico de "pantalla en blanco" solo quedó corregido para el panel administrativo, no para el flujo de venta.
**Evidencia:** `src/App.tsx:86` (`<ErrorBoundary>` envuelve únicamente `<AdminLayout/>`); ausencia confirmada de `ErrorBoundary` en cualquier ruta pública.
**Archivo o función:** `src/App.tsx`.
**Impacto:** un error de renderizado no capturado durante el checkout (la ruta de mayor tráfico e ingresos) deja al comprador con una pantalla en blanco sin ninguna vía de recuperación, bloqueando por completo las ventas hasta que recargue manualmente.
**Cómo reproducir:** forzar una excepción de renderizado en `StorefrontPage`/`OrderConfirmationPage`/`OrderTrackingPage` (p. ej. un dato inesperado del catálogo) y observar que no hay UI de recuperación.
**Recomendación:** envolver el árbol completo en `App.tsx` (o al menos cada ruta pública) con `ErrorBoundary`.
**Bloquea producción:** Sí

---

**ID: H-03**
**Severidad:** ALTO
**Módulo:** Pagos (UI)
**Descripción:** `OrdersTable.tsx` abre `DeliverAndPayModal` con `payments={[]}` hardcodeado (nunca obtiene los pagos reales del pedido), por lo que "Ya pagado"/"Saldo pendiente"/el monto prellenado son incorrectos para cualquier pedido con pago parcial previo, cuando se abre desde el listado de pedidos (funciona correctamente cuando se abre desde el detalle del pedido, que sí pasa los pagos reales).
**Evidencia:** `src/features/admin/orders/OrdersTable.tsx:308-315`; contraste con `src/pages/admin/OrderDetailPage.tsx:519-525` (que sí pasa `payments` reales).
**Archivo o función:** `OrdersTable.tsx`, `DeliverAndPayModal.tsx`.
**Impacto:** staff podría intentar registrar un pago por el monto total cuando en realidad ya hay un abono, generando confusión operativa; el backend rechazaría un sobrepago real (protegido por H-18/constraint), pero el dato mostrado en pantalla es incorrecto y puede llevar a decisiones erróneas antes de llegar a ese límite.
**Cómo reproducir:** registrar un abono parcial a un pedido; abrir "Entregar y pagar" desde `/admin/pedidos` (no desde el detalle) y observar el saldo mostrado.
**Recomendación:** obtener los pagos reales del pedido antes de abrir el modal desde el listado, o reutilizar la misma carga de datos que usa `OrderDetailPage`.
**Bloquea producción:** Sí

---

**ID: H-01**
**Severidad:** INFORMATIVO (ya corregido, verificado en vivo)
**Módulo:** Base de datos / Permisos
**Descripción:** Entre la migración inicial y `202607180007`, los privilegios por defecto de Postgres otorgaron a `anon` acceso de lectura/escritura sobre ~32 tablas de negocio y ejecución sobre toda función `SECURITY DEFINER`, sin que ninguna migración lo revocara explícitamente hasta `202607180007`/`202607180008`.
**Evidencia:** `supabase/migrations/202607180007_harden_anon_default_privileges.sql:14-31,62-119`; verificado en vivo con la anon key real (§16) que hoy `anon` no tiene acceso a ninguna tabla de negocio.
**Archivo o función:** privilegios por defecto de esquema (no específico de una función).
**Impacto:** ninguno hoy — corregido y verificado. Riesgo histórico: mientras estuvo presente, RLS y `require_staff()` seguían bloqueando el acceso efectivo, por lo que la propia migración documenta que no era explotable, pero era una capa de defensa en profundidad rota.
**Cómo reproducir:** N/A (ya corregido).
**Recomendación:** ninguna acción requerida; se documenta como antecedente y como argumento para agregar una prueba automatizada que falle si `anon` vuelve a obtener privilegios por defecto en el futuro (ver H-19).
**Bloquea producción:** No

---

**ID: H-08**
**Severidad:** MEDIO
**Módulo:** Clientes / RLS
**Descripción:** `customers.pin_hash` es legible por todo el personal autenticado (vendedor, bodega, contabilidad), no solo administradores, como efecto colateral necesario de la corrección del bug "permission denied for table customers".
**Evidencia:** `supabase/migrations/202607180006_fix_admin_panel_permissions.sql:37-38,48`.
**Archivo o función:** GRANT de tabla sobre `customers`.
**Impacto:** exposición innecesaria de un hash bcrypt a roles sin necesidad operativa de verlo (p. ej. bodega); no revela el PIN en texto plano, pero amplía la superficie de riesgo.
**Cómo reproducir:** consultar `customers.pin_hash` con una sesión de rol `bodega`.
**Recomendación:** si PostgREST lo permite en la versión usada, evaluar una vista `customers_staff` sin `pin_hash` para roles no administrativos, o mover `pin_hash` a una tabla separada con RLS propia solo para admin.
**Bloquea producción:** No

---

**ID: H-09**
**Severidad:** INFORMATIVO
**Módulo:** Productos / RLS
**Descripción:** `vendedor` y `bodega` pueden leer costos y márgenes exactos (`current_cost`, `average_cost`, `unit_cost`, `gross_profit`) de todo el catálogo/pedidos, no solo `contabilidad`/administradores.
**Evidencia:** política `operational_staff_read` sobre `products`/`order_items`, sin restricción de columna.
**Archivo o función:** RLS de `products`, `order_items`.
**Impacto:** depende de la política de negocio del cliente; no es un defecto técnico.
**Cómo reproducir:** consultar `products.current_cost` con sesión `vendedor`.
**Recomendación:** confirmar con el negocio si es intencional; si no, restringir a columnas públicas para esos roles.
**Bloquea producción:** No

---

**ID: H-06**
**Severidad:** MEDIO
**Módulo:** Pagos
**Descripción:** `register_payment` no tiene un manejador `exception when unique_violation`, a diferencia de `create_order`. Una carrera con la misma llave de idempotencia (dos peticiones simultáneas con el mismo `p_idempotency_key`) puede exponer un error crudo de PostgreSQL al usuario en vez de devolver el pago ya existente.
**Evidencia:** `supabase/migrations/202607180005_fix_register_payment_enum_cast.sql:14-158` (sin bloque `exception`); contraste con `supabase/migrations/202607190001_fix_dashboard_reports_bogota_costs.sql:515-522`.
**Archivo o función:** `register_payment`.
**Impacto:** no duplica el pago (la constraint de unicidad lo impide), pero el usuario ve un error técnico en vez de una confirmación — UX pobre en una carrera de milisegundos, poco probable pero posible en reintentos rápidos.
**Cómo reproducir:** disparar dos llamadas concurrentes con el mismo `p_idempotency_key` antes de que la primera confirme.
**Recomendación:** agregar el mismo patrón `exception when unique_violation` que usa `create_order`.
**Bloquea producción:** No

---

**ID: H-10**
**Severidad:** MEDIO
**Módulo:** Base de datos / Integridad
**Descripción:** `orders.gross_profit`/`orders.sales_cost` no tienen CHECK/trigger que los reconcilie contra `sum(order_items.total_cost)` — son columnas denormalizadas mantenidas solo por disciplina de las RPC. Es la misma clase de columna que permitió el bug de costo-cero histórico.
**Evidencia:** `supabase/migrations/202607170001_core_schema.sql:560-561` (sin CHECK relacional); reparación manual que tuvo que hacerse en `202607190001_fix_dashboard_reports_bogota_costs.sql:712-782`.
**Archivo o función:** tabla `orders`.
**Impacto:** un futuro bug en cualquier función que escriba `orders` podría volver a desincronizar estas columnas sin que ningún constraint lo impida.
**Cómo reproducir:** N/A (gap estructural, no un bug activo hoy — ya verificado que PED-00000001 está correcto).
**Recomendación:** agregar un trigger de reconciliación o una prueba automatizada periódica que compare ambos valores.
**Bloquea producción:** No

---

**ID: H-04**
**Severidad:** MEDIO
**Módulo:** Pedidos
**Descripción:** El frontend genera una llave de idempotencia nueva en cada `submit()` de checkout — un reintento manual tras un fallo percibido (no un doble clic, que sí está protegido) podría crear un pedido duplicado si el servidor procesó el primer intento.
**Evidencia:** `src/pages/StorefrontPage.tsx:67` (`crypto.randomUUID()` por llamada a `submit()`).
**Archivo o función:** `StorefrontPage.tsx`.
**Impacto:** menor que H-05 porque `create_order` sí tiene manejo robusto de `unique_violation`, pero eso solo protege reintentos con la **misma** llave — con una llave nueva, un segundo pedido genuino se crea.
**Cómo reproducir:** timeout de red tras éxito del servidor; reintento manual del mismo carrito.
**Recomendación:** persistir la llave de idempotencia del intento en curso (no regenerarla) hasta confirmar éxito o fallo definitivo.
**Bloquea producción:** No

---

**ID: H-19**
**Severidad:** MEDIO
**Módulo:** Calidad / CI
**Descripción:** No existe integración continua (`.github/workflows` ausente). La suite pgTAP (20 aserciones sobre las RPC reales) no está conectada a ningún script `npm`/CI y requiere Docker/Supabase local para ejecutarse manualmente — en la práctica, nunca se ejecuta de forma automatizada.
**Evidencia:** ausencia de `.github/`; `package.json` sin script `test:db`/equivalente; `supabase/tests/transactional_api_test.sql` existe pero sin punto de entrada automatizado.
**Archivo o función:** N/A (infraestructura de CI).
**Impacto:** typecheck/lint/test/build/npm audit solo se ejecutan si alguien los corre manualmente antes de cada cambio; ninguna prueba automatizada ejercita las RPC reales de Supabase (los 88 tests de Vitest validan TypeScript puro y un modelo de dominio paralelo, no las funciones PL/pgSQL en producción).
**Cómo reproducir:** N/A.
**Recomendación:** agregar un workflow de GitHub Actions que corra `npm run typecheck && npm run lint && npm test && npm run build` en cada PR, y opcionalmente un job separado con `supabase start && supabase test db` para la suite pgTAP.
**Bloquea producción:** No

---

**ID: H-11 / H-12 / H-16**
**Severidad:** BAJO
**Módulo:** Higiene de código
**Descripción:** (H-11) definición contradictoria mas inerte de `request_rate_limits` entre dos migraciones; (H-12) columnas `products.featured`/`products.image_url` sin uso; (H-16) `env.appUrl` definida y documentada pero sin ningún consumidor en `src/`.
**Evidencia:** ver §14 y §32.
**Impacto:** ninguno funcional; deuda técnica menor.
**Recomendación:** limpiar en un ciclo de mantenimiento futuro.
**Bloquea producción:** No

---

**ID: H-15**
**Severidad:** BAJO
**Módulo:** Fechas
**Descripción:** `formatDate`/`formatDateTime` en `src/lib/format.ts` no tienen el guardia `isBareSqlDate` que sí tiene `formatAdminDate`; hoy no se usan con ningún campo `DATE` puro, pero es una trampa latente sin prueba que lo impida.
**Evidencia:** `src/lib/format.ts:11-24`.
**Recomendación:** aplicar el mismo guardia por consistencia, o documentarlas explícitamente como "solo timestamptz".
**Bloquea producción:** No

---

**ID: H-17**
**Severidad:** BAJO
**Módulo:** Netlify / PWA
**Descripción:** El service worker (`registerType:'autoUpdate'`) junto con `Cache-Control: immutable` de un año en `/assets/*` puede dejar a un usuario con una pestaña abierta sirviendo la versión anterior de la app durante un tiempo tras el redeploy.
**Evidencia:** `vite.config.ts:8-59`, `netlify.toml:22-25`.
**Recomendación:** documentar en el runbook de despliegue que puede requerirse una recarga forzada tras publicar; considerar un prompt de "nueva versión disponible" en la UI.
**Bloquea producción:** No

---

**ID: H-18**
**Severidad:** INFORMATIVO
**Módulo:** Pagos (verificación cruzada, no un defecto)
**Descripción:** Doble capa de protección contra sobrepago confirmada — CHECK `orders_paid_check` (`amount_paid <= total_amount`) a nivel de tabla, más el rechazo explícito en `register_payment` a nivel de aplicación. Se documenta como evidencia positiva citada por H-03/H-05, no como hallazgo independiente que requiera acción.
**Bloquea producción:** No

---

## 35. Pruebas automatizadas faltantes

No se escribió ninguna prueba nueva (fuera del alcance de esta auditoría); se especifica qué debería probarse, dónde y con qué criterio de aceptación.

| Área | Dónde | Criterio de aceptación |
|---|---|---|
| Creación de pedidos (RPC real) | pgTAP o test de integración contra Supabase local | `create_order` con payload manipulado (precio/total falso) debe ignorar esos campos y calcular el total real; pedido duplicado con la misma `idempotency_key` debe devolver el mismo `order_id`, no crear uno nuevo |
| Concurrencia de inventario | pgTAP con dos sesiones concurrentes | Dos `create_order` simultáneos sobre la última unidad disponible: exactamente uno debe tener éxito, el otro debe fallar con `OUT_OF_STOCK`, sin stock negativo |
| Pagos parciales / completos / doble pago | pgTAP | Dos llamadas a `register_payment` con la **misma** `idempotency_key` deben devolver el mismo `payment_id` sin duplicar `amount_paid`; con distinta llave y mismo monto, hoy sí duplica (documentar como regresión esperada hasta resolver H-05) |
| Entregar y pagar | pgTAP | Doble ejecución de `deliver_and_pay_order` sobre el mismo pedido no debe duplicar el movimiento de inventario ni el pago cuando se reutiliza la llave; con rol `contabilidad` sobre un pedido no entregado debe fallar hoy (documentar H-13 hasta resolverlo) |
| Cancelaciones / devoluciones | pgTAP | Cancelar libera exactamente la cantidad reservada; devolver repone exactamente la cantidad entregada; ninguna de las dos operaciones es posible dos veces sobre el mismo pedido |
| RLS / roles | pgTAP con `set local role`/`request.jwt.claims` por cada rol | Cada tabla de negocio: `anon` sin acceso; `authenticated` sin rol staff sin acceso a tablas base; cada rol operativo con exactamente los privilegios de la matriz de §16 |
| Fechas PostgreSQL DATE / America/Bogota | Vitest (ya existe cobertura parcial) + pgTAP | Ampliar a `due_date`, `expense_date`, `purchase_date`, `valid_from`/`valid_until` con casos de timestamp cercano a medianoche Bogotá |
| Reportes / exportaciones | Vitest (snapshot) o E2E | El CSV/Excel/PDF exportado para un rango de fechas fijo debe coincidir exactamente (fila por fila) con lo mostrado en pantalla |
| Costos históricos | pgTAP | Cambiar `products.current_cost` después de crear un pedido no debe alterar `order_items.unit_cost` de pedidos ya creados |
| Valor de inventario | pgTAP | `report_inventory_snapshot`/`get_dashboard_metrics.inventory_value` con un producto que nunca recibió compra (`average_cost=0`) debe usar `current_cost`, no `0` |
| Edge Functions | Test de Deno o integración HTTP | `create-order` rechaza origen no permitido (403); rechaza `idempotency-key` mal formado; `invite-staff` rechaza rol no-admin; `process-whatsapp-outbox` rechaza secreto incorrecto |
| Errores de red / idempotencia | E2E (Playwright/Cypress) | Simular timeout tras éxito del servidor en checkout y en registro de pago; verificar que un reintento no duplica (hoy fallaría para pagos — documentar como test que debe quedar en rojo hasta resolver H-05) |
| Métodos de pago | Vitest/E2E | El formulario de pago solo permite seleccionar métodos con `is_active=true`, envía siempre un UUID real |
| Navegación SPA | E2E o smoke test post-deploy | Recarga directa (`F5`) de `/admin/pedidos/:id`, `/seguir/:token`, etc. devuelve 200 con el shell de la SPA, no 404 |

## 36. Protocolo de prueba manual

Cada prueba: precondición → acción → resultado esperado → evidencia a capturar → aprobado/reprobado (a completar por quien ejecute la prueba).

1. **Inicio de sesión admin** — Precondición: usuario staff con contraseña conocida. Acción: iniciar sesión en `/admin/acceso`. Esperado: redirección al dashboard, roles correctos visibles. Evidencia: captura de pantalla del dashboard con el nombre de usuario.
2. **Creación de producto** — Precondición: sesión admin. Acción: crear un producto nuevo con costo y precio. Esperado: aparece en el catálogo interno; `stock_on_hand=0` hasta la primera entrada. Evidencia: captura del producto creado.
3. **Entrada de inventario** — Precondición: producto creado. Acción: registrar una compra/recepción. Esperado: `stock_on_hand` aumenta exactamente en la cantidad recibida; `current_cost`/`average_cost` se actualizan. Evidencia: captura del kardex antes/después.
4. **Creación de cliente** — Precondición: sesión con rol `vendedor`/`contabilidad`. Acción: crear cliente nuevo con celular válido. Esperado: aparece en el listado, sin duplicados si se repite el mismo celular. Evidencia: captura.
5. **Creación de pedido** — Precondición: producto con stock. Acción: completar checkout público con ese producto. Esperado: pedido creado con total correcto, sin importar manipulación de DevTools sobre el precio mostrado. Evidencia: número de pedido + confirmación.
6. **Confirmación** — Precondición: pedido en `new`. Acción: pasar a `confirmed` desde el panel. Esperado: aparece en historial con actor y fecha. Evidencia: captura del historial.
7. **Entrega y pago** — Precondición: pedido confirmado, rol `vendedor`/`admin`. Acción: usar "Entregar y pagar" por el saldo completo. Esperado: estado `delivered`, `payment_status=paid`, stock descontado exactamente una vez. Evidencia: captura antes/después de stock y estado.
8. **Pago parcial** — Precondición: pedido con saldo pendiente. Acción: registrar un abono menor al saldo. Esperado: `payment_status=partial`, saldo correcto. Evidencia: captura del saldo.
9. **Cancelación** — Precondición: pedido no entregado. Acción: cancelar con motivo obligatorio. Esperado: reserva de inventario liberada, motivo visible en historial. Evidencia: captura de stock antes/después.
10. **Devolución** — Precondición: pedido entregado. Acción: marcar como devuelto con motivo. Esperado: stock repuesto, estadísticas de cliente revertidas. Evidencia: captura de stock antes/después.
11. **Reporte** — Precondición: al menos un pedido entregado en el rango. Acción: generar "Ventas por día" para el mes actual. Esperado: la fila del pedido aparece en la fecha de entrega correcta (America/Bogota), no un día antes. Evidencia: captura de la tabla.
12. **Exportación** — Precondición: reporte generado. Acción: exportar CSV, Excel y PDF. Esperado: las tres exportaciones muestran exactamente los mismos valores que la pantalla, incluida la fecha. Evidencia: los tres archivos descargados.
13. **Cambio de costo** — Precondición: producto con pedidos históricos. Acción: actualizar `current_cost` del producto (vía una compra nueva, no edición directa). Esperado: pedidos anteriores conservan su `unit_cost` original. Evidencia: comparar `order_items.unit_cost` de un pedido viejo antes/después del cambio.
14. **Comprobación de costo histórico** — Continuación del punto 13. Acción: abrir el detalle de un pedido antiguo. Esperado: costo y utilidad del pedido no cambiaron. Evidencia: captura del detalle del pedido.
15. **Sesión expirada** — Precondición: sesión activa. Acción: invalidar/expirar el token (esperar o forzar). Esperado: la siguiente acción redirige a login sin crash. Evidencia: captura del mensaje/redirección.
16. **Usuario sin permisos** — Precondición: usuario autenticado sin rol asignado. Acción: navegar a `/admin`. Esperado: pantalla "Acceso restringido", no un error crudo ni pantalla en blanco. Evidencia: captura.
17. **Recarga directa de rutas** — Precondición: app desplegada en Netlify. Acción: pegar directamente la URL de `/admin/pedidos/:id` y `/seguir/:token` en una pestaña nueva. Esperado: carga correctamente, sin 404. Evidencia: captura.
18. **Prueba desde móvil** — Precondición: dispositivo móvil real o emulado. Acción: completar un pedido de punta a punta. Esperado: UI usable, checkout completo sin errores de layout. Evidencia: capturas del flujo.
19. **Prueba con red lenta** — Precondición: throttling de red (DevTools "Slow 3G"). Acción: completar checkout y registrar un pago. Esperado: botones deshabilitados durante la espera, sin duplicar la acción; **prestar atención especial a un posible pago duplicado (H-05)**. Evidencia: verificar en la base de datos que solo existe un pago/pedido.
20. **Doble clic** — Precondición: formulario de pago o checkout abierto. Acción: doble clic rápido en "Confirmar"/"Registrar pago". Esperado: una sola operación se ejecuta. Evidencia: verificar que no hay duplicados.

## 37. Plan de rollback

No documentado explícitamente en el repositorio más allá de las capacidades genéricas de Netlify. Plan mínimo recomendado (no implementado, solo propuesto):

1. **Frontend**: Netlify conserva cada deploy anterior — rollback es "Publish deploy" sobre la versión previa desde el panel de Netlify (sin cambio de código). Documentar esto explícitamente en `docs/`.
2. **Base de datos**: las migraciones son aditivas (ver §14) — no hay necesidad de "revertir" una migración de esquema en el flujo normal. Si una migración futura resulta problemática, `supabase db push` de una migración correctiva nueva es preferible a un `down`-migration no existente en este proyecto.
3. **Edge Functions**: `supabase functions deploy <nombre>` de la versión anterior del código (requiere tener el commit anterior a mano — ya lo provee git).
4. **Secretos**: documentar los valores de `ALLOWED_ORIGINS`/`STAFF_INVITE_REDIRECT_URL` antes de cambiarlos, para poder revertirlos.
5. **Service worker**: dado el `Cache-Control: immutable` de los assets (H-17), un rollback de frontend debe ir acompañado de una comunicación a los usuarios activos (o esperar a que el `autoUpdate` del SW se propague) si el rollback ocurre poco después del deploy problemático.

**Acción necesaria antes de producción**: formalizar este plan como un documento en `docs/` (no existe hoy un `docs/10-rollback.md` o equivalente).

---

## 38. Veredicto final

### NO APROBADO PARA PRODUCCIÓN

Existen **4 hallazgos ALTO** sin resolver (H-03, H-05, H-13, H-14), lo cual excluye por regla explícita cualquier veredicto de aprobación. Ninguno de los hallazgos es CRÍTICO (no hay pérdida de datos activa, no hay brecha de seguridad explotable hoy, PED-00000001 y las cifras financieras verificadas están correctas), y la arquitectura de fondo (RLS, funciones `SECURITY DEFINER`, congelamiento de costos, protección de inventario, CORS, manejo de secretos) es sólida y está bien evidenciada. Pero los 4 hallazgos ALTO representan riesgo comercial real y directo (pagos potencialmente duplicados, un rol bloqueado en una función core, y ausencia de red de seguridad en la ruta de ingresos) que debe resolverse antes de operar con dinero y clientes reales.

### Tabla de control

| Control | Estado | Evidencia | Bloquea despliegue |
|---|---|---|---|
| Typecheck | ✅ Aprobado | §8 | No |
| Lint | ✅ Aprobado | §9 | No |
| Tests (Vitest) | ✅ Aprobado (con salvedad, H-19) | §10 | No |
| Build | ✅ Aprobado | §11 | No |
| npm audit | ✅ Aprobado (0 vulnerabilidades) | §12 | No |
| RLS habilitado en todas las tablas | ✅ Aprobado | §16 | No |
| `anon` sin acceso a tablas de negocio | ✅ Aprobado (verificado en vivo) | §16 | No |
| Precios/costos calculados en servidor | ✅ Aprobado | §17, §21 | No |
| Costo histórico congelado | ✅ Aprobado | §21 | No |
| PED-00000001 íntegro y sin modificar | ✅ Aprobado | §20 | No |
| Fechas America/Bogota (dashboard/reportes) | ✅ Aprobado | §27, §28 | No |
| Idempotencia de pagos | ❌ Falla (H-05) | §18, §34 | **Sí** |
| Rol `contabilidad` en Entregar y Pagar | ❌ Falla (H-13) | §15, §34 | **Sí** |
| ErrorBoundary en tienda pública | ❌ Falla (H-14) | §34 | **Sí** |
| Saldo correcto en modal de pago desde listado | ❌ Falla (H-03) | §34 | **Sí** |
| Netlify — build/redirects/headers/CSP | ✅ Aprobado | §33 | No |
| Secretos fuera del bundle | ✅ Aprobado | §11, §32 | No |
| Supabase Auth URL / `ALLOWED_ORIGINS` / `STAFF_INVITE_REDIRECT_URL` con dominio final | ⏳ Pendiente (configuración de despliegue, no de código) | §33 | Sí, como paso de configuración |
| Integración continua | ❌ Ausente (H-19) | §34 | No (pero fuertemente recomendado) |
| Plan de rollback documentado | ❌ Ausente | §37 | No (pero fuertemente recomendado) |

### A. Correcciones obligatorias antes de Netlify

1. Resolver H-05 (idempotencia de pagos): generar y reenviar una llave de idempotencia estable desde `PaymentsPage`/`DeliverAndPayModal`.
2. Resolver H-13 (rol `contabilidad` bloqueado en `deliver_and_pay_order`): alinear las listas de roles.
3. Resolver H-14 (sin ErrorBoundary en la tienda pública): envolver las rutas públicas.
4. Resolver H-03 (saldo incorrecto en el modal abierto desde el listado de pedidos): cargar pagos reales antes de abrir el modal.

### B. Correcciones recomendadas (no bloqueantes)

5. H-06 — manejar `unique_violation` en `register_payment`.
6. H-10 — trigger/prueba de reconciliación para `orders.gross_profit`/`sales_cost`.
7. H-04 — no regenerar la llave de idempotencia del checkout en reintentos.
8. H-08 — restringir `pin_hash` a roles administrativos.
9. H-09 — confirmar con el negocio si vendedor/bodega deben ver costos/márgenes.
10. H-19 — configurar CI (GitHub Actions) con los 4 comandos + `npm audit`.
11. H-15/H-17 — endurecer `formatDate`/`formatDateTime`; documentar aviso de caché de service worker.
12. H-11/H-12/H-16 — limpieza de deuda técnica menor.

### C. Configuración que debe hacerse durante el despliegue

13. Agregar el dominio final de Netlify a **Supabase Auth → URL Configuration → Redirect URLs**.
14. `supabase secrets set ALLOWED_ORIGINS=https://tu-sitio.netlify.app` (manteniendo `localhost` para desarrollo si se desea).
15. `supabase secrets set STAFF_INVITE_REDIRECT_URL=https://tu-sitio.netlify.app/admin/acceso`.
16. Configurar las 4 variables `VITE_*` en el panel de Netlify (nunca `SUPABASE_SERVICE_ROLE_KEY` ni tokens de WhatsApp/outbox).
17. Confirmar `NODE_VERSION` en Netlify resuelve a ≥20.19.
18. Documentar y practicar el plan de rollback (§37) antes del primer despliegue real.

### D. Pruebas que deben repetirse después del despliegue

19. Protocolo manual completo (§36), puntos 17-20 en particular (recarga directa de rutas, red lenta, doble clic) ya en el dominio real de Netlify.
20. Confirmar en el navegador real (no solo en el bundle) que no hay llamadas a `localhost` ni errores de CORS contra el dominio de Netlify.
21. Re-ejecutar la verificación en vivo de RLS (§16) contra el proyecto productivo una vez el tráfico real comience, como chequeo de salud periódico.
22. Verificar que el primer login de un usuario invitado después del despliegue usa el nuevo `STAFF_INVITE_REDIRECT_URL`.

---

*Fin del informe. Ningún archivo de código, dato, migración o configuración fue modificado durante esta auditoría. No se realizaron commits ni push. No se ejecutó ningún despliegue.*
