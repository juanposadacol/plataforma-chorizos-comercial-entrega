-- Pruebas de public.delete_order_permanently().
-- Todo corre dentro de begin/rollback: ningún dato queda modificado.
--
-- Regla vigente (202608070006_delete_order_permanently_any_state.sql): un
-- superadministrador puede eliminar un pedido en CUALQUIER estado, incluido
-- pagado y entregado, porque la función revierte antes inventario, caja, pagos y
-- cartera. Lo único que la detiene es un gasto contable asociado.
--
-- Fixtures del seed que se usan:
--   60000000-…-0001  status 'new', payment 'pending', amount_paid 0,
--                    1 reserva activa (qty 2, producto 1111…), 1 movimiento
--                    'reservation'
--   60000000-…-0002  status 'delivered', payment 'partial', reserva 'fulfilled',
--                    movimientos 'reservation' + 'sale' (producto 2222…),
--                    1 pago aprobado de 20.000 y su movimiento de caja
--   10000000-…-0010  perfil con rol superadmin

begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

-- ---------------------------------------------------------------------------
-- Fixtures adicionales
-- ---------------------------------------------------------------------------

-- Un administrador que NO es superadministrador.
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,email_change,email_change_token_new,recovery_token
) values (
  '00000000-0000-0000-0000-000000000000','10000000-0000-4000-8000-0000000000a1',
  'authenticated','authenticated','solo.admin@test.invalid',
  extensions.crypt('prueba', extensions.gen_salt('bf')), now(),
  '{}'::jsonb,'{}'::jsonb, now(), now(), '','','',''
);
insert into public.profiles(id,full_name,email,is_active)
values ('10000000-0000-4000-8000-0000000000a1','Solo Admin','solo.admin@test.invalid',true);
insert into public.user_roles(profile_id,role_id)
values ('10000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-000000000002');

-- Un pedido Nuevo pero CON pago aplicado.
create temporary table tmp_paid as select * from public.orders where id='60000000-0000-4000-8000-000000000001';
update tmp_paid set
  id='6f000000-0000-4000-8000-0000000000f1',
  order_number='PED-TEST-9001',
  idempotency_key=gen_random_uuid(),
  tracking_token=gen_random_uuid(),
  status='new', payment_status='partial', amount_paid=1000;
insert into public.orders select * from tmp_paid;

-- Un pedido Nuevo con DOS reservas activas, para probar la atomicidad.
create temporary table tmp_atomic as select * from public.orders where id='60000000-0000-4000-8000-000000000001';
update tmp_atomic set
  id='6f000000-0000-4000-8000-0000000000f2',
  order_number='PED-TEST-9002',
  idempotency_key=gen_random_uuid(),
  tracking_token=gen_random_uuid(),
  status='new', payment_status='pending', amount_paid=0;
insert into public.orders select * from tmp_atomic;

-- Un pedido con un gasto contable asociado: el único caso que sigue bloqueado.
create temporary table tmp_expense as select * from public.orders where id='60000000-0000-4000-8000-000000000001';
update tmp_expense set
  id='6f000000-0000-4000-8000-0000000000f3',
  order_number='PED-TEST-9003',
  idempotency_key=gen_random_uuid(),
  tracking_token=gen_random_uuid(),
  status='new', payment_status='pending', amount_paid=0;
insert into public.orders select * from tmp_expense;

insert into public.expenses(
  id,expense_date,category_id,description,amount,status,order_id,created_by
) values (
  '6f400000-0000-4000-8000-0000000000f1',current_date,'70000000-0000-4000-8000-000000000001',
  'Domicilio del pedido de prueba',9000,'draft','6f000000-0000-4000-8000-0000000000f3',
  '10000000-0000-4000-8000-000000000010'
);

insert into public.order_items(
  id,order_id,product_id,sku,product_name,unit,quantity,unit_price,public_unit_price,
  subtotal_amount,discount_amount,total_amount,unit_cost,total_cost,gross_profit,price_source
) values
  ('6f100000-0000-4000-8000-0000000000f1','6f000000-0000-4000-8000-0000000000f2',
   '11111111-1111-4111-8111-111111111111','CHO-SR-500','Santa Rosano','paquete',
   1,14800,17300,14800,0,14800,11000,11000,3800,'public'),
  ('6f100000-0000-4000-8000-0000000000f2','6f000000-0000-4000-8000-0000000000f2',
   '22222222-2222-4222-8222-222222222222','CHO-AR-500','Argentino','paquete',
   1,16000,17300,16000,0,16000,11200,11200,4800,'public');

insert into public.inventory_reservations(id,order_id,order_item_id,product_id,quantity,status)
values
  ('6f200000-0000-4000-8000-0000000000f1','6f000000-0000-4000-8000-0000000000f2',
   '6f100000-0000-4000-8000-0000000000f1','11111111-1111-4111-8111-111111111111',1,'active'),
  ('6f200000-0000-4000-8000-0000000000f2','6f000000-0000-4000-8000-0000000000f2',
   '6f100000-0000-4000-8000-0000000000f2','22222222-2222-4222-8222-222222222222',1,'active');

-- Cada reserva deja su movimiento en el kardex, igual que lo hace create_order:
-- de ahí sale el efecto que la eliminación tiene que revertir.
insert into public.inventory_movements(
  id,product_id,movement_type,quantity,unit_cost,
  stock_on_hand_before,stock_on_hand_after,stock_reserved_before,stock_reserved_after,
  order_id,order_item_id,reservation_id,performed_by,notes
)
select '6f300000-0000-4000-8000-0000000000f1',p.id,'reservation',1,11000,
       p.stock_on_hand,p.stock_on_hand,p.stock_reserved,p.stock_reserved+1,
       '6f000000-0000-4000-8000-0000000000f2','6f100000-0000-4000-8000-0000000000f1',
       '6f200000-0000-4000-8000-0000000000f1','10000000-0000-4000-8000-000000000010',
       'Reserva de prueba'
from public.products p where p.id='11111111-1111-4111-8111-111111111111';

insert into public.inventory_movements(
  id,product_id,movement_type,quantity,unit_cost,
  stock_on_hand_before,stock_on_hand_after,stock_reserved_before,stock_reserved_after,
  order_id,order_item_id,reservation_id,performed_by,notes
)
select '6f300000-0000-4000-8000-0000000000f2',p.id,'reservation',1,11200,
       p.stock_on_hand,p.stock_on_hand,p.stock_reserved,p.stock_reserved+1,
       '6f000000-0000-4000-8000-0000000000f2','6f100000-0000-4000-8000-0000000000f2',
       '6f200000-0000-4000-8000-0000000000f2','10000000-0000-4000-8000-000000000010',
       'Reserva de prueba'
from public.products p where p.id='22222222-2222-4222-8222-222222222222';

-- Estado previo, para comparar después.
create temporary table t_before as
select
  (select stock_reserved from public.products where id='11111111-1111-4111-8111-111111111111') as reserved_1111,
  (select stock_reserved from public.products where id='22222222-2222-4222-8222-222222222222') as reserved_2222,
  (select count(*) from public.orders) as total_orders,
  (select nextval('public.order_number_seq')) as seq_value,
  (select status::text from public.orders where id='60000000-0000-4000-8000-000000000002') as other_status,
  (select total_amount from public.orders where id='60000000-0000-4000-8000-000000000002') as other_total,
  (select updated_at from public.orders where id='60000000-0000-4000-8000-000000000002') as other_updated,
  (select count(*) from public.order_items where order_id='60000000-0000-4000-8000-000000000002') as other_items;

-- ---------------------------------------------------------------------------
-- Autorización
-- ---------------------------------------------------------------------------

-- 3. Un cliente (sesión sin perfil de staff) no puede eliminar.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"40000000-0000-4000-8000-000000000004"}',true);
select throws_ok(
  $$select public.delete_order_permanently('60000000-0000-4000-8000-000000000001','PED-DEMO-0001')$$,
  '42501','NOT_AUTHORIZED: Solo un superadministrador puede eliminar pedidos definitivamente',
  '3. un cliente autenticado no puede eliminar un pedido'
);

-- 2. Un administrador sin el rol requerido no puede eliminar.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"10000000-0000-4000-8000-0000000000a1"}',true);
select ok(
  public.has_role('admin') and not public.has_role('superadmin'),
  '2a. el fixture es admin pero no superadmin'
);
select throws_ok(
  $$select public.delete_order_permanently('60000000-0000-4000-8000-000000000001','PED-DEMO-0001')$$,
  '42501','NOT_AUTHORIZED: Solo un superadministrador puede eliminar pedidos definitivamente',
  '2b. un administrador sin superadmin no puede eliminar un pedido'
);

-- Sin sesión no hay operación posible.
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok(
  $$select public.delete_order_permanently('60000000-0000-4000-8000-000000000001','PED-DEMO-0001')$$,
  '42501','NOT_AUTHENTICATED: Se requiere una sesión activa',
  'una llamada sin sesión se rechaza antes de cualquier lectura'
);

-- ---------------------------------------------------------------------------
-- Reglas de negocio (como superadministrador)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims','{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000010"}',true);
select ok(public.has_role('superadmin'), 'el actor de las pruebas es superadmin');

-- 6. Texto de confirmación incorrecto.
select throws_ok(
  $$select public.delete_order_permanently('60000000-0000-4000-8000-000000000001','PED-DEMO-0002')$$,
  '22023','CONFIRMATION_MISMATCH: El texto de confirmación no coincide con el número del pedido',
  '6a. un texto de confirmación que no coincide falla'
);
select throws_ok(
  $$select public.delete_order_permanently('60000000-0000-4000-8000-000000000001',null)$$,
  '22023','CONFIRMATION_MISMATCH: El texto de confirmación no coincide con el número del pedido',
  '6b. una confirmación nula falla'
);

-- 4/5. Entregado y pagado YA NO son motivo de rechazo.
select ok(public.order_is_purgeable('60000000-0000-4000-8000-000000000001'),
  '4a. order_is_purgeable acepta el pedido Nuevo sin pago');
select ok(public.order_is_purgeable('60000000-0000-4000-8000-000000000002'),
  '4b. order_is_purgeable acepta un pedido Entregado con pago parcial');
select ok(public.order_is_purgeable('6f000000-0000-4000-8000-0000000000f1'),
  '5. order_is_purgeable acepta un pedido con saldo pagado');

-- El gasto contable sigue bloqueando.
select ok(not public.order_is_purgeable('6f000000-0000-4000-8000-0000000000f3'),
  'order_is_purgeable rechaza un pedido con gasto contable asociado');
select throws_ok(
  $$select public.delete_order_permanently('6f000000-0000-4000-8000-0000000000f3','PED-TEST-9003')$$,
  '22023','ORDER_HAS_EXPENSE: El pedido tiene un gasto contable asociado; elimínalo primero desde Gastos',
  'un pedido con gasto contable no se elimina y explica por qué'
);

-- Un pedido inexistente.
select throws_ok(
  $$select public.delete_order_permanently('00000000-0000-4000-8000-00000000dead','PED-X')$$,
  'P0002','ORDER_NOT_FOUND: El pedido no existe',
  'un pedido inexistente devuelve ORDER_NOT_FOUND'
);

-- ---------------------------------------------------------------------------
-- 10. Atomicidad: fallo a mitad de la reversión de inventario
-- ---------------------------------------------------------------------------

-- Se deja stock_reserved del segundo producto por debajo de su reserva, así que
-- la primera reversión tendrá éxito y la segunda abortará.
select set_config('app.inventory_write','transactional_api',true);
update public.products set stock_reserved = 0
where id='22222222-2222-4222-8222-222222222222';
select set_config('app.inventory_write','',true);

create temporary table t_atomic as
select (select stock_reserved from public.products where id='11111111-1111-4111-8111-111111111111') as reserved_1111;

select throws_ok(
  $$select public.delete_order_permanently('6f000000-0000-4000-8000-0000000000f2','PED-TEST-9002')$$,
  '23514','INVENTORY_NOT_REVERSIBLE: Revertir el pedido dejaría el inventario en negativo',
  '10a. una reversión inconsistente aborta la operación'
);
select is(
  (select stock_reserved from public.products where id='11111111-1111-4111-8111-111111111111'),
  (select reserved_1111 from t_atomic),
  '10b. la reversión ya aplicada se revierte por completo (rollback atómico)'
);
select ok(
  exists (select 1 from public.orders where id='6f000000-0000-4000-8000-0000000000f2'),
  '10c. el pedido sigue existiendo tras el fallo'
);
select is(
  (select count(*) from public.order_items where order_id='6f000000-0000-4000-8000-0000000000f2'),
  2::bigint,
  '10d. no se borró ninguna fila dependiente'
);

-- ---------------------------------------------------------------------------
-- 1. Eliminación exitosa de un pedido nuevo
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.delete_order_permanently('60000000-0000-4000-8000-000000000001','PED-DEMO-0001')$$,
  '1. un superadministrador elimina un pedido Nuevo y sin pago'
);

select ok(
  not exists (select 1 from public.orders where id='60000000-0000-4000-8000-000000000001'),
  '1b. el pedido desaparece de la tabla de pedidos (no queda como Cancelado)'
);

-- 8. Filas dependientes eliminadas.
select is((select count(*) from public.order_items
           where order_id='60000000-0000-4000-8000-000000000001'), 0::bigint,
  '8a. se eliminaron los items del pedido');
select is((select count(*) from public.order_status_history
           where order_id='60000000-0000-4000-8000-000000000001'), 0::bigint,
  '8b. se eliminó el historial de estados');
select is((select count(*) from public.inventory_reservations
           where order_id='60000000-0000-4000-8000-000000000001'), 0::bigint,
  '8c. se eliminaron las reservas de inventario');
select is((select count(*) from public.inventory_movements
           where order_id='60000000-0000-4000-8000-000000000001'), 0::bigint,
  '8d. se eliminaron los movimientos de inventario del pedido');

-- 7. Inventario liberado.
select is(
  (select stock_reserved from public.products where id='11111111-1111-4111-8111-111111111111'),
  (select reserved_1111 - 2 from t_before),
  '7. se liberó la reserva de inventario (stock_reserved vuelve a su valor previo)'
);

-- 9. Ningún otro pedido afectado.
select is((select status::text from public.orders where id='60000000-0000-4000-8000-000000000002'),
          (select other_status from t_before), '9a. el otro pedido conserva su estado');
select is((select total_amount from public.orders where id='60000000-0000-4000-8000-000000000002'),
          (select other_total from t_before), '9b. el otro pedido conserva su total');
select is((select updated_at from public.orders where id='60000000-0000-4000-8000-000000000002'),
          (select other_updated from t_before), '9c. el otro pedido no fue tocado');
select is((select count(*) from public.order_items where order_id='60000000-0000-4000-8000-000000000002'),
          (select other_items from t_before), '9d. los items del otro pedido siguen intactos');

-- 6/auditoría: no sobrevive contenido comercial del pedido eliminado.
select is(
  (select count(*) from public.audit_logs
   where entity_name='orders' and record_id='60000000-0000-4000-8000-000000000001'),
  0::bigint,
  'la auditoría comercial del pedido eliminado no sobrevive'
);
select ok(
  exists (
    select 1 from public.audit_logs
    where action='ORDER_PURGED'
      and old_values is null and new_values is null and record_id is null
  ),
  'queda una huella técnica mínima, sin contenido del pedido'
);

-- 13. El consecutivo no se reutiliza.
select ok(
  (select nextval('public.order_number_seq')) > (select seq_value from t_before),
  '13. el consecutivo avanza; el número eliminado no se reutiliza'
);

-- ---------------------------------------------------------------------------
-- 14. Caso reportado: eliminar un pedido ENTREGADO y PAGADO
-- ---------------------------------------------------------------------------

create temporary table t_delivered as
select
  (select stock_on_hand from public.products where id='22222222-2222-4222-8222-222222222222') as on_hand_2222,
  (select stock_reserved from public.products where id='22222222-2222-4222-8222-222222222222') as reserved_2222,
  (select current_balance from public.cash_accounts where id='72000000-0000-4000-8000-000000000001') as caja,
  (select total_paid from public.customers where id='40000000-0000-4000-8000-000000000002') as total_paid;

select lives_ok(
  $$select public.delete_order_permanently('60000000-0000-4000-8000-000000000002','PED-DEMO-0002')$$,
  '14a. un pedido Entregado con pago aplicado sí se elimina'
);
select ok(
  not exists (select 1 from public.orders where id='60000000-0000-4000-8000-000000000002'),
  '14b. el pedido entregado desaparece de la tabla de pedidos'
);
select is(
  (select stock_on_hand from public.products where id='22222222-2222-4222-8222-222222222222'),
  (select on_hand_2222 + 2 from t_delivered),
  '14c. las 2 unidades vendidas vuelven a la existencia física'
);
select is(
  (select stock_reserved from public.products where id='22222222-2222-4222-8222-222222222222'),
  (select reserved_2222 from t_delivered),
  '14d. lo reservado no cambia: la reserva ya se había convertido en venta'
);
select is(
  (select count(*) from public.payments where order_id='60000000-0000-4000-8000-000000000002'),
  0::bigint,
  '14e. se eliminó el pago del pedido'
);
select is(
  (select count(*) from public.cash_movements where order_id='60000000-0000-4000-8000-000000000002'),
  0::bigint,
  '14f. se eliminó el movimiento de caja del pago'
);
select is(
  (select current_balance from public.cash_accounts where id='72000000-0000-4000-8000-000000000001'),
  (select caja - 20000 from t_delivered),
  '14g. la caja descuenta exactamente lo que ese pago había sumado'
);
select is(
  (select total_paid from public.customers where id='40000000-0000-4000-8000-000000000002'),
  (select total_paid - 20000 from t_delivered),
  '14h. lo pagado por el cliente se recalcula sin ese pedido'
);

select * from finish();
rollback;
