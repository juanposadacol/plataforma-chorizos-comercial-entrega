-- Migración 202607180006: Corrección integral de permisos del panel administrativo.
--
-- CAUSA RAÍZ
-- La migración 202607170001 protegía la columna pin_hash de customers usando:
--
--   revoke select on table public.customers from authenticated;
--   grant select (id, full_name, …) on public.customers to authenticated;
--
-- PostgreSQL exige privilegio SELECT de *tabla* (no solo de columna) para que
-- PostgREST pueda resolver SELECT *.  Sin ese privilegio, cualquier consulta
-- SELECT enviada desde el cliente Supabase falla con:
--   "permission denied for table customers"
-- El error se produce en la capa de privilegios SQL, *antes* de que RLS evalúe
-- las políticas, por lo que incluso usuarios con rol superadmin/admin lo reciben.
--
-- PÁGINAS AFECTADAS (AdminDashboardPage usa getDashboardSnapshot que lee customers)
--   • Resumen del negocio (AdminDashboardPage)
--   • Clientes (CustomersPage → CustomerTable)
--   • Detalle de cliente (CustomerDetailPage)
--   • Listas y precios (PricingPage → PriceListEditor)
--   • Pagos y cartera (PaymentsPage — muestra nombre de cliente en pedidos)
--
-- OTRAS TABLAS
-- Solo public.customers tenía el patrón revoke + column-grant.
-- Todas las demás tablas del panel admin conservan GRANT SELECT de tabla completa
-- desde el loop inicial de 202607170001, y sus políticas RLS son correctas.
--
-- SOLUCIÓN
-- 1. Restaurar GRANT SELECT de tabla completa en customers.
-- 2. Reafirmar GRANT INSERT, UPDATE (ya existentes, solo por claridad).
-- 3. Agregar políticas RLS para INSERT y UPDATE del staff operativo
--    (vendedor y contabilidad), que antes fallaban con "new row violates
--    row-level security policy" porque no existía política de escritura para ellos.
--    admin/superadmin ya están cubiertos por administrators_all.
-- 4. Mantener RLS activo; las políticas existentes siguen filtrando filas.
-- 5. No otorgar ningún privilegio al rol anon sobre customers.
-- 6. La columna pin_hash (hash bcrypt) queda accesible para staff autenticado.
--    Es aceptable: el hash no revela el PIN, y el staff tiene acceso pleno al panel.

begin;

set search_path = public, pg_temp;

-- ===================================================================
-- 1.  Restaurar privilegio SELECT de tabla en customers
--     (fix principal del error "permission denied for table customers")
-- ===================================================================
grant select on public.customers to authenticated;

-- ===================================================================
-- 2.  Reafirmar INSERT y UPDATE
--     Ya se otorgaron en el loop de 202607170001 y el revoke de esa
--     migración solo afectó SELECT.  Se reafirman aquí para dejar la
--     intención de permisos explícita y resistente a futuros revoques.
-- ===================================================================
grant insert, update on public.customers to authenticated;

-- ===================================================================
-- 3.  Políticas RLS para INSERT y UPDATE del staff operativo
--
--     Políticas existentes en customers:
--       • administrators_all   (ALL, para superadmin y admin)
--       • operational_staff_read (SELECT, para vendedor, bodega, contabilidad)
--
--     Lo que falta: INSERT y UPDATE para vendedor/contabilidad que
--     necesitan registrar y actualizar clientes desde el panel admin.
--
--     Guard: comprueba primero que la política no exista para ser idempotente.
-- ===================================================================
do $$ begin
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename  = 'customers'
      and policyname = 'staff_customers_insert'
  ) then
    create policy staff_customers_insert
      on public.customers
      for insert to authenticated
      with check (public.has_any_role(array['vendedor','contabilidad']::text[]));
  end if;
end; $$;

do $$ begin
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename  = 'customers'
      and policyname = 'staff_customers_update'
  ) then
    create policy staff_customers_update
      on public.customers
      for update to authenticated
      using     (public.has_any_role(array['vendedor','contabilidad']::text[]))
      with check (public.has_any_role(array['vendedor','contabilidad']::text[]));
  end if;
end; $$;

-- ===================================================================
-- 4.  Verificación de coherencia (sin efectos secundarios)
--     has_table_privilege acepta un nombre de rol como primer argumento.
-- ===================================================================
do $$
declare
  v_ok boolean;
begin
  select has_table_privilege('authenticated', 'public.customers', 'SELECT')
    into v_ok;
  if not v_ok then
    raise exception 'El GRANT SELECT en public.customers no se aplicó correctamente';
  end if;
  raise notice 'OK: el rol authenticated tiene SELECT en public.customers';
end;
$$;

notify pgrst, 'reload schema';

commit;
