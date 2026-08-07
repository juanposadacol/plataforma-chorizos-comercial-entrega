-- 1) Categorías de gasto pedidas por el negocio.
-- 2) Búsqueda de cliente por celular para que el PERSONAL autocomplete el
--    checkout al tomar un pedido por teléfono o WhatsApp.

begin;

set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. Categorías de gasto
-- ---------------------------------------------------------------------------
-- `seed.sql` solo corre en entornos locales, por eso la base en producción
-- quedó sin categorías y el selector de "Crear gasto" aparecía vacío.
--
-- `is_operating_expense` decide si el gasto resta en la utilidad neta.
-- "Pago de proveedores" va en FALSE a propósito: la mercancía ya descuenta
-- utilidad como costo de ventas cuando se vende, así que registrarla además
-- como gasto operativo la restaría dos veces y la utilidad saldría más baja de
-- lo real. Queda disponible para llevar el registro del desembolso sin
-- distorsionar el indicador.

insert into public.expense_categories (code, name, is_operating_expense) values
  ('insumos', 'Insumos', true),
  ('mano_de_obra', 'Mano de obra', true),
  ('servicios', 'Servicios', true),
  ('arriendo', 'Arriendo', true),
  ('pago_proveedores', 'Pago de proveedores', false)
on conflict (code) where deleted_at is null do update
  set name = excluded.name,
      is_operating_expense = excluded.is_operating_expense,
      is_active = true,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Búsqueda de cliente por celular (solo personal)
-- ---------------------------------------------------------------------------
-- Deliberadamente NO se expone al comprador anónimo: si cualquiera pudiera
-- escribir un celular en la tienda pública y recibir el nombre y la dirección
-- de casa de esa persona, la plataforma se volvería un directorio de datos
-- personales consultable por número. El cliente que compra desde la tienda
-- sigue autocompletando con lo guardado en su propio dispositivo o con su
-- sesión iniciada por SMS.

create or replace function public.lookup_customer_for_order(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_phone text;
  v_customer record;
  v_address record;
begin
  perform public.require_staff(array['superadmin','admin','vendedor','contabilidad']);

  v_phone := public.normalize_phone(coalesce(p_phone, ''));
  if v_phone !~ '^[1-9][0-9]{9,14}$' then
    return null;
  end if;

  select c.id, c.full_name, c.phone
    into v_customer
  from public.customers c
  where public.normalize_phone(c.phone) = v_phone
    and c.deleted_at is null
  order by c.created_at desc
  limit 1;

  if v_customer.id is null then
    return null;
  end if;

  select a.address_line, a.neighborhood, a.municipality
    into v_address
  from public.customer_addresses a
  where a.customer_id = v_customer.id
    and a.deleted_at is null
    and a.is_active
  order by a.is_primary desc, a.created_at desc
  limit 1;

  return jsonb_build_object(
    'phone', v_customer.phone,
    'name', coalesce(v_customer.full_name, ''),
    'address', coalesce(v_address.address_line, ''),
    'neighborhood', coalesce(v_address.neighborhood, ''),
    'municipality', coalesce(v_address.municipality, '')
  );
end;
$$;

comment on function public.lookup_customer_for_order(text) is
  'Datos de contacto de un cliente por celular para autocompletar un pedido tomado por el personal. Requiere rol de personal; nunca se expone al comprador anónimo.';

revoke all on function public.lookup_customer_for_order(text) from public;
grant execute on function public.lookup_customer_for_order(text) to authenticated;

notify pgrst, 'reload schema';

commit;
