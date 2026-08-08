-- El precio del cliente se ve en la tienda, no solo al confirmar.
--
-- PROBLEMA
-- `get_catalog_prices()` resuelve el precio con `current_customer_id()`, que
-- depende de una sesión. Como el comprador ya no inicia sesión (202608070009),
-- el catálogo siempre mostraba el precio público y el precio acordado solo
-- aparecía en el total del pedido, ya confirmado. Para un mayorista eso es ver
-- un precio y pagar otro.
--
-- SOLUCIÓN
-- `get_catalog_prices_for_phone(p_phone)` devuelve exactamente las mismas
-- columnas que `get_catalog_prices()`, pero resuelve la condición comercial del
-- cliente dueño de ese celular. La tienda la consulta en cuanto el comprador
-- escribe su número completo en el checkout, con lo que las tarjetas del
-- catálogo pasan a mostrar el precio que se va a cobrar.
--
-- ALCANCE DE LO QUE EXPONE
-- Solo precios de catálogo, los mismos que ese cliente vería al comprar. No
-- revela nombre, documento, correo, saldo, cupo, historial ni cuál lista tiene
-- asignada: el `price_source` distingue «tienes un precio acordado» de «precio
-- público», que es justo lo que el comprador necesita saber. Es coherente con
-- 202608070004 (autocompletar la entrega por celular) y con 202608070009
-- (pedir solo con el celular): en los tres casos el celular es la identificación
-- del comprador, decisión explícita del negocio.
--
-- Un celular desconocido devuelve el catálogo público, sin distinguirse de uno
-- inexistente.

begin;

set search_path = public, pg_temp;

create or replace function public.get_catalog_prices_for_phone(p_phone text)
returns table (
  id uuid,
  sku text,
  slug text,
  name text,
  short_description text,
  category_id uuid,
  category_name text,
  image_url text,
  public_price numeric(16,2),
  effective_price numeric(16,2),
  stock_available numeric(16,3),
  unit text,
  presentation text,
  is_featured boolean,
  allow_backorder boolean,
  price_source text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with buyer as (
    select c.id
    from public.customers c
    where public.phone_key(c.phone) = public.phone_key(coalesce(p_phone, ''))
      and public.phone_key(coalesce(p_phone, '')) ~ '^[1-9][0-9]{9,14}$'
      and c.deleted_at is null
      and c.status = 'active'
    order by c.created_at desc
    limit 1
  )
  select
    p.id,
    p.sku,
    p.slug,
    p.name,
    p.short_description,
    p.category_id,
    coalesce(c.name, 'Chorizos artesanales'),
    p.main_image_url,
    p.public_price,
    rp.unit_price,
    case when p.track_inventory then p.stock_available else 999999::numeric end,
    p.unit,
    p.presentation,
    p.is_featured,
    p.allow_backorder,
    rp.price_source
  from public.products p
  left join public.categories c on c.id = p.category_id and c.deleted_at is null
  cross join lateral public.resolve_product_price_internal(
    (select id from buyer), p.id, null, 1, current_date
  ) rp
  where p.status = 'active'
    and p.deleted_at is null
  order by p.sort_order, p.name;
$$;

comment on function public.get_catalog_prices_for_phone(text) is
  'Catálogo con el precio que le corresponde al cliente dueño de ese celular. Devuelve solo precios; ningún otro dato del cliente. Un celular desconocido recibe el catálogo público.';

revoke all on function public.get_catalog_prices_for_phone(text) from public;
grant execute on function public.get_catalog_prices_for_phone(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
