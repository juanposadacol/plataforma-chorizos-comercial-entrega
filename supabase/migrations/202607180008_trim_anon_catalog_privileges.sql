-- Migración 202607180008: Recortar privilegios de anon en el catálogo público a solo SELECT.
--
-- HALLAZGO (continuación de la auditoría de 202607180007)
-- Las 4 tablas pensadas para lectura anónima (categories, brands,
-- payment_methods, delivery_methods) también recibieron por default el mismo
-- ALTER DEFAULT PRIVILEGES descrito en 202607180007. La migración 202607170001
-- solo agregó explícitamente:
--   grant select on public.categories, public.brands, public.payment_methods,
--     public.delivery_methods to anon;
-- pero nunca revocó el resto de privilegios (INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER) que anon ya tenía por el default de esquema. 202607180007
-- excluyó a propósito estas 4 tablas del revoke general para no tocar el
-- catálogo público, pero eso dejó sin corregir el privilegio excedente en
-- ellas mismas.
--
-- IMPACTO ACTUAL: no explotable hoy. Las únicas políticas RLS para "anon" en
-- estas tablas son de solo lectura (active_categories_public_read,
-- active_brands_public_read, active_payment_methods_public_read,
-- active_delivery_methods_public_read), así que anon no puede escribir aunque
-- tenga el privilegio de tabla. Aun así, un catálogo público no debería tener
-- privilegios de escritura otorgados al rol anónimo.
--
-- SOLUCIÓN: revocar todo y volver a otorgar únicamente SELECT a anon en esas
-- 4 tablas. No se toca authenticated (el personal administra estas tablas
-- desde el panel) ni las políticas RLS existentes.
--
-- 100% idempotente: REVOKE/GRANT no fallan si el privilegio ya está en el
-- estado deseado.

begin;

set search_path = public, pg_temp;

revoke all on table public.categories, public.brands, public.payment_methods,
  public.delivery_methods from anon;

grant select on public.categories, public.brands, public.payment_methods,
  public.delivery_methods to anon;

do $$
declare
  v_ok boolean;
begin
  select has_table_privilege('anon', 'public.categories', 'SELECT') into v_ok;
  if not v_ok then
    raise exception 'anon perdió SELECT en public.categories';
  end if;

  select has_table_privilege('anon', 'public.categories', 'INSERT') into v_ok;
  if v_ok then
    raise exception 'anon todavía tiene INSERT en public.categories';
  end if;

  select has_table_privilege('authenticated', 'public.categories', 'INSERT') into v_ok;
  if not v_ok then
    raise exception 'authenticated perdió INSERT en public.categories (el personal administra el catálogo)';
  end if;

  raise notice 'OK: anon solo conserva SELECT en el catálogo público; authenticated conserva su gestión completa.';
end;
$$;

notify pgrst, 'reload schema';

commit;
