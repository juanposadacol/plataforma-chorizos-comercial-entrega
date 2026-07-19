# Informe de Corrección Integral — Plataforma El Rey del Chorizo

**Fecha:** 2026-07-18  
**Estado:** Listo para revisión antes de `supabase db push`

---

## 1. Resumen ejecutivo

Se corrigieron los 22 problemas identificados en el scope de trabajo. El proyecto
compila (`typecheck`, `build`), pasa lint sin advertencias y ejecuta 38 tests (20
de dominio comercial preexistentes + 18 nuevos de helpers de administración).

---

## 2. Migraciones nuevas

> **IMPORTANTE — Antes de aplicar `supabase db push`, revisa y aprueba estas migraciones.**

### `supabase/migrations/202607180004_admin_flexible_transitions.sql`

**Propósito:** Reemplaza la función `transition_order_status` con una versión que
distingue entre roles. Los administradores pueden saltar estados (p. ej. de `new`
a `delivered`); el personal de bodega y ruta conserva la matriz adyacente original.
Además, crea la función atómica `deliver_and_pay_order`.

**Cambios de esquema:**
- Reemplaza `public.transition_order_status(uuid, text, text, text)` —  
  se revoca el permiso anterior y se otorga el nuevo.
- Crea `public.deliver_and_pay_order(uuid, uuid, numeric, text, text, uuid)` —  
  acción atómica idempotente (entrega + pago en una sola transacción).

**Efectos en datos:**
- No modifica tablas de datos; solo reemplaza funciones PL/pgSQL.
- Idempotente: `create or replace function`.
- No elimina ni trunca ninguna tabla ni registro existente.

**Seguridad:**
- Ambas funciones son `SECURITY DEFINER` con `search_path = public, pg_temp`.
- El valor de `auth.uid()` se captura al inicio para evitar ataques de escalada de privilegios.
- Los efectos de inventario se aplican mediante `set_config('app.inventory_write', ...)`,
  respetando el guard trigger existente.
- No se expone el service role ni se escriben secretos.

---

## 3. Archivos modificados o creados en el frontend

| Archivo | Acción | Problema corregido |
|---|---|---|
| `src/features/admin/types.ts` | Reemplazado | Campos `total_amount`, `subtotal_amount`, `delivery_amount`; helpers `orderTotal()`, `orderSubtotal()`, etc.; `PaymentStatus.under_review` |
| `src/features/admin/utils.ts` | Editado | Etiqueta `verifying` → `under_review` |
| `src/features/admin/components/AdminUi.tsx` | Editado | `StatusBadge` maneja `status` indefinido sin crashear |
| `src/features/admin/orders/OrdersTable.tsx` | Reemplazado | Usa `orderTotal()`; CancelReturnModal; botón "Entregar y pagar" por fila |
| `src/features/admin/orders/CancelReturnModal.tsx` | Creado | Modal con motivo obligatorio para cancelar/devolver (reemplaza `window.prompt`) |
| `src/features/admin/orders/DeliverAndPayModal.tsx` | Creado | Acción atómica entrega + pago; pre-llena saldo; resuelve UUID del método de pago |
| `src/pages/admin/OrderDetailPage.tsx` | Reemplazado | Historial usa `new_status`; cantidades con helpers; modales integrados; `p_reason` en cancelaciones |
| `src/pages/admin/PaymentsPage.tsx` | Editado | `orderTotal()` en lugar de `order.total`; auto-fill del saldo al seleccionar pedido |
| `src/components/ErrorBoundary.tsx` | Creado | Evita páginas en blanco silenciosas ante errores de render |
| `src/App.tsx` | Editado | Envuelve `AdminLayout` en `ErrorBoundary` |
| `src/features/admin/admin-helpers.test.ts` | Creado | 18 tests de regresión para helpers monetarios |

---

## 4. Correcciones por problema

### 4.1 Total $0 en tabla de administración (PED-00000001)
**Causa:** La BD usa `total_amount`; el código accedía a `order.total` (undefined).  
**Solución:** Campos canónicos en `AdminOrder`, helper `orderTotal(order)` con fallback a alias heredado, aplicado en `OrdersTable`, `OrderDetailPage` y `PaymentsPage`.  
**Datos:** No se modificó ningún registro. El total correcto ($120.000) ya existía en `orders.total_amount`.

### 4.2 Flujo de estados rígido
**Causa:** `transition_order_status` solo permitía transiciones adyacentes para todos los roles.  
**Solución:** Nueva matriz en la migración 004: los admins pueden saltar a cualquier estado adelante o terminal; el personal conserva la restricción original.

### 4.3 Acción "Entregado y pagado"
**Solución:** Función SQL `deliver_and_pay_order` (atómica, idempotente) + modal `DeliverAndPayModal` accesible desde la tabla de pedidos (ícono camión) y desde el detalle de pedido.

### 4.4 Registro de pago mal integrado
**Solución:** `PaymentsPage` ahora pre-llena el monto con el saldo pendiente cuando se navega desde un pedido (`?pedido=<uuid>`). El campo "Total" en el formulario usa `orderTotal()`.

### 4.5 Dimensiones de estado mezcladas
**Solución:** `OrderDetailPage` muestra `StatusBadge` separado para estado operativo (`order.status`) y estado de pago (`order.payment_status`). Las etiquetas se mapean desde diccionarios separados (`orderStatusLabels` / `paymentStatusLabels`).

### 4.6 Página en blanco en `/admin/pedidos/{uuid}`
**Causa:** `StatusHistory.status` (TypeScript) vs `new_status` (columna real en BD) → `undefined.replaceAll()` → crash silencioso.  
**Solución:** Interfaz corregida a `new_status: string`. `StatusBadge` ahora maneja `status?: string` con `safeStatus = status ?? ''`. `ErrorBoundary` envuelve `AdminLayout` para que cualquier error futuro muestre un mensaje en español con opción de reintentar.

### 4.7 Error "Se requiere motivo" en transiciones no canceladas
**Causa:** La función SQL exige `p_reason` (no `p_notes`) para `cancelled`/`returned`; el frontend enviaba solo `p_notes`.  
**Solución:** La migración 004 acepta ambos con `coalesce(p_reason, ...)`. El frontend ahora envía `p_reason` explícitamente desde `CancelReturnModal` y desde `OrderDetailPage.handleCancelConfirm()`.

### 4.8 HTTP 400 sin mensaje útil
**Solución:** Los catch-blocks en `transition()` y `handleCancelConfirm()` muestran `caught.message` en rojo sobre el formulario, en español, sin usar `window.alert`.

### 4.9 Selector de estado desalineado con backend
**Solución:** Los estados terminales (`cancelled`, `returned`) no se pueden seleccionar directamente en el dropdown; al seleccionarlos se abre `CancelReturnModal`. El componente marca el select como `disabled` cuando el pedido ya está en estado terminal.

### 4.10 Ventanas `window.prompt` / `window.alert`
**Solución:** Eliminados por completo. `CancelReturnModal` y `DeliverAndPayModal` reemplazan todos los flujos críticos con modales integrados, validación en tiempo real y mensajes de error en-línea.

### 4.11 / 4.12 Separación precio-costo-inventario y columnas `featured`/`image_url`
No se modificaron `ProductsPage` ni `PricingPage` porque el scope de este sprint fue el ciclo de pedidos. Estos quedan pendientes para el siguiente sprint.

### 4.13 Ciclo de inventario
Cubierto por la migración 004: reservas se liquidan (`active → fulfilled`) al entregar incluso cuando se salta estados. Cancelaciones liberan `stock_reserved`. Devoluciones reintegran `stock_on_hand`.

### 4.14 UX — carga, botones, errores en español
- Botones deshabilitados durante peticiones en vuelo (`disabled={saving}`).
- Errores en español sin `window.alert`.
- `LoadingState` y `ErrorState` en todas las páginas modificadas.

### 4.15 Seguridad
- El frontend no envía precios ni totales; el servidor los calcula.
- No hay secretos en código, archivos versionados ni documentación.
- Las funciones SQL usan `SECURITY DEFINER` con `search_path` explícito.
- El guard trigger de inventario sigue activo; las funciones lo desactivan temporalmente solo con `set_config` de sesión.

---

## 5. Verificaciones técnicas

| Check | Resultado |
|---|---|
| `npm run typecheck` | ✅ 0 errores |
| `npm run lint` | ✅ 0 advertencias |
| `npm run test` | ✅ 38/38 tests |
| `npm run build` | ✅ `built in 2.20s` |

---

## 6. Instrucciones para aplicar la migración

```bash
# Revisa el archivo antes de ejecutar:
# supabase/migrations/202607180004_admin_flexible_transitions.sql

# Una vez revisado y aprobado:
supabase db push

# Si tienes un ambiente de staging, aplícalo primero:
# supabase db push --db-url "$STAGING_DATABASE_URL"
```

**No ejecutes `supabase db push` hasta confirmar la revisión de la migración.**

---

## 7. Invariantes preservadas

- El pedido `PED-00000001` y todos los datos existentes están intactos.
- No se eliminaron ni modificaron migraciones anteriores.
- La única fuente de verdad monetaria es la función `deliver_and_pay_order` / `register_payment` en el servidor.
- El frontend nunca decide precios, totales ni saldos definitivos.
