# Backend Supabase

Este directorio es la fuente autoritativa del modelo comercial. El navegador nunca envía
precios definitivos: `create-order` valida un contrato estricto y la función PostgreSQL
`create_order` resuelve precios, costos, domicilio, inventario y totales dentro de una sola
transacción.

## Instalación local

Requisitos: Supabase CLI y Docker.

```bash
supabase start
supabase db reset
supabase functions serve --env-file supabase/functions/.env.local
```

`db reset` aplica las migraciones en orden y luego `seed.sql`. Todos los registros del seed
están marcados como demostración y usan UUID deterministas. El usuario
`admin.demo@chorizos.invalid` tiene una contraseña aleatoria irrecuperable: existe para conservar
integridad referencial y debe restablecerse desde Supabase Auth antes de usarlo localmente.

Para validar el SQL:

```bash
supabase db lint --level error
supabase test db
deno check supabase/functions/create-order/index.ts
deno check supabase/functions/process-whatsapp-outbox/index.ts
```

## Despliegue

```bash
supabase link --project-ref TU_PROJECT_REF
supabase db push
supabase functions deploy create-order --no-verify-jwt
supabase functions deploy process-whatsapp-outbox --no-verify-jwt
```

Configure secretos exclusivamente en Supabase; nunca use `VITE_` para estos valores:

```bash
supabase secrets set \
  ALLOWED_ORIGINS=https://tu-dominio.example \
  OUTBOX_WORKER_SECRET=valor-aleatorio-largo \
  WHATSAPP_ACCESS_TOKEN=token-meta \
  WHATSAPP_PHONE_NUMBER_ID=id-telefono \
  WHATSAPP_GRAPH_API_VERSION=v23.0 \
  WHATSAPP_TEMPLATE_NAME=nuevo_pedido_admin \
  WHATSAPP_TEMPLATE_LANGUAGE=es_CO
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` son inyectadas por Supabase
en producción. La service-role solo se usa dentro de Edge Functions.

Programe `process-whatsapp-outbox` cada minuto con un scheduler server-side enviando
`x-outbox-secret`. También se despierta de forma oportunista después de crear un pedido, pero
el scheduler es quien garantiza reintentos. Si faltan credenciales o la plantilla aprobada,
la entrega queda en estado `manual_required` con un enlace `wa.me`; el pedido permanece guardado.

## Primer administrador

1. Cree el usuario con Supabase Auth (OTP de celular o correo).
2. Obtenga su UUID desde Authentication > Users.
3. Ejecute como propietario de la base, sustituyendo ambos valores:

```sql
insert into public.profiles (id, full_name, is_active)
values ('UUID_AUTH', 'Administrador', true)
on conflict (id) do update set full_name = excluded.full_name, is_active = true;

insert into public.user_roles (profile_id, role_id)
select 'UUID_AUTH', id from public.roles where code = 'superadmin'
on conflict do nothing;
```

El seed nunca se aplica con `supabase db push` y no debe cargarse en producción. La migración
`202607170004_production_bootstrap.sql` sí instala roles, lista pública, métodos y ajustes mínimos
sin crear usuarios ni credenciales de demostración.

## Seguridad y operación

- RLS está habilitado en todas las tablas expuestas. Los clientes solo consultan su perfil,
  direcciones y pedidos; costos, utilidades, compras, gastos y configuración privada son staff-only.
- Las funciones con `security definer` fijan `search_path`, verifican rol/propiedad y revocan
  ejecución pública cuando corresponde.
- `create_order` usa bloqueos de fila en orden estable para impedir vender dos veces la última
  unidad. El `idempotency_key` hace seguros los reintentos del navegador.
- Los pedidos, pagos, compras, gastos y movimientos no tienen políticas de `DELETE` y las
  operaciones financieras se conservan para auditoría.
- Los importes usan `numeric(14,2)`; no se usan `float`.
- Los snapshots en `order_items` preservan nombre, SKU, precio, lista y costo aunque cambie el
  catálogo posteriormente.

## Flujo de precios

1. Precio especial vigente para cliente + producto.
2. Tramo por cantidad vigente, si `volume_pricing_enabled` está activo.
3. Precio vigente de la lista asignada.
4. Precio público del producto.

La lista del cliente solo la puede cambiar un rol autorizado. Un cliente autenticado se enlaza
por `customers.auth_user_id`; un visitante se identifica por el celular normalizado y, si no
existe, se crea con la lista pública.

## Flujo de inventario

- Pedido nuevo: incrementa `stock_reserved`, crea reserva y movimiento `reservation`.
- Cancelación: libera la reserva y registra `reservation_release`.
- Entrega: reduce existencias y reserva, registra `sale` y consolida costo/utilidad histórica.
- Devolución: registra `return` y repone existencias una sola vez.
- Compra recibida: aumenta existencias, registra `purchase` y recalcula costo promedio ponderado.

Todo cambio de existencias ocurre mediante funciones transaccionales; los roles de aplicación no
reciben permiso para actualizar directamente los campos de stock.
