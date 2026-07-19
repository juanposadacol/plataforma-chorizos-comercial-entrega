begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

select is(
  (select unit_price from public.resolve_product_price_internal(
    '40000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',null,1,current_date
  )), 17300::numeric, 'cliente público recibe precio público'
);
select is(
  (select unit_price from public.resolve_product_price_internal(
    '40000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222',null,1,current_date
  )), 16000::numeric, 'cliente existente recibe precio de su lista'
);
select is(
  (select unit_price from public.resolve_product_price_internal(
    '40000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111',null,1,current_date
  )), 14800::numeric, 'precio especial tiene mayor precedencia'
);

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok(
  $$select public.create_order(
    '{"customer":{"name":"Cliente Público Demo","phone":"573001111111"},"delivery_address":"Calle 1 # 2-03","delivery_method_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","payment_method_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","items":[{"product_id":"11111111-1111-4111-8111-111111111111","quantity":1}]}'::jsonb,
    '90000000-0000-4000-8000-000000000001',null,'{}'::jsonb
  )$$,
  'P0001','CUSTOMER_AUTH_REQUIRED: Este celular ya está registrado; inicia sesión con OTP',
  'un visitante no suplanta un celular registrado'
);

update public.customers
set auth_user_id='10000000-0000-4000-8000-000000000010'
where id='40000000-0000-4000-8000-000000000004';
select throws_ok(
  $$select public.create_order(
    '{"customer":{"name":"Acuerdo Especial Demo","phone":"573004444444"},"delivery_address":"Calle 1 # 2-03","delivery_method_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","payment_method_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","items":[{"product_id":"11111111-1111-4111-8111-111111111111","quantity":1}]}'::jsonb,
    '90000000-0000-4000-8000-000000000002','99999999-9999-4999-8999-999999999999',
    '{"auth_phone":"573004444444"}'::jsonb
  )$$,
  'P0001','CUSTOMER_NOT_AUTHORIZED: El cliente pertenece a otra sesión',
  'usuario autenticado no usa cliente ligado a otro auth user'
);
update public.customers set auth_user_id=null where id='40000000-0000-4000-8000-000000000004';

select lives_ok(
  $$select public.create_order(
    '{"customer":{"name":"Cliente Nuevo SQL","phone":"573009999991"},"delivery_address":"Calle 99 # 1-02","neighborhood":"Centro","municipality":"Pasto","delivery_method_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","payment_method_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","channel":"web","total":1,"items":[{"product_id":"11111111-1111-4111-8111-111111111111","quantity":1}]}'::jsonb,
    '90000000-0000-4000-8000-000000000010',null,'{}'::jsonb
  )$$,
  'pedido nuevo se crea transaccionalmente aunque intente enviar total manipulado'
);
select is(
  (select total_amount from public.orders where idempotency_key='90000000-0000-4000-8000-000000000010'),
  22300::numeric, 'servidor calcula total autorizado e ignora total del navegador'
);
select public.create_order(
  '{"customer":{"name":"Cliente Nuevo SQL","phone":"573009999991"},"delivery_address":"Calle 99 # 1-02","delivery_method_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","payment_method_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","items":[{"product_id":"11111111-1111-4111-8111-111111111111","quantity":1}]}'::jsonb,
  '90000000-0000-4000-8000-000000000010',null,'{}'::jsonb
);
select is(
  (select count(*) from public.orders where idempotency_key='90000000-0000-4000-8000-000000000010'),
  1::bigint, 'idempotency key evita pedidos duplicados'
);
select ok(
  exists(select 1 from public.notification_deliveries nd join public.notifications n on n.id=nd.notification_id
    join public.orders o on o.id=n.order_id where o.idempotency_key='90000000-0000-4000-8000-000000000010'
      and nd.status='manual_required'),
  'pedido persiste y deja fallback manual independiente de WhatsApp'
);
select is(
  (select stock_reserved from public.products where id='11111111-1111-4111-8111-111111111111'),
  3::numeric, 'crear pedido reserva inventario'
);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000010"}',true);
select lives_ok(
  $$select public.transition_order_status(
    (select id from public.orders where idempotency_key='90000000-0000-4000-8000-000000000010'),
    'cancelled','Prueba de cancelación',null,null
  )$$,
  'cancelación transaccional funciona'
);
select is(
  (select stock_reserved from public.products where id='11111111-1111-4111-8111-111111111111'),
  2::numeric, 'cancelar libera exactamente la reserva del pedido'
);

insert into public.purchases(
  id,purchase_number,supplier_id,purchase_date,status,subtotal_amount,discount_amount,tax_amount,total_amount,paid_amount,balance_amount,created_by
) values (
  '90000000-0000-4000-8000-000000000020','COM-TEST-0001','50000000-0000-4000-8000-000000000001',current_date,
  'ordered',125000,0,0,125000,125000,0,'10000000-0000-4000-8000-000000000010'
);
insert into public.purchase_items(
  id,purchase_id,product_id,sku,product_name,quantity,unit_cost,subtotal_amount,discount_amount,tax_amount,total_amount
) values (
  '90000000-0000-4000-8000-000000000021','90000000-0000-4000-8000-000000000020','33333333-3333-4333-8333-333333333333',
  'CHO-JA-500','Jalapeño',10,12500,125000,0,0,125000
);
select lives_ok(
  $$select public.receive_purchase('90000000-0000-4000-8000-000000000020',null,'Prueba SQL')$$,
  'recepción de compra incrementa inventario'
);
select is(
  (select stock_on_hand from public.products where id='33333333-3333-4333-8333-333333333333'),
  50::numeric, 'compra recibida suma existencias'
);
select is(
  (select average_cost from public.products where id='33333333-3333-4333-8333-333333333333'),
  11700::numeric, 'compra recalcula costo promedio ponderado'
);
select is(
  (select balance_amount from public.accounts_receivable where order_id='60000000-0000-4000-8000-000000000002'),
  17000::numeric, 'pago parcial conserva saldo correcto'
);
select ok(
  not (public.get_order_tracking((select tracking_token from public.orders where id='60000000-0000-4000-8000-000000000002')) ? 'sales_cost'),
  'seguimiento público no expone costos ni utilidad'
);
select is(
  (select product_id from public.report_product_ranking(current_date-30,current_date,1)),
  '22222222-2222-4222-8222-222222222222'::uuid, 'reporte identifica producto con ventas demo'
);

update public.products set public_price=19900 where id='11111111-1111-4111-8111-111111111111';
select is(
  (select public_unit_price from public.order_items where id='61000000-0000-4000-8000-000000000001'),
  17300::numeric, 'cambio de precio no altera snapshot histórico'
);

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"99999999-9999-4999-8999-999999999998"}',true);
select is((select count(*) from public.customers),0::bigint,'RLS oculta clientes ajenos a usuario sin rol');
reset role;

-- ---------------------------------------------------------------------------
-- Regresión H-05 / H-13 (AUDITORIA_PREPRODUCCION_NETLIFY.md). Identidades de
-- prueba contabilidad-only/vendedor-only, creadas y descartadas dentro de la
-- misma transacción de la suite (rollback al final, igual que todo lo demás).
-- ---------------------------------------------------------------------------
insert into auth.users(id) values
  ('90000000-0000-4000-8000-0000000000c1'),
  ('90000000-0000-4000-8000-0000000000c2')
on conflict (id) do nothing;
insert into public.profiles(id, full_name) values
  ('90000000-0000-4000-8000-0000000000c1', '[TEST] Contabilidad only'),
  ('90000000-0000-4000-8000-0000000000c2', '[TEST] Vendedor only')
on conflict (id) do nothing;
insert into public.user_roles(profile_id, role_id) values
  ('90000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-000000000005'), -- contabilidad
  ('90000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-000000000003') -- vendedor
on conflict do nothing;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok(
  $$select public.create_order(
    '{"customer":{"name":"H05H13 Test","phone":"573009999992"},"delivery_address":"Calle 88 # 1-01","delivery_method_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","payment_method_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","items":[{"product_id":"11111111-1111-4111-8111-111111111111","quantity":6}]}'::jsonb,
    '90000000-0000-4000-8000-0000000000e1',null,'{}'::jsonb
  )$$,
  'H-05/H-13: pedido de prueba se crea correctamente'
);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000010"}',true);
select lives_ok(
  $$select public.register_payment(
    (select id from public.orders where idempotency_key='90000000-0000-4000-8000-0000000000e1'),
    30000,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,null,null,'abono 1',
    'approved'::public.payment_record_status,null,'90000000-0000-4000-8000-0000000000f1'::uuid
  )$$,
  'H-05a: primer register_payment con una llave de idempotencia nueva funciona'
);
select lives_ok(
  $$select public.register_payment(
    (select id from public.orders where idempotency_key='90000000-0000-4000-8000-0000000000e1'),
    30000,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,null,null,'abono 1 retry',
    'approved'::public.payment_record_status,null,'90000000-0000-4000-8000-0000000000f1'::uuid
  )$$,
  'H-05a: reintento con la MISMA llave no lanza error'
);
select is(
  (select count(*) from public.payments where idempotency_key='90000000-0000-4000-8000-0000000000f1'::uuid),
  1::bigint, 'H-05a: el reintento con la misma llave NO duplica el pago'
);
select throws_ok(
  $$select public.register_payment(
    (select id from public.orders where idempotency_key='90000000-0000-4000-8000-0000000000e1'),
    99999,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,null,null,'monto distinto',
    'approved'::public.payment_record_status,null,'90000000-0000-4000-8000-0000000000f1'::uuid
  )$$,
  'P0001','IDEMPOTENCY_KEY_REUSED: Esta llave de idempotencia ya se usó con un monto o método distinto',
  'H-05b: reusar la llave con un monto distinto se rechaza con un error funcional claro'
);
select throws_ok(
  $$select public.register_payment(
    (select id from public.orders where idempotency_key='90000000-0000-4000-8000-0000000000e1'),
    999999999,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,null,null,'overpay',
    'approved'::public.payment_record_status,null,gen_random_uuid()
  )$$,
  'P0001', null,
  'H-05c: un pago que supera el saldo pendiente sigue siendo rechazado'
);

select throws_ok(
  $$select public.deliver_and_pay_order(
    (select id from public.orders where idempotency_key='90000000-0000-4000-8000-0000000000e1'),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,null,null,'contabilidad intenta entregar',gen_random_uuid()
  )$$,
  'P0001', null,
  'H-13: contabilidad-only NO puede disparar el paso de entrega de un pedido no entregado'
);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-4000-8000-0000000000c2"}',true);
select throws_ok(
  $$select public.deliver_and_pay_order(
    (select id from public.orders where idempotency_key='90000000-0000-4000-8000-0000000000e1'),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,null,null,'vendedor intenta entregar',gen_random_uuid()
  )$$,
  'P0001', null,
  'H-13: vendedor-only tampoco puede disparar el paso de entrega (transition_order_status ya lo bloquea)'
);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000010"}',true);
select lives_ok(
  $$select public.deliver_and_pay_order(
    (select id from public.orders where idempotency_key='90000000-0000-4000-8000-0000000000e1'),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,null,null,'superadmin entrega y paga',gen_random_uuid()
  )$$,
  'H-13: superadmin sí puede entregar y pagar'
);
select is(
  (select status::text from public.orders where idempotency_key='90000000-0000-4000-8000-0000000000e1'),
  'delivered', 'H-13: el pedido queda entregado tras la acción del superadmin'
);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-4000-8000-0000000000c1"}',true);
select lives_ok(
  $$select public.deliver_and_pay_order(
    (select id from public.orders where idempotency_key='90000000-0000-4000-8000-0000000000e1'),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,null,null,'contabilidad paga pedido ya entregado',gen_random_uuid()
  )$$,
  'H-13: contabilidad SÍ puede usar la acción combinada sobre un pedido ya entregado (solo paga)'
);

select * from finish();
rollback;
