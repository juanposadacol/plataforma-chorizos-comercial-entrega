-- Pruebas de la imagen por producto (202608070015_product_image_single_source.sql).
-- Todo corre dentro de begin/rollback: ningún dato queda modificado.
--
-- El fallo que fijan estas pruebas: los tres chorizos mostraban la misma
-- fotografía porque el panel guardaba la URL en `products.image_url` y la tienda
-- leía `products.main_image_url`. Nada las sincronizaba, el catálogo recibía
-- null y el frontend caía en un respaldo fijo.

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- ---------------------------------------------------------------------------
-- 1. Una sola columna de imagen en products
-- ---------------------------------------------------------------------------
select hasnt_column(
  'public', 'products', 'image_url',
  'products ya no tiene la columna duplicada que el catálogo nunca leía'
);
select has_column(
  'public', 'products', 'main_image_url',
  'la imagen del producto vive en main_image_url'
);

-- ---------------------------------------------------------------------------
-- 2. Cada producto con su propia fotografía
-- ---------------------------------------------------------------------------
select is(
  (select main_image_url from public.products where slug = 'santa-rosano'),
  '/assets/santa-rosano.png',
  'Santa Rosano apunta a su propia fotografía'
);
select is(
  (select main_image_url from public.products where slug = 'argentino'),
  '/assets/argentino.png',
  'Argentino apunta a su propia fotografía'
);
select is(
  (select main_image_url from public.products where slug = 'jalapeno'),
  '/assets/jalapeno.png',
  'Jalapeño apunta a su propia fotografía'
);
-- La comprobación que reproduce el síntoma reportado.
select is(
  (select count(distinct main_image_url) from public.products where deleted_at is null),
  (select count(*) from public.products where deleted_at is null),
  'no hay dos productos compartiendo la misma fotografía'
);
select is(
  (select count(*) from public.products
   where deleted_at is null and coalesce(btrim(main_image_url), '') = ''),
  0::bigint,
  'ningún producto se queda sin fotografía'
);

-- ---------------------------------------------------------------------------
-- 3. Lo que de verdad ve la tienda
-- ---------------------------------------------------------------------------
-- `get_catalog_prices()` es el origen del catálogo público: si aquí salen
-- distintas, las tarjetas salen distintas.
select is(
  (select count(distinct image_url) from public.get_catalog_prices()),
  3::bigint,
  'el catálogo público devuelve tres fotografías distintas'
);
select is(
  (select image_url from public.get_catalog_prices() where name = 'Argentino'),
  '/assets/argentino.png',
  'el catálogo entrega a cada producto su propia imagen'
);
-- El precio por celular usa otra función: no puede perder la imagen.
select is(
  (select count(distinct image_url) from public.get_catalog_prices_for_phone('3001111111')),
  3::bigint,
  'el catálogo con precio por celular conserva las tres fotografías'
);

-- ---------------------------------------------------------------------------
-- 4. La asociación no depende del precio ni de las existencias
-- ---------------------------------------------------------------------------
-- Las existencias no se tocan aquí: solo cambian por un movimiento de
-- inventario, y un guard de la base lo impone.
update public.products
set public_price = public_price + 1000,
    presentation = 'Otra presentación',
    allow_backorder = true
where slug = 'argentino';

select is(
  (select main_image_url from public.products where slug = 'argentino'),
  '/assets/argentino.png',
  'cambiar precio, presentación y disponibilidad no altera la fotografía'
);
select is(
  (select image_url from public.get_catalog_prices() where name = 'Argentino'),
  '/assets/argentino.png',
  'y el catálogo la sigue entregando igual'
);

select finish();
rollback;
