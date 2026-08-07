-- Autocompletar el checkout con solo escribir el celular, también para el
-- comprador que entra a la tienda sin sesión.
--
-- Decisión del negocio: con una base de pocas decenas de clientes sobre los
-- ~50 millones de celulares del país, rastrear números al azar no devuelve
-- nada útil, así que exigir sesión solo estorbaba al cliente real que vuelve
-- a comprar desde otro teléfono.
--
-- La función devuelve únicamente lo que el checkout necesita para armar el
-- pedido: nombre y dirección de entrega. Nunca documento, correo, saldo,
-- cupo, lista de precios ni historial, que sí seguirían siendo una filtración
-- de condiciones comerciales.

begin;

set search_path = public, pg_temp;

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
  'Nombre y dirección de entrega asociados a un celular, para autocompletar el checkout. Devuelve solo datos de entrega, nunca documento, correo, saldo, cupo ni lista de precios.';

revoke all on function public.lookup_customer_for_order(text) from public;
grant execute on function public.lookup_customer_for_order(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
