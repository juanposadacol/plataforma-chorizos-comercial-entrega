-- Guardar la dirección del pedido en la libreta del cliente.
--
-- MOTIVO
-- `create_order` valida un `address_id` cuando el cliente elige una dirección
-- guardada, pero la dirección que se escribe en el checkout solo quedaba en el
-- pedido. Por eso ningún cliente tenía dirección propia: la columna "Ubicación"
-- del panel salía vacía y el autocompletado por celular solo podía devolver el
-- nombre.
--
-- Se resuelve con un disparador sobre `orders` en vez de reescribir
-- `create_order`, que es una función larga y crítica: así la creación del
-- pedido conserva exactamente el comportamiento ya probado y la libreta se
-- actualiza como efecto posterior. Si el guardado de la dirección fallara, no
-- puede tumbar la venta.

begin;

set search_path = public, pg_temp;

create or replace function public.sync_customer_address_from_order()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_address text;
  v_has_primary boolean;
begin
  v_address := btrim(coalesce(new.delivery_address, ''));

  -- `customer_addresses.address_line` exige entre 4 y 300 caracteres.
  if new.customer_id is null or char_length(v_address) not between 4 and 300 then
    return new;
  end if;

  -- Si ya tiene guardada esa misma dirección, solo se refrescan barrio y
  -- municipio por si el cliente los corrigió al pedir.
  update public.customer_addresses
  set neighborhood = coalesce(nullif(btrim(coalesce(new.neighborhood, '')), ''), neighborhood),
      municipality = coalesce(nullif(btrim(coalesce(new.municipality, '')), ''), municipality),
      updated_at = now()
  where customer_id = new.customer_id
    and deleted_at is null
    and lower(btrim(address_line)) = lower(v_address);

  if found then
    return new;
  end if;

  select exists (
    select 1 from public.customer_addresses
    where customer_id = new.customer_id and is_primary and deleted_at is null
  ) into v_has_primary;

  -- La primera dirección queda como principal; `one_primary_customer_address_uq`
  -- impide que haya dos.
  insert into public.customer_addresses (
    customer_id, label, address_line, neighborhood, municipality, is_primary, is_active
  ) values (
    new.customer_id,
    'Principal',
    v_address,
    nullif(btrim(coalesce(new.neighborhood, '')), ''),
    nullif(btrim(coalesce(new.municipality, '')), ''),
    not v_has_primary,
    true
  );

  return new;
exception when others then
  -- Un problema al guardar la libreta nunca debe impedir que se cree el pedido.
  return new;
end;
$$;

comment on function public.sync_customer_address_from_order() is
  'Copia la dirección de entrega del pedido a la libreta del cliente para que el checkout pueda autocompletarla la próxima vez.';

drop trigger if exists sync_customer_address_after_order on public.orders;
create trigger sync_customer_address_after_order
  after insert on public.orders
  for each row
  execute function public.sync_customer_address_from_order();

-- ---------------------------------------------------------------------------
-- Recuperar las direcciones de los pedidos que ya existen
-- ---------------------------------------------------------------------------
-- Toma la dirección más reciente de cada cliente que hoy no tiene ninguna.

insert into public.customer_addresses (
  customer_id, label, address_line, neighborhood, municipality, is_primary, is_active
)
select distinct on (o.customer_id)
  o.customer_id,
  'Principal',
  btrim(o.delivery_address),
  nullif(btrim(coalesce(o.neighborhood, '')), ''),
  nullif(btrim(coalesce(o.municipality, '')), ''),
  true,
  true
from public.orders o
where o.deleted_at is null
  and char_length(btrim(coalesce(o.delivery_address, ''))) between 4 and 300
  and not exists (
    select 1 from public.customer_addresses ca
    where ca.customer_id = o.customer_id and ca.deleted_at is null
  )
order by o.customer_id, o.created_at desc;

notify pgrst, 'reload schema';

commit;
