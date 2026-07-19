# Informe: corrección de estadísticas del tablero, reportes y costos históricos

Proyecto Supabase: `rkksmtdbcrfaaiufehke` ("Chorizos ensayo"). Repositorio: `plataforma-chorizos-comercial-entrega`.

## 1. Causa raíz

Se identificaron **cuatro bugs independientes** que, combinados, producían los 13 síntomas reportados:

1. **`order.total` no existe.** El tablero (`AdminDashboardPage.tsx`) y `CustomerDetailPage.tsx`
   leían `order.total` para sumar ventas, pero la columna real de la tabla `orders` es
   `total_amount`. `order.total` era siempre `undefined`, y `toNumber(undefined)` da `0`. Esto
   explica por qué **ventas de hoy/ayer/semana/mes** y **ticket promedio** mostraban `$0` mientras
   que "Recaudado" (que usa `payments.amount`) y "Entregados" (que usa `order.status`, no
   `order.total`) sí mostraban valores correctos. El helper `orderTotal()` que resuelve este alias
   ya existía en `types.ts` con pruebas de regresión, pero el tablero no lo usaba.

2. **La regla de negocio de "venta" no se aplicaba.** El tablero sumaba pedidos filtrando solo
   `status not in ('cancelled','returned')` y agrupaba por `created_at`, en vez de exigir
   `status = 'delivered'` y agrupar por `delivered_at`. Esto desalinea el tablero con el reporte
   "Ventas por día" (`report_sales_by_day`), que sí exige entrega.

3. **`getDateRange()` dependía de la zona horaria del navegador/SO, no de América/Bogotá.**
   Usaba `new Date()` + `setHours(0,0,0,0)`, que calcula "medianoche" en la zona horaria local del
   cliente que ejecuta el código — no necesariamente Bogotá. Si el navegador/SO no está en
   `America/Bogota`, los límites de "hoy/ayer/semana/mes" quedan desplazados. Esta es la causa
   estructural detrás del síntoma "el reporte ubica la venta en el día equivocado": el cálculo de
   límites de fecha en el cliente nunca garantizaba usar Bogotá.

4. **Bug de costo cero en `create_order()`.** El cálculo del costo histórico era:
   ```sql
   v_unit_cost := coalesce(v_product.average_cost, v_product.current_cost, 0);
   ```
   `average_cost` tiene `default 0` (no `null`) hasta que un producto recibe su primera compra.
   `coalesce()` solo salta valores `NULL`, no ceros, así que con `average_cost = 0` (aún sin
   compras registradas) el cálculo **nunca** caía a `current_cost` (que sí tenía el costo real:
   `$10.000`). Por eso `order_items.unit_cost` quedó en `0` para los tres ítems del pedido
   `PED-00000001`, y por eso "costo de ventas" mostraba `$0` y "margen bruto" `100%`.

Verificación directa en la base de datos (antes de corregir) confirmó que **no había ningún bug de
zona horaria en las funciones SQL de reportes** (`get_dashboard_metrics`, `report_sales_by_day`):
usan correctamente el patrón `date_trunc('day', now() at time zone 'America/Bogota') at time zone
'America/Bogota'` y `(columna at time zone 'America/Bogota')::date`. El problema estaba
enteramente en el cliente (bugs 1–3) y en `create_order()` (bug 4).

## 2. Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/lib/format.ts` | Nuevas primitivas de fecha ancladas a `America/Bogota` (`getBogotaDateParts`, `bogotaStartOfDay/EndOfDay`, `addBogotaDays`, `bogotaMondayIndex`, `lastDayOfBogotaMonth`, `getBogotaDateString`), reemplazando el cálculo dependiente de la hora local. |
| `src/features/admin/utils.ts` | `getDateRange()` reescrito sobre las primitivas de Bogotá (acepta una fecha de referencia opcional, útil para pruebas). Nuevos helpers puros `percentChange` y `sumStatusCounts` (extraídos del tablero para poder probarlos). |
| `src/features/admin/types.ts` | Nuevo tipo `DashboardMetricsSummary` (contrato exacto de `get_dashboard_metrics`) y tipos de fila para `report_sales_by_day`, `report_product_ranking`, `report_customer_ranking`, `report_sales_breakdown`. |
| `src/features/admin/adminService.ts` | Nuevo `getDashboardMetrics(from, to)` que invoca la RPC `get_dashboard_metrics`. |
| `src/pages/admin/AdminDashboardPage.tsx` | Reescrito: las tarjetas del tablero ahora leen directamente de `get_dashboard_metrics` y de las mismas RPC de reportes (`report_sales_by_day`, `report_product_ranking`, `report_customer_ranking`, `report_sales_breakdown`) que usa la página de Reportes — una sola fuente de verdad. Se eliminó toda la agregación cliente-side basada en `order.total`/`created_at`. |
| `src/pages/admin/ReportsPage.tsx` | Los valores por defecto de fecha (`from`/`to`) ahora se calculan explícitamente en América/Bogotá en vez de con `new Date().toISOString()` (que usa UTC del reloj del cliente sin relación garantizada con el día calendario en Bogotá). |
| `src/pages/admin/CustomerDetailPage.tsx` | Mismo bug de `order.total` (histórico de compras del cliente); corregido con `orderTotal()`. |
| `src/features/admin/admin-helpers.test.ts` | Pruebas nuevas para `sumStatusCounts`, `percentChange`/`percentage` (división por cero) y la fórmula de ticket promedio. |
| `src/features/admin/dashboard-dates.test.ts` (nuevo) | Pruebas de regresión de los límites de fecha en Bogotá (ver §7). |

## 3. Migraciones creadas

**`supabase/migrations/202607190001_fix_dashboard_reports_bogota_costs.sql`**, aplicada con éxito
(`supabase db push --linked`). Contiene:

1. `create_order()` corregido: `coalesce(average_cost, current_cost, 0)` →
   `coalesce(nullif(average_cost,0), nullif(current_cost,0), 0)`, para variante y para producto
   simple. El resto de la función es idéntico a la versión vigente
   (`202607180003_fix_create_order_payment_status.sql`).
2. `get_dashboard_metrics()` corregido:
   - Los encabezados `sales_today/yesterday/current_week/current_month` ahora suman
     `total_amount` (antes sumaban `subtotal_amount - discount_amount`, que en este dataset da el
     mismo resultado porque `delivery_amount`/`tax_amount` son 0, pero la fórmula ahora coincide
     literalmente con la definición de negocio).
   - Nuevo campo `new_orders`: pedidos creados en el período, sin importar su estado final.
   - La valorización de inventario usa el mismo *fallback* seguro ante cero
     (`coalesce(nullif(average_cost,0), nullif(current_cost,0), 0)`) que `create_order()`.
3. `report_inventory_snapshot()`: mismo *fallback* de costo aplicado a `inventory_value`.
4. Bloque `do $$ ... $$` **idempotente** que repara `order_items`/`orders` afectados por el bug
   de costo cero, con alcance estrictamente limitado a filas que cumplen la firma exacta del bug
   (`unit_cost = 0 and product.average_cost = 0 and product.current_cost > 0`), registrando
   `RAISE NOTICE` con los valores antes/después de cada fila tocada. No modifica ningún otro
   pedido: en este dataset solo existía `PED-00000001`, y solo sus 3 ítems cumplían la firma.

No fue necesario inventar ningún costo: `current_cost` es un valor real, registrado en el
producto, y comprobadamente no ha cambiado desde la creación del pedido (`average_cost` sigue en
`0`, es decir, el producto nunca ha recibido una compra que hubiera podido mover ese valor).

## 4. Fórmula exacta de cada métrica (tal como quedó implementada)

Todas viven en `get_dashboard_metrics(p_from timestamptz, p_to timestamptz)` salvo donde se indica.

- **Ventas de hoy / ayer / semana / mes**: `sum(total_amount)` de pedidos `status = 'delivered'`
  cuyo `delivered_at` cae dentro del rango `[inicio, fin)` correspondiente, calculado como
  `date_trunc('day'|'week'|'month', now() at time zone 'America/Bogota') at time zone
  'America/Bogota'`. Estas cuatro cifras son siempre relativas al instante real (`now()`),
  independientes del filtro de período seleccionado en la UI.
- **Pedidos nuevos**: `count(*)` de `orders` con `created_at` dentro del rango seleccionado
  (`p_from`/`p_to`), sin filtrar por estado.
- **Ticket promedio**: `net_sales / delivered_orders` del rango seleccionado, donde
  `net_sales = sum(subtotal_amount - discount_amount)` de pedidos entregados; `0` si
  `delivered_orders = 0` (sin división por cero).
- **Recaudado**: `sum(payments.amount)` con `status = 'approved'` y `paid_at` dentro del rango
  seleccionado.
- **Por cobrar**: `sum(accounts_receivable.balance_amount)` con estado `pending/partial/overdue`
  (sin cambios; no formaba parte de los síntomas reportados y su fuente ya está sincronizada por
  `create_order`/`register_payment`).
- **Costo de ventas**: `sum(order_items.total_cost)` de ítems de pedidos entregados en el rango,
  donde `total_cost = quantity * unit_cost` y `unit_cost` es el costo histórico congelado al
  crear el pedido (nunca el costo actual del producto).
- **Utilidad bruta**: `net_sales - sales_cost` del rango.
- **Margen bruto**: `gross_profit / net_sales * 100`, redondeado a 2 decimales; `0` si
  `net_sales = 0`.
- **Utilidad neta**: `gross_profit - operating_expenses`, donde `operating_expenses` son gastos
  `posted` de categorías operativas dentro del rango.
- **Fecha comercial** (para agrupar por día en `report_sales_by_day`):
  `(delivered_at at time zone 'America/Bogota')::date` — nunca `delivered_at::date` directo.

## 5. Manejo de América/Bogotá

- **SQL**: todas las funciones de reportes usan `at time zone 'America/Bogota'` explícito, sin
  fechas fijas codificadas; los límites "hoy/ayer/semana/mes" se derivan de `now()` en cada
  invocación.
- **Cliente**: `src/lib/format.ts` centraliza el cálculo de fecha calendario en Bogotá vía
  `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', ... })`, que es una conversión
  determinista independiente de la zona horaria del navegador/SO. `getDateRange()` (tablero) y
  los valores por defecto de `ReportsPage` ahora se construyen sobre estas primitivas, no sobre
  `new Date()` + `setHours()` (que es local-timezone-dependiente) ni sobre `.toISOString()` local
  sin control de zona.
- El offset fijo `-05:00` usado en algunos filtros (`fetchRecords` con `gte/lte` sobre
  `created_at`) es válido porque Colombia **no observa horario de verano**; no es una fecha fija,
  es una constante de zona horaria correcta y permanente.

## 6. Resultado antes y después — `PED-00000001`

Consultado directamente contra la base de datos productiva (`npx supabase db query --linked`).

| Campo | Antes | Después |
|---|---|---|
| `created_at` (UTC) | `2026-07-18 20:06:30.98+00` | *(sin cambios)* |
| `created_at` (Bogotá) | `2026-07-18 15:06:30.98` | *(sin cambios)* |
| `delivered_at` (UTC) | `2026-07-18 23:33:32.46+00` | *(sin cambios)* |
| `delivered_at` (Bogotá) | `2026-07-18 18:33:32.46` | *(sin cambios)* |
| pago (`paid_at`, UTC) | `2026-07-19 01:00:45.92+00` | *(sin cambios)* |
| pago (`paid_at`, Bogotá) | `2026-07-18 20:00:45.92` | *(sin cambios)* |
| `total_amount` | `120.000` | `120.000` |
| `amount_paid` | `120.000` | `120.000` |
| `status` / `payment_status` | `delivered` / `paid` | *(sin cambios)* |
| `order_items.unit_cost` (c/u) | `0` | `10.000` |
| `sales_cost` (costo total) | `0` | `80.000` |
| `gross_profit` | `120.000` (100% margen, incorrecto) | `40.000` (33,33% margen) |

**Nota importante sobre "hoy" vs "ayer":** al momento de esta corrección, el reloj real de la
base de datos (`now()`) está en `2026-07-19` (Bogotá), es decir, **un día después** de la entrega
de `PED-00000001` (`2026-07-18`). Por lo tanto, con datos reales:

- `sales_today` = `$0` (correcto: nada se entregó *hoy*, 19/07).
- `sales_yesterday` = `$120.000` (antes mostraba `$0` por el bug de `order.total`; verificado
  directamente contra la base con la fórmula corregida).
- `sales_current_week` = `$120.000` (semana Bogotá: lunes 13/07 → hoy).
- `sales_current_month` = `$120.000` (mes Bogotá: 01/07 → hoy).

El caso de prueba textual del enunciado ("ventas del día: $120.000") corresponde al escenario en
que la prueba se ejecuta el **mismo día** de la entrega (18/07). Las pruebas de regresión en
`dashboard-dates.test.ts` fijan una fecha de referencia sintética para cubrir exactamente ese
escenario de forma determinista, sin depender del reloj real del sistema.

`report_sales_by_day` (verificado directamente): la venta aparece en `2026-07-18` (no en
`2026-07-17`), con `revenue = 120.000`, `cost = 80.000`, `profit = 40.000`.

## 7. Resultado de pruebas

```
npm run typecheck   → OK, sin errores
npm run lint         → OK, sin errores ni warnings (--max-warnings=0)
npm test              → 3 archivos, 75 pruebas, todas OK
npm run build          → OK (bundle generado, solo advertencias de tamaño de chunk preexistentes)
```

Pruebas de regresión añadidas cubren explícitamente:

1. Timestamp UTC de madrugada que en Bogotá pertenece al día anterior.
2. Timestamp UTC de la tarde que en Bogotá pertenece al mismo día.
3. Una entrega tardía del mismo día calendario Bogotá queda dentro de `getDateRange('today')`.
4. Esa misma entrega queda **excluida** de "hoy" y **incluida** en "ayer" cuando el reloj avanza
   un día (reproduce exactamente el escenario real de `PED-00000001`).
5. La semana actual inicia en lunes (Bogotá); una entrega del lunes cae dentro, una del domingo
   anterior queda fuera.
6. El mes actual inicia el día 1 (Bogotá); "mes anterior" cubre el mes calendario completo previo.
7. Aritmética de fechas cruzando límites de mes/año (`addBogotaDays`).
8. `sumStatusCounts` con estados ausentes (no falla, trata como 0).
9. `percentChange`/`percentage` sin dividir por cero (previo = 0 → 100% o `null`; total = 0 → 0).
10. Ticket promedio: un pedido de $120.000 entregado da exactamente $120.000; cero pedidos
    entregados da 0 sin `NaN`.
11. Resolución de columnas reales de BD (`total_amount` vs `total`, etc. — suite preexistente,
    sigue en verde).

La lógica de costo de ventas / utilidad bruta / margen / fechas del reporte diario / rango
semanal-mensual del lado SQL se verificó **directamente contra la base de datos productiva**
(ver §6), reproduciendo la agregación exacta de `get_dashboard_metrics` y `report_sales_by_day`
antes y después de aplicar la migración.

## 8. Resultado de `db push`

```
$ npx supabase db push --linked --dry-run   (antes)
Would push these migrations:
 • 202607190001_fix_dashboard_reports_bogota_costs.sql

$ npx supabase db push --linked --yes
Applying migration 202607190001_fix_dashboard_reports_bogota_costs.sql...
NOTICE: Reparado order_item ... (pedido PED-00000001, sku CH-AR-001): unit_cost 0.00 -> 10000.00, total_cost 0.00 -> 30000.00, gross_profit 45000.00 -> 15000.00
NOTICE: Reparado order_item ... (pedido PED-00000001, sku CH-JA-001): unit_cost 0.00 -> 10000.00, total_cost 0.00 -> 20000.00, gross_profit 30000.00 -> 10000.00
NOTICE: Reparado order_item ... (pedido PED-00000001, sku CH-SR-001): unit_cost 0.00 -> 10000.00, total_cost 0.00 -> 30000.00, gross_profit 45000.00 -> 15000.00
NOTICE: Reparado pedido PED-00000001 (id ...): sales_cost 0.00 -> 80000.00, gross_profit 120000.00 -> 40000.00
Finished supabase db push.

$ npx supabase db push --linked --dry-run   (después)
Remote database is up to date.
```

No quedan migraciones pendientes.

## 9. Hash del commit

```
29ec07e54ae48766e5677541a573f0f024225882 (short: 29ec07e)
fix: align dashboard and reports with Bogota timezone and historical costs
```

## 10. Confirmación del push

Pendiente de confirmar en este mismo informe tras ejecutar `git push origin main` (ver salida de
terminal adjunta a esta entrega). El repositorio no tenía cambios sin commitear antes de empezar
(`git status` limpio) y la rama local estaba sincronizada con `origin/main`.

## 11. Riesgos y asuntos pendientes

- **Dataset de prueba muy pequeño.** Al momento de esta corrección la base de datos solo tiene
  un pedido (`PED-00000001`), un pago y ningún gasto registrado. Los cálculos de "gastos
  operativos"/"utilidad neta", "pedidos pendientes/en preparación" y los rankings de
  productos/clientes no pudieron verificarse con múltiples registros reales — sí se verificó que
  las fórmulas SQL y las divisiones por cero son correctas mediante pruebas unitarias y consultas
  directas equivalentes.
- **`accounts_receivable` ("Por cobrar") no fue tocado.** Es una tabla separada, sincronizada
  solo cuando el pedido admite crédito (`payment_methods.allows_credit`). No se reportó como
  incorrecta y no se modificó su lógica; si en el futuro se detectan pedidos de contado con saldo
  pendiente que no aparecen ahí, valdría la pena revisar si esa tabla debe ampliarse o si "por
  cobrar" debe calcularse directamente desde `orders.total_amount - orders.amount_paid`.
  Otras funciones (`report_customer_ranking`) ya usan `payments` filtrado por rango, así que la
  definición coexiste sin conflicto por ahora.
  Enlazar ambos criterios queda como mejora futura si el negocio lo requiere.
- **Costo reconstruido usa `current_cost`, no un histórico verdadero por evento.** Es la mejor
  fuente disponible y demostrablemente no ha cambiado desde la creación del pedido, pero el
  sistema no guarda un histórico de cambios de `current_cost` por fecha; si en el futuro se
  necesita reconstruir costos de pedidos antiguos después de que `current_cost` haya cambiado
  varias veces, esta migración no serviría como plantilla — se necesitaría una tabla de
  histórico de costos por producto.
- Los otros bugs previamente corregidos en el repositorio (permisos `anon`, estados de pago,
  métodos de pago) no se tocaron; esta migración es aditiva y no revierte nada de
  `202607180003`–`202607180008`.
