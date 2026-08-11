-- Reutilización del correo guardado del cliente (202608070014).
--
-- Lo que se fija aquí:
--   * el correo que ya está en la ficha se usa solo si es entregable;
--   * la búsqueda pública por celular no devuelve el correo completo;
--   * un correo nuevo escrito en el checkout gana y actualiza la ficha;
--   * un pedido sin correo se crea igual, y con correo imposible también;
--   * un reintento idempotente no duplica la entrega de correo.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

select set_config('request.jwt.claims','{"role":"service_role"}',true);

-- ---------------------------------------------------------------------------
-- usable_email: criterio único de «correo que Gmail podría entregar»
-- ---------------------------------------------------------------------------
select is(public.usable_email('juan@correo.com'), 'juan@correo.com',
  'usable_email acepta un correo normal');
select is(public.usable_email('  juan@correo.com  '), 'juan@correo.com',
  'usable_email recorta espacios');
select is(public.usable_email('juan.perez+pedidos@mi-dominio.com.co'), 'juan.perez+pedidos@mi-dominio.com.co',
  'usable_email acepta subetiquetas y dominios compuestos');
-- El caso que motiva la función: customers.email es texto libre y sin CHECK.
select is(public.usable_email('no tiene'), null,
  'usable_email descarta un texto que no es correo');
select is(public.usable_email('juan@correo'), null,
  'usable_email exige extensión de dominio');
select is(public.usable_email('juan @correo.com'), null,
  'usable_email rechaza espacios internos');
select is(public.usable_email(''), null, 'usable_email trata el vacío como ausente');
select is(public.usable_email(null), null, 'usable_email tolera null');
select is(public.usable_email(repeat('a',250)||'@correo.com'), null,
  'usable_email rechaza una dirección más larga de lo entregable');

-- ---------------------------------------------------------------------------
-- mask_email: pista que sirve a su dueño y no a un tercero
-- ---------------------------------------------------------------------------
select is(public.mask_email('juan.perez@gmail.com'), 'j••••@g••••.com',
  'mask_email deja solo la inicial de la cuenta, la del dominio y la extensión');
select is(public.mask_email('x@correo.com.co'), 'x••••@c••••.co',
  'mask_email conserva la extensión real de un dominio compuesto');
select is(public.mask_email('no tiene'), null,
  'mask_email no inventa una pista para un correo inservible');

-- ---------------------------------------------------------------------------
-- lookup_customer_for_order: nunca el correo completo
-- ---------------------------------------------------------------------------
update public.customers set email = 'juan.perez@gmail.com'
where id = '40000000-0000-4000-8000-000000000001';

select is(
  public.lookup_customer_for_order('3001111111') ->> 'has_email', 'true',
  'la búsqueda por celular avisa que hay un correo guardado'
);
select is(
  public.lookup_customer_for_order('3001111111') ->> 'email_hint', 'j••••@g••••.com',
  'la búsqueda por celular devuelve la pista enmascarada'
);
-- La invariante de privacidad: basta conocer un celular ajeno para llamar aquí.
select ok(
  public.lookup_customer_for_order('3001111111')::text not like '%juan.perez@gmail.com%'
  and public.lookup_customer_for_order('3001111111')::text not like '%gmail%',
  'la búsqueda pública por celular NO expone el correo ni su dominio'
);

update public.customers set email = 'no tiene'
where id = '40000000-0000-4000-8000-000000000001';
select is(
  public.lookup_customer_for_order('3001111111') ->> 'has_email', 'false',
  'un correo guardado pero inservible no se anuncia como disponible'
);

-- ---------------------------------------------------------------------------
-- create_order: qué correo recibe la confirmación
-- ---------------------------------------------------------------------------
-- 1. El comprador no escribe correo y su ficha sí tiene uno válido.
update public.customers set email = 'juan.perez@gmail.com'
where id = '40000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.create_order(
    '{"customer":{"name":"Cliente Público Demo","phone":"3001111111"},"delivery_address":"Calle 1 # 2-03","delivery_method_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","payment_method_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","items":[{"product_id":"33333333-3333-4333-8333-333333333333","quantity":1}]}'::jsonb,
    '95000000-0000-4000-8000-000000000001',null,'{}'::jsonb
  )$$,
  'un pedido sin correo en el formulario se crea normalmente'
);
select is(
  (select nd.recipient
   from public.orders o
   join public.notifications n on n.order_id = o.id
   join public.notification_deliveries nd on nd.notification_id = n.id and nd.channel = 'email'
   where o.idempotency_key = '95000000-0000-4000-8000-000000000001'),
  'juan.perez@gmail.com',
  'sin correo en el formulario, la confirmación se encola al correo guardado del cliente'
);

-- 2. El comprador escribe un correo nuevo: gana y queda en la ficha.
select lives_ok(
  $$select public.create_order(
    '{"customer":{"name":"Cliente Público Demo","phone":"3001111111","email":"  nuevo@correo.com  "},"delivery_address":"Calle 1 # 2-03","delivery_method_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","payment_method_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","items":[{"product_id":"33333333-3333-4333-8333-333333333333","quantity":1}]}'::jsonb,
    '95000000-0000-4000-8000-000000000002',null,'{}'::jsonb
  )$$,
  'un pedido con correo nuevo se crea normalmente'
);
select is(
  (select c.email from public.customers c where c.id = '40000000-0000-4000-8000-000000000001'),
  'nuevo@correo.com',
  'el correo nuevo reemplaza al guardado en la ficha del cliente'
);

-- 3. Ficha con correo imposible: el pedido NO puede depender de eso.
update public.customers set email = 'no tiene'
where id = '40000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.create_order(
    '{"customer":{"name":"Cliente Público Demo","phone":"3001111111"},"delivery_address":"Calle 1 # 2-03","delivery_method_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","payment_method_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","items":[{"product_id":"33333333-3333-4333-8333-333333333333","quantity":1}]}'::jsonb,
    '95000000-0000-4000-8000-000000000003',null,'{}'::jsonb
  )$$,
  'un correo guardado inservible no impide crear el pedido'
);
select is(
  (select count(*)
   from public.orders o
   join public.notifications n on n.order_id = o.id
   join public.notification_deliveries nd on nd.notification_id = n.id and nd.channel = 'email'
   where o.idempotency_key = '95000000-0000-4000-8000-000000000003'),
  0::bigint,
  'no se encola una entrega de correo que jamás podría completarse'
);
-- Y el aviso al negocio sigue saliendo: el correo no es el único canal.
select is(
  (select count(*)
   from public.orders o
   join public.notifications n on n.order_id = o.id
   join public.notification_deliveries nd on nd.notification_id = n.id and nd.channel = 'whatsapp'
   where o.idempotency_key = '95000000-0000-4000-8000-000000000003'),
  1::bigint,
  'el aviso de WhatsApp se encola aunque no haya correo'
);

-- 4. Un reintento idempotente no manda un segundo correo.
select public.create_order(
  '{"customer":{"name":"Cliente Público Demo","phone":"3001111111","email":"repetido@correo.com"},"delivery_address":"Calle 1 # 2-03","delivery_method_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","payment_method_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","items":[{"product_id":"33333333-3333-4333-8333-333333333333","quantity":1}]}'::jsonb,
  '95000000-0000-4000-8000-000000000004',null,'{}'::jsonb
);
select public.create_order(
  '{"customer":{"name":"Cliente Público Demo","phone":"3001111111","email":"repetido@correo.com"},"delivery_address":"Calle 1 # 2-03","delivery_method_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","payment_method_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","items":[{"product_id":"33333333-3333-4333-8333-333333333333","quantity":1}]}'::jsonb,
  '95000000-0000-4000-8000-000000000004',null,'{}'::jsonb
);
select is(
  (select count(*) from public.orders where idempotency_key = '95000000-0000-4000-8000-000000000004'),
  1::bigint,
  'el reintento devuelve el mismo pedido, no crea otro'
);
select is(
  (select count(*)
   from public.orders o
   join public.notifications n on n.order_id = o.id
   join public.notification_deliveries nd on nd.notification_id = n.id and nd.channel = 'email'
   where o.idempotency_key = '95000000-0000-4000-8000-000000000004'),
  1::bigint,
  'el reintento no encola una segunda entrega de correo'
);
-- Segunda defensa, por si algo llamara al insert directamente.
select throws_ok(
  $$insert into public.notification_deliveries(notification_id, channel, status, recipient, provider)
    select n.id, 'email', 'pending', 'otro@correo.com', 'apps_script'
    from public.orders o join public.notifications n on n.order_id = o.id
    where o.idempotency_key = '95000000-0000-4000-8000-000000000004'$$,
  '23505', null,
  'el índice único impide una segunda entrega de correo para la misma notificación'
);

select * from finish();
rollback;
