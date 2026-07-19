-- Migración 202607180007: Endurecimiento de privilegios por defecto para el rol anon.
--
-- HALLAZGO (auditoría de seguimiento tras 202607180006)
-- Supabase provisiona cada proyecto con privilegios por defecto a nivel de
-- esquema (verificado en pg_default_acl del proyecto):
--   alter default privileges for role postgres in schema public
--     grant all on tables/functions/sequences to anon, authenticated, service_role;
-- Toda tabla, función o secuencia creada en "public" por el rol que ejecuta las
-- migraciones (postgres) recibe automáticamente privilegios completos para
-- "anon", sin que ninguna migración lo pida. Las migraciones 202607170001-
-- 202607170003 sólo revocan privilegios de PUBLIC o ajustan grants de
-- "authenticated"; ninguna revoca el privilegio directo que "anon" recibe por
-- ese default. Verificado en la base remota antes de esta migración:
--   - anon tenía SELECT/INSERT/UPDATE/DELETE en customers, orders, payments,
--     profiles, user_roles, expenses, purchases y el resto de tablas internas
--     del negocio (32 tablas).
--   - anon tenía EXECUTE en TODAS las funciones SECURITY DEFINER del esquema,
--     incluidas register_payment, transition_order_status, set_user_roles,
--     receive_purchase, deliver_and_pay_order, create_inventory_adjustment,
--     retry_notification_delivery y los report_*.
--
-- IMPACTO ACTUAL: no explotable hoy. RLS está activo en todas las tablas y
-- ninguna política admite a "anon" salvo las 4 tablas de catálogo público
-- (categories, brands, payment_methods, delivery_methods) y las vistas de
-- tienda (store_products y afines), pensadas para acceso anónimo. Toda función
-- mutable llama a require_staff()/is_admin() en su primera línea, así que una
-- llamada anónima falla con "Insufficient privileges" (42501) antes de tocar
-- datos. Aun así, el GRANT en sí es precisamente el "acceso administrativo al
-- rol anon" que se pidió evitar: es una capa de defensa en profundidad rota.
-- Si alguna política RLS o un chequeo interno tuviera un error, anon podría
-- leer o mutar datos de clientes/negocio directamente vía PostgREST.
--
-- SOLUCIÓN
-- 1. Revocar los privilegios de tabla que anon recibió por default en las
--    tablas internas del negocio. No se tocan las 4 tablas de catálogo público
--    ni las vistas de tienda, que conservan su GRANT SELECT intencional.
-- 2. Revocar EXECUTE de anon en todas las funciones de "public" y reafirmar
--    solo las 3 realmente anónimas: get_catalog_prices, get_public_settings,
--    get_order_tracking (las tres son security definer; las llamadas internas
--    que hacen a otras funciones se ejecutan con los privilegios del dueño de
--    la función, no con los de quien la invoca, así que no requieren EXECUTE
--    adicional para anon).
-- 3. Revocar el USAGE que anon recibió por default en las secuencias de
--    numeración (solo authenticated/service_role las necesitan).
-- 4. Ajustar el privilegio por defecto del esquema para que las tablas y
--    funciones que creen futuras migraciones (ejecutadas por el rol postgres)
--    ya no incluyan a anon automáticamente.
-- 5. No se modifica RLS, ni las políticas existentes, ni los privilegios de
--    "authenticated" o "service_role". No se usa service_role en el frontend.
--
-- 100% idempotente: REVOKE/GRANT no fallan si el privilegio ya está en el
-- estado deseado; ALTER DEFAULT PRIVILEGES tampoco falla al repetirse.

begin;

set search_path = public, pg_temp;

-- ===================================================================
-- 1. Revocar privilegios de tabla heredados por default en anon
--    (incluye customers y el resto de tablas internas del negocio)
-- ===================================================================
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'roles', 'profiles', 'user_roles', 'price_lists', 'products',
    'product_variants', 'product_images', 'product_prices', 'customers',
    'customer_addresses', 'customer_product_prices', 'quantity_price_tiers',
    'orders', 'order_items', 'order_status_history', 'suppliers', 'purchases',
    'purchase_items', 'inventory_reservations', 'inventory_movements',
    'payments', 'accounts_receivable', 'accounts_payable', 'expense_categories',
    'expenses', 'cash_accounts', 'cash_movements', 'notifications',
    'notification_deliveries', 'whatsapp_settings', 'app_settings',
    'audit_logs', 'request_rate_limits'
  ]
  loop
    execute format('revoke all on table public.%I from anon', v_table);
  end loop;
end;
$$;

-- ===================================================================
-- 2. Revocar EXECUTE de anon en todas las funciones del esquema public
--    y reafirmar solo las 3 realmente públicas/anónimas.
-- ===================================================================
do $$
declare
  v_func text;
begin
  for v_func in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke execute on function %s from anon', v_func);
  end loop;
end;
$$;

grant execute on function
  public.get_catalog_prices(),
  public.get_public_settings(),
  public.get_order_tracking(uuid)
  to anon;

-- ===================================================================
-- 3. Revocar USAGE heredado por default en las secuencias de numeración
-- ===================================================================
revoke all on sequence public.order_number_seq, public.purchase_number_seq from anon;

-- ===================================================================
-- 4. Evitar que futuras tablas/funciones repitan el patrón: el rol que
--    ejecuta las migraciones (postgres) deja de otorgar por default a anon.
-- ===================================================================
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- ===================================================================
-- 5. Verificación de coherencia (sin efectos secundarios)
-- ===================================================================
do $$
declare
  v_ok boolean;
begin
  select has_table_privilege('anon', 'public.customers', 'SELECT') into v_ok;
  if v_ok then
    raise exception 'anon todavía tiene SELECT en public.customers';
  end if;

  select has_table_privilege('authenticated', 'public.customers', 'SELECT') into v_ok;
  if not v_ok then
    raise exception 'authenticated perdió SELECT en public.customers (regresión del fix 202607180006)';
  end if;

  select has_function_privilege('anon', 'public.get_catalog_prices()', 'EXECUTE') into v_ok;
  if not v_ok then
    raise exception 'anon perdió EXECUTE en get_catalog_prices()';
  end if;

  select has_function_privilege(
    'anon',
    'public.register_payment(uuid,numeric,uuid,text,text,text,public.payment_record_status,uuid,uuid)',
    'EXECUTE'
  ) into v_ok;
  if v_ok then
    raise exception 'anon todavía tiene EXECUTE en register_payment(...)';
  end if;

  select has_table_privilege('anon', 'public.categories', 'SELECT') into v_ok;
  if not v_ok then
    raise exception 'anon perdió SELECT en public.categories (catálogo público)';
  end if;

  raise notice 'OK: anon queda restringido al catálogo público; authenticated conserva su acceso.';
end;
$$;

notify pgrst, 'reload schema';

commit;
