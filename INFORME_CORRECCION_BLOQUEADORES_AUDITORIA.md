# Informe: corrección de los 4 bloqueadores de la auditoría pre-producción

Corrige los cuatro hallazgos **ALTO** de `AUDITORIA_PREPRODUCCION_NETLIFY.md` que impedían el veredicto de aprobación: H-05 (idempotencia de pagos), H-13 (roles en "Entregar y pagar"), H-14 (ErrorBoundary ausente en la tienda pública) y H-03 (saldo incorrecto en el modal de pago).

---

## 1. Resumen ejecutivo

Los cuatro hallazgos quedaron corregidos, probados y verificados en vivo (sin tocar datos productivos) contra el proyecto Supabase enlazado (`rkksmtdbcrfaaiufehke`). Durante la corrección de H-13 se descubrió, mediante una prueba real envuelta en `ROLLBACK`, que el diseño original planteado en el hallazgo de auditoría era incompleto: `vendedor` tampoco puede disparar la entrega de un pedido (no solo `contabilidad`, como decía H-13), porque `transition_order_status` ya bloqueaba a un vendedor puro de avanzar más allá de `confirmed`. La corrección final es más estricta de lo planeado inicialmente y fue ajustada con evidencia real antes de cerrarse.

## 2. Causa raíz de cada hallazgo

**H-05 — Idempotencia de pagos.** `register_payment`/`deliver_and_pay_order` aceptan `p_idempotency_key`, pero el frontend (`PaymentsPage.tsx`, `DeliverAndPayModal.tsx`) nunca la enviaba — ambas RPC caían en su valor por defecto `gen_random_uuid()`, generado de nuevo en cada llamada. Además, la verificación de idempotencia en `register_payment` solo comprobaba que la llave existiera; nunca validaba que perteneciera al mismo pedido/monto/método, y no tenía manejo de `unique_violation` para una carrera real entre dos llamadas concurrentes.

**H-13 — Roles en `deliver_and_pay_order`.** La función acepta `contabilidad`, pero delega en `transition_order_status` para el paso de entrega, que nunca aceptó `contabilidad`. Investigando la corrección se confirmó además (con una prueba real, no solo lectura de código) que `transition_order_status` tiene una regla adicional que bloquea a un `vendedor` puro (sin el rol `bodega`) de avanzar más allá de `confirmed` — así que el mismo problema afectaba también a `vendedor`, no solo a `contabilidad` como indicaba el hallazgo original.

**H-14 — ErrorBoundary ausente en la tienda pública.** `App.tsx` solo envolvía `/admin` en `<ErrorBoundary>`; ninguna ruta pública (`/`, `/pedido-confirmado`, `/seguir`, `/mis-pedidos`, etc.) tenía protección, así que un error de renderizado en el flujo de compra dejaba una pantalla en blanco sin recuperación.

**H-03 — Saldo incorrecto en "Entregar y pagar".** `OrdersTable.tsx` abría `DeliverAndPayModal` con `payments={[]}` hardcodeado; el modal calculaba "pagado"/"saldo" sumando ese array (siempre vacío desde el listado), mostrando el saldo total como si nada se hubiera pagado. `OrderDetailPage.tsx` y `PaymentsPage.tsx` tenían un cálculo *distinto* del mismo dato (sumando pagos con un filtro de estado que trataba `pending`/`under_review` como pagados), así que las tres pantallas podían mostrar tres cifras diferentes para el mismo pedido.

## 3. Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/features/admin/types.ts` | Nuevos `orderAmountPaid()`/`orderBalance()` — única fuente de verdad (`orders.amount_paid`/`total_amount`) para "pagado"/"saldo" (H-03). |
| `src/features/admin/utils.ts` | Nuevos `PAYMENT_ROLES`, `hasAnyRole()`, `canDeliverViaCombinedAction()` — reflejan en el cliente el mismo criterio de rol que ahora aplica el servidor (H-13). |
| `src/features/admin/orders/DeliverAndPayModal.tsx` | Ya no recibe `payments` (usa `orderAmountPaid`/`orderBalance`, H-03); llave de idempotencia estable por apertura del modal, enviada como `p_idempotency_key` (H-05); guardia contra reentrada; aviso y deshabilitado cuando el rol no puede disparar la entrega (H-13). |
| `src/features/admin/orders/OrdersTable.tsx` | Ya no pasa `payments={[]}` (H-03); oculta el atajo "Entregar y pagar" para roles que no pueden disparar la entrega (H-13). |
| `src/pages/admin/OrderDetailPage.tsx` | Elimina el `fetch` redundante de `payments` y su cálculo propio de saldo (usa `orderAmountPaid`/`orderBalance`, H-03); deshabilita "Entregar y pagar" con motivo cuando el rol no puede disparar la entrega (H-13). |
| `src/pages/admin/PaymentsPage.tsx` | Reemplaza el cálculo local de saldo (que contaba `pending` como pagado) por `orderAmountPaid`/`orderBalance` (H-03); llave de idempotencia estable por intento de pago, regenerada solo al iniciar operación/cambiar de pedido/éxito/cancelar, enviada como `p_idempotency_key` (H-05); guardia contra reentrada. |
| `src/App.tsx` | Cada ruta pública (`/`, `/pedido-confirmado`, `/seguir`, `/seguir/:token`, `/mis-pedidos`, `/privacidad`, `/terminos`, `/admin/acceso`) envuelta en su propio `<ErrorBoundary>` — un error en una no afecta a las demás (H-14). |
| `src/components/ErrorBoundary.tsx` | Configurable (`title`/`description`/`backHref`/`backLabel`); ya no muestra `error.message` al usuario (solo un texto fijo); `console.error` solo en `import.meta.env.DEV` (H-14). |
| `supabase/tests/transactional_api_test.sql` | +11 aserciones pgTAP nuevas para H-05/H-13 (`plan(20)` → `plan(31)`). |
| `src/features/admin/admin-helpers.test.ts` | +18 pruebas: `orderAmountPaid`/`orderBalance` (H-03) y `canDeliverViaCombinedAction` (H-13). |
| `src/features/admin/orders/DeliverAndPayModal.test.tsx` (nuevo) | 7 pruebas de componente: saldo real sin `payments` (H-03), llave de idempotencia estable en reintento (H-05), bloqueo por rol (H-13). |
| `src/components/ErrorBoundary.test.tsx` (nuevo) | 6 pruebas: interfaz de recuperación, sin mensaje técnico, salida configurable, recuperación con "Reintentar" (H-14). |

## 4. Migraciones creadas

**`supabase/migrations/202607190002_fix_payment_idempotency_and_role_checks.sql`** — `CREATE OR REPLACE FUNCTION` de `register_payment` (9-arg) y `deliver_and_pay_order`. Sin cambios de esquema, sin tocar datos, sin cambiar GRANTs (se conservan automáticamente al mismo signature). Idempotente por construcción (`CREATE OR REPLACE`).

**Nota de proceso**: la migración se aplicó dos veces durante esta sesión. La primera versión incluía `vendedor` entre los roles que pueden disparar la entrega en `deliver_and_pay_order`; una prueba real (ver §6) demostró que eso era incorrecto (`transition_order_status` ya bloquea a un vendedor puro), así que el archivo se corrigió **antes de hacer commit** y se reaplicó (`CREATE OR REPLACE FUNCTION` es idempotente, así que el estado final en la base de datos es exactamente el del archivo tal como quedó commiteado — nunca hubo una versión intermedia incorrecta persistida más allá de la sesión de corrección).

## 5. Decisión final sobre roles (H-13)

| Acción | Roles que la ejecutan | Evidencia |
|---|---|---|
| **Entregar** (`transition_order_status` → `delivered`) | `superadmin`, `admin` (cualquier transición); `bodega` (adyacente: …→dispatched→delivered) | Lectura de código + confirmado en vivo: `vendedor` puro recibe `"El vendedor no puede realizar esta transición"`. |
| **Pagar** (`register_payment`) | `superadmin`, `admin`, `vendedor`, `contabilidad` | Sin cambios — ya era así. |
| **Entregar y pagar, paso de entrega** (`deliver_and_pay_order` cuando el pedido no está entregado) | Solo `superadmin`, `admin` | Corregido en esta sesión; confirmado en vivo que `contabilidad` y `vendedor`, cada uno por separado, quedan bloqueados con un error claro (`ROLE_CANNOT_DELIVER`) y que `superadmin` sí puede. |
| **Entregar y pagar, paso de pago** (`deliver_and_pay_order` cuando el pedido YA está entregado) | `superadmin`, `admin`, `vendedor`, `contabilidad` | Sin cambios — confirmado en vivo que `contabilidad` puede pagar un pedido ya entregado por otro rol sin error. |

Principio aplicado: mínimo privilegio. `transition_order_status` **no fue modificada** — ni `contabilidad` ni `vendedor` obtuvieron ninguna capacidad operativa nueva (cambiar estado, tocar inventario). La corrección vive enteramente dentro de `deliver_and_pay_order`, como un chequeo adicional antes de intentar el paso de entrega, con un mensaje explícito en vez de dejar que el error genérico de la función anidada se filtre.

## 6. Implementación de idempotencia (H-05)

- **Frontend**: cada operación de pago genera una `crypto.randomUUID()` al iniciar; esa misma llave se reutiliza en cualquier reintento (mismo timeout, mismo error) mientras la operación siga en curso. Se genera una llave nueva únicamente al: confirmar con éxito, cancelar, cambiar de pedido, o iniciar explícitamente una nueva operación (abrir el modal de nuevo). Ambos formularios de pago (`DeliverAndPayModal`, `PaymentsPage`) ahora envían `p_idempotency_key` explícitamente.
- **Backend — reintento con la misma llave**: `register_payment` verifica que la llave exista, valida que pertenece al **mismo pedido, monto y método**, y devuelve el pago existente (`idempotent_replay: true`) sin insertar una segunda fila.
- **Backend — reutilización indebida**: si la misma llave se usa para otro pedido, u otro monto/método, la función lanza `IDEMPOTENCY_KEY_REUSED` (error funcional claro, `errcode 22023`) en vez de devolver un resultado silenciosamente incorrecto.
- **Backend — carrera real**: se agregó `exception when unique_violation` (mismo patrón que ya usaba `create_order`) — si dos llamadas concurrentes con la misma llave pasan ambas la verificación inicial antes de que la primera confirme, la segunda captura la violación de la restricción única y devuelve el pago ya creado, sin exponer un error crudo de PostgreSQL.

### Verificación en vivo (sin registrar pagos reales)

Todo lo siguiente se ejecutó dentro de una única transacción `BEGIN … ROLLBACK` contra el proyecto enlazado — ningún pedido, pago ni usuario de prueba quedó persistido. Resultado: **10/10 verificaciones pasaron**.

| # | Verificación | Resultado |
|---|---|---|
| 1 | Pedido de prueba creado vía `create_order` | `total=90000.00`, `status=new` |
| 2 | Dos llamadas **secuenciales** a `register_payment` con la **misma** llave | Mismo `payment_id`, **1 fila** en `payments`, `amount_paid` correcto (sin duplicar) |
| 3 | Reutilizar la llave con un **monto distinto** | Rechazado: `IDEMPOTENCY_KEY_REUSED` |
| 4 | Sobrepago (monto absurdo) | Rechazado (regla preexistente, sigue vigente) |
| 5 | Pago adicional sobre un pedido ya pagado en su totalidad | Rechazado |
| 6 | `contabilidad`-only intenta entregar+pagar un pedido no entregado | Rechazado: `ROLE_CANNOT_DELIVER` |
| 7 | `vendedor`-only intenta entregar+pagar un pedido no entregado | Rechazado: `ROLE_CANNOT_DELIVER` (hallazgo nuevo, ver §2) |
| 8 | Estado del pedido tras los dos intentos bloqueados | Sin cambios (`dispatched`, como antes de los intentos) |
| 9 | `superadmin` entrega y paga el mismo pedido | Éxito: `status=delivered`, `payment_status=paid` |
| 10 | `contabilidad` usa la misma función sobre el pedido ya entregado | Éxito, sin error de rol (solo paga) |

Confirmado después del `ROLLBACK`: `select count(*) from orders where customer_name like 'AUDIT TEST%'` → **0**; los usuarios sintéticos de prueba → **0**; `PED-00000001` sin cambios (ver §14).

## 7. Pruebas agregadas

- **pgTAP** (`supabase/tests/transactional_api_test.sql`): +11 aserciones (`plan(20)` → `plan(31)`) cubriendo exactamente los mismos 10 puntos de la tabla anterior, usando identidades `contabilidad-only`/`vendedor-only` sintéticas creadas y descartadas dentro de la transacción propia de la suite (`BEGIN…ROLLBACK`, igual que el resto del archivo).
- **Vitest — `admin-helpers.test.ts`**: `orderAmountPaid`/`orderBalance` (6 casos: $0/$50.000/$120.000 pagados, `amount_paid` ausente, saldo nunca negativo, caso real de PED-00000001) y `canDeliverViaCombinedAction` (8 casos: cada rol individual + combinaciones multi-rol).
- **Vitest + Testing Library — `DeliverAndPayModal.test.tsx`** (nuevo): saldo calculado sin `payments` (H-03); misma llave de idempotencia reutilizada en un reintento tras error (H-05); llave siempre enviada a la RPC; bloqueo/desbloqueo por rol para pedido entregado/no entregado (H-13).
- **Vitest + Testing Library — `ErrorBoundary.test.tsx`** (nuevo): interfaz de recuperación en vez de pantalla en blanco; el mensaje técnico del error nunca llega al usuario; enlace de salida configurable; recuperación exitosa vía "Reintentar".

## 8. Resultado de typecheck

```
$ npm run typecheck
(sin salida — 0 errores)
```

## 9. Resultado de lint

```
$ npm run lint
(sin salida — 0 errores, 0 warnings)
```

## 10. Resultado de tests

```
$ npm test
Test Files  6 passed (6)
     Tests  115 passed (115)
```

Desglose: 88 pruebas preexistentes (sin romperse) + 18 en `admin-helpers.test.ts` (H-03/H-13) + 7 en `DeliverAndPayModal.test.tsx` (H-03/H-05/H-13) + 6 en `ErrorBoundary.test.tsx` (H-14) − 4 pruebas antiguas reemplazadas/renombradas al corregir la expectativa de `vendedor` en H-13 = **115 en total**.

## 11. Resultado de pgTAP

**No se pudo ejecutar `supabase test db` en este entorno**: `supabase start` requiere el motor de Docker Desktop, que no está corriendo aquí (`docker --version` responde, pero el daemon no es alcanzable — `Docker Desktop is a prerequisite for local development`). Esta misma limitación de entorno ya había sido señalada como hallazgo H-19 en la auditoría (ausencia de CI que ejecute la suite pgTAP).

Como evidencia primaria y real (no simulada) se usó, en su lugar, la verificación en vivo de la §6 — una transacción `BEGIN…ROLLBACK` ejecutada directamente contra el proyecto enlazado, con 10/10 verificaciones exitosas, cubriendo exactamente los mismos escenarios que las 11 aserciones pgTAP añadidas. Las aserciones pgTAP quedan en el repositorio, listas para ejecutarse en cuanto exista un entorno con Docker Desktop disponible (`supabase start && supabase test db`) o en CI.

## 12. Resultado de build

```
$ npm run build
✓ built in ~1.4-2s
dist/ generado correctamente
```

## 13. Resultado de npm audit

```
$ npm audit
found 0 vulnerabilities
```

## 14. Verificación de PED-00000001

Consultado directamente contra la base de datos productiva antes y después de aplicar la migración — **sin modificarlo, sin registrar ningún pago adicional**:

| Campo | Valor verificado |
|---|---|
| `status` | `delivered` |
| `payment_status` | `paid` |
| `total_amount` | `120000.00` |
| `amount_paid` | `120000.00` |
| saldo (`total - paid`) | `0.00` |
| `sales_cost` | `80000.00` |
| `gross_profit` | `40000.00` |
| unidades (`sum(order_items.quantity)`) | `8` |
| número de pagos | `1` (`approved`, `120000.00` — sin duplicados) |

Dashboard/reportes re-verificados en vivo tras el despliegue de la migración (`get_dashboard_metrics`, `report_sales_by_day`): ventas `$120.000`, costo `$80.000`, utilidad `$40.000`, margen `33.33%`, recaudado `$120.000`, por cobrar `$0`, venta ubicada en `2026-07-18` (America/Bogota) — todo coincide exactamente con lo exigido.

## 15. Riesgos residuales

- **pgTAP sin ejecución automatizada** (H-19 de la auditoría, sin cambios en esta sesión): las 31 aserciones existen en el repositorio pero no corren en ningún pipeline. Recomendación ya documentada en la auditoría: agregar un job de CI con Docker que ejecute `supabase test db`.
- **Otros hallazgos MEDIO/BAJO de la auditoría no fueron tocados** en esta sesión por estar fuera del alcance solicitado (H-06, H-08, H-09, H-10, H-04, H-11, H-12, H-15, H-16, H-17) — siguen pendientes según lo documentado en `AUDITORIA_PREPRODUCCION_NETLIFY.md`.
- **Corrección de alcance descubierta en vivo**: el hallazgo H-13 original solo mencionaba `contabilidad`; la corrección real también restringe a `vendedor`. Si existe algún flujo operativo real donde un `vendedor` dependía (aunque fuera por error) de poder entregar pedidos a través de "Entregar y pagar", esa capacidad ya no está disponible — es el comportamiento correcto según las reglas de `transition_order_status`, pero conviene comunicarlo al equipo antes de operar en producción.
- **Configuración de Supabase Auth / `ALLOWED_ORIGINS` / `STAFF_INVITE_REDIRECT_URL` para el dominio final de Netlify** sigue pendiente como paso de despliegue (ya documentado en la auditoría, sección 33/38-C).

## 16. Confirmación de cierre de los cuatro bloqueadores

| Hallazgo | Estado |
|---|---|
| H-05 — Idempotencia de pagos | ✅ Cerrado — llave estable en frontend, validación de reutilización + manejo de carrera en backend, 10/10 verificaciones en vivo |
| H-13 — Roles en "Entregar y pagar" | ✅ Cerrado — corregido y ampliado con evidencia real (contabilidad y vendedor bloqueados de entregar; superadmin/admin sí pueden; pago sobre pedido ya entregado sigue abierto a contabilidad/vendedor) |
| H-14 — ErrorBoundary en tienda pública | ✅ Cerrado — cada ruta pública protegida individualmente, sin mensaje técnico expuesto, con recuperación |
| H-03 — Saldo en DeliverAndPayModal | ✅ Cerrado — fuente única de verdad (`orders.amount_paid`/`total_amount`) usada en las tres pantallas (listado, detalle, pagos y cartera) |

Ningún dato productivo fue modificado. `PED-00000001` conserva exactamente los valores exigidos.
