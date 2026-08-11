-- Una sola columna de imagen por producto: `products.main_image_url`.
--
-- EL PROBLEMA
-- Los tres productos de la tienda mostraban la MISMA fotografía (la de Santa
-- Rosano). No era que compartieran la imagen: era que ninguno tenía ninguna.
--
-- `products.main_image_url` existe desde el esquema original y es la que lee la
-- tienda: `get_catalog_prices()` y `get_catalog_prices_for_phone()` seleccionan
-- `p.main_image_url` y la devuelven con el alias `image_url`, y la vista
-- `store_products` hace lo mismo.
--
-- Pero 202607180002 agregó además `products.image_url` como columna suelta, y el
-- panel administrativo quedó escribiendo en ESA. Nada sincronizaba las dos, así
-- que la URL que administración guardaba no llegaba nunca al catálogo y
-- `main_image_url` se quedaba en null. El frontend, al no recibir imagen, caía
-- en un respaldo fijo apuntado a la foto del Santa Rosano, y los tres productos
-- terminaban con esa misma foto.
--
-- LA CORRECCIÓN
-- Se conserva `main_image_url` —la que ya usaban la tienda, la vista pública y
-- el snapshot histórico de `order_items`— y se retira la duplicada, para que no
-- se puedan volver a separar. El panel pasa a escribir en `main_image_url` en el
-- mismo cambio.
--
-- Ningún objeto SQL del repositorio referencia `products.image_url`: la columna
-- solo existía para que el formulario del panel no fallara al guardar.
-- `categories.image_url` y `order_items.image_url` son de otras tablas y no se
-- tocan.

begin;

set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. No perder lo que administración ya había guardado
-- ---------------------------------------------------------------------------
-- Todo lo que se escribió por el panel vive en la columna duplicada. Se copia
-- antes de eliminarla, y solo donde `main_image_url` está vacía: si alguien ya
-- puso una imagen buena por otra vía, esa manda.
update public.products
set main_image_url = nullif(btrim(image_url), ''),
    updated_at = now()
where main_image_url is null
  and nullif(btrim(image_url), '') is not null;

-- ---------------------------------------------------------------------------
-- 2. Cada producto con su propia fotografía, asociada por `slug`
-- ---------------------------------------------------------------------------
-- El `slug` es el identificador estable del producto: no depende del orden del
-- catálogo, ni del precio, ni de la presentación, ni de las existencias. El
-- `sku` sirve de respaldo para una base donde el slug se haya editado.
--
-- Solo se corrigen las filas sin imagen o que apuntan a un asset del proyecto
-- (incluida la foto equivocada que quedó compartida). Una URL propia —por
-- ejemplo de Supabase Storage— se respeta y no se pisa.
with imagen_por_producto (slug, sku_prefijo, ruta) as (
  values
    ('santa-rosano', 'CHO-SR', '/assets/santa-rosano.png'),
    ('argentino',    'CHO-AR', '/assets/argentino.png'),
    ('jalapeno',     'CHO-JA', '/assets/jalapeno.png')
)
update public.products p
set main_image_url = i.ruta,
    updated_at = now()
from imagen_por_producto i
where p.deleted_at is null
  and (p.slug = i.slug or p.sku like i.sku_prefijo || '%')
  and p.main_image_url is distinct from i.ruta
  and (p.main_image_url is null or btrim(p.main_image_url) = '' or p.main_image_url like '/assets/%');

-- ---------------------------------------------------------------------------
-- 3. Retirar la columna duplicada
-- ---------------------------------------------------------------------------
-- Mientras existan las dos, cualquier formulario nuevo puede volver a escribir
-- en la equivocada y reproducir exactamente este fallo.
alter table public.products drop column if exists image_url;

comment on column public.products.main_image_url is
  'Única fuente de la fotografía del producto. La leen get_catalog_prices(), get_catalog_prices_for_phone(), la vista store_products y el panel administrativo. No se debe agregar otra columna de imagen a products.';

notify pgrst, 'reload schema';

commit;
