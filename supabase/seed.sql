-- DEMO SEED ONLY. UUIDs are deterministic for repeatable local tests.
-- The demo administrator has a random, unrecoverable password; reset it through Supabase Auth.
begin;
set search_path = public, extensions, pg_temp;

insert into public.roles(id, code, name, description, is_system) values
  ('10000000-0000-4000-8000-000000000001','superadmin','Superadministrador','[DEMO] Acceso total',true),
  ('10000000-0000-4000-8000-000000000002','admin','Administrador','[DEMO] Operación comercial',true),
  ('10000000-0000-4000-8000-000000000003','vendedor','Vendedor','[DEMO] Clientes y pedidos',true),
  ('10000000-0000-4000-8000-000000000004','bodega','Bodega','[DEMO] Inventario y logística',true),
  ('10000000-0000-4000-8000-000000000005','contabilidad','Contabilidad','[DEMO] Finanzas y reportes',true)
on conflict (id) do nothing;

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,email_change,email_change_token_new,recovery_token
) values (
  '00000000-0000-0000-0000-000000000000','10000000-0000-4000-8000-000000000010',
  'authenticated','authenticated','admin.demo@chorizos.invalid',
  extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Administrador Demo"}'::jsonb,now(),now(),'','','',''
) on conflict (id) do nothing;

insert into public.profiles(id,full_name,email,is_active) values
  ('10000000-0000-4000-8000-000000000010','Administrador Demo','admin.demo@chorizos.invalid',true)
on conflict (id) do nothing;
insert into public.user_roles(profile_id,role_id,assigned_by) values
  ('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000001',null)
on conflict do nothing;

insert into public.categories(id,name,slug,description,sort_order) values
  ('20000000-0000-4000-8000-000000000001','Chorizos artesanales','chorizos-artesanales','[DEMO] Línea artesanal',1)
on conflict (id) do nothing;
insert into public.brands(id,name,slug,description) values
  ('20000000-0000-4000-8000-000000000002','Chorizos Artesanales','chorizos-artesanales','[DEMO] Marca original')
on conflict (id) do nothing;

insert into public.price_lists(id,code,name,description,is_public,is_active,valid_from) values
  ('21000000-0000-4000-8000-000000000001','publico','Público','[DEMO] Lista predeterminada',true,true,current_date-365),
  ('21000000-0000-4000-8000-000000000002','minorista','Minorista','[DEMO]',false,true,current_date-365),
  ('21000000-0000-4000-8000-000000000003','mayorista','Mayorista','[DEMO]',false,true,current_date-365),
  ('21000000-0000-4000-8000-000000000004','distribuidor','Distribuidor','[DEMO]',false,true,current_date-365),
  ('21000000-0000-4000-8000-000000000005','institucional','Institucional','[DEMO]',false,true,current_date-365),
  ('21000000-0000-4000-8000-000000000006','especial','Especial','[DEMO] Acuerdos administrados por cliente',false,true,current_date-365)
on conflict (id) do nothing;

insert into public.products(
  id,sku,name,slug,short_description,description,category_id,brand_id,main_image_url,
  public_price,current_cost,average_cost,unit,presentation,stock_on_hand,stock_reserved,
  minimum_stock,track_inventory,allow_backorder,status,is_featured,sort_order
) values
  ('11111111-1111-4111-8111-111111111111','CHO-SR-500','Santa Rosano','santa-rosano','Receta artesanal tradicional.','[DEMO] Producto original.','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','/assets/santa-rosano.png',17300,11000,11000,'paquete','500 g · 4 unidades',40,2,8,true,false,'active',true,1),
  ('22222222-2222-4222-8222-222222222222','CHO-AR-500','Argentino','argentino','Perfil especiado de inspiración argentina.','[DEMO] Producto original.','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','/assets/argentino.png',17300,11200,11200,'paquete','500 g · 4 unidades',38,0,8,true,false,'active',true,2),
  ('33333333-3333-4333-8333-333333333333','CHO-JA-500','Jalapeño','jalapeno','Picante equilibrado con especias naturales.','[DEMO] Producto original.','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','/assets/jalapeno.png',17300,11500,11500,'paquete','500 g · 4 unidades',40,0,8,true,false,'active',true,3)
on conflict (id) do nothing;

insert into public.product_images(id,product_id,storage_path,public_url,alt_text,is_primary) values
  ('22000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','products/santa-rosano.png','/assets/santa-rosano.png','Santa Rosano',true),
  ('22000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','products/argentino.png','/assets/argentino.png','Argentino',true),
  ('22000000-0000-4000-8000-000000000003','33333333-3333-4333-8333-333333333333','products/jalapeno.png','/assets/jalapeno.png','Jalapeño',true)
on conflict (id) do nothing;

insert into public.product_prices(id,price_list_id,product_id,unit_price,valid_from,notes)
select ids.price_id, ids.list_id, p.id, ids.price, current_date-365, '[DEMO] Precio inicial'
from public.products p
cross join (values
  ('23000000-0000-4000-8000-000000000001'::uuid,'21000000-0000-4000-8000-000000000001'::uuid,17300::numeric),
  ('23000000-0000-4000-8000-000000000002'::uuid,'21000000-0000-4000-8000-000000000002'::uuid,17000::numeric),
  ('23000000-0000-4000-8000-000000000003'::uuid,'21000000-0000-4000-8000-000000000003'::uuid,16000::numeric),
  ('23000000-0000-4000-8000-000000000004'::uuid,'21000000-0000-4000-8000-000000000004'::uuid,15000::numeric),
  ('23000000-0000-4000-8000-000000000005'::uuid,'21000000-0000-4000-8000-000000000005'::uuid,15800::numeric)
) ids(price_id,list_id,price)
where p.id = '11111111-1111-4111-8111-111111111111'
on conflict (id) do nothing;

-- Additional product/list combinations use deterministic IDs.
insert into public.product_prices(id,price_list_id,product_id,unit_price,valid_from,notes) values
  ('23100000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222',17300,current_date-365,'[DEMO]'),
  ('23100000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222',17000,current_date-365,'[DEMO]'),
  ('23100000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222',16000,current_date-365,'[DEMO]'),
  ('23100000-0000-4000-8000-000000000004','21000000-0000-4000-8000-000000000004','22222222-2222-4222-8222-222222222222',15000,current_date-365,'[DEMO]'),
  ('23100000-0000-4000-8000-000000000005','21000000-0000-4000-8000-000000000005','22222222-2222-4222-8222-222222222222',15800,current_date-365,'[DEMO]'),
  ('23200000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','33333333-3333-4333-8333-333333333333',17300,current_date-365,'[DEMO]'),
  ('23200000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002','33333333-3333-4333-8333-333333333333',17000,current_date-365,'[DEMO]'),
  ('23200000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000003','33333333-3333-4333-8333-333333333333',16000,current_date-365,'[DEMO]'),
  ('23200000-0000-4000-8000-000000000004','21000000-0000-4000-8000-000000000004','33333333-3333-4333-8333-333333333333',15000,current_date-365,'[DEMO]'),
  ('23200000-0000-4000-8000-000000000005','21000000-0000-4000-8000-000000000005','33333333-3333-4333-8333-333333333333',15800,current_date-365,'[DEMO]')
on conflict (id) do nothing;

insert into public.quantity_price_tiers(id,price_list_id,product_id,minimum_quantity,maximum_quantity,unit_price,valid_from) values
  ('24000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',10,19,16500,current_date-365),
  ('24000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',20,null,15500,current_date-365)
on conflict (id) do nothing;

insert into public.customers(
  id,full_name,phone,whatsapp_phone,email,price_list_id,payment_terms,credit_limit,credit_days,
  outstanding_balance,status,classification,last_purchase_at,order_count,total_purchased,total_paid,average_ticket,notes
) values
  ('40000000-0000-4000-8000-000000000001','Cliente Público Demo','573001111111','573001111111','publico@demo.invalid','21000000-0000-4000-8000-000000000001','cash',0,0,0,'active','public',null,0,0,0,0,'[DEMO] Cliente público'),
  ('40000000-0000-4000-8000-000000000002','Mayorista Demo','573002222222','573002222222','mayorista@demo.invalid','21000000-0000-4000-8000-000000000003','credit',1000000,15,17000,'active','wholesale',now()-interval '2 days',1,32000,20000,32000,'[DEMO] Cliente mayorista'),
  ('40000000-0000-4000-8000-000000000003','Distribuidor Demo','573003333333','573003333333','distribuidor@demo.invalid','21000000-0000-4000-8000-000000000004','credit',3000000,30,0,'active','distributor',null,0,0,0,0,'[DEMO] Cliente distribuidor'),
  ('40000000-0000-4000-8000-000000000004','Acuerdo Especial Demo','573004444444','573004444444','especial@demo.invalid','21000000-0000-4000-8000-000000000001','cash',0,0,0,'active','vip',null,0,0,0,0,'[DEMO] Cliente con precio especial')
on conflict (id) do nothing;

insert into public.customer_addresses(id,customer_id,label,address_line,neighborhood,municipality,is_primary) values
  ('41000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Principal','Calle 10 # 20-30','Centro','Pasto',true),
  ('41000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','Bodega','Carrera 5 # 8-20','Industrial','Pasto',true),
  ('41000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000004','Principal','Calle 15 # 12-05','La Aurora','Pasto',true)
on conflict (id) do nothing;

insert into public.customer_product_prices(
  id,customer_id,product_id,unit_price,valid_from,is_active,notes,created_by
) values (
  '42000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004',
  '11111111-1111-4111-8111-111111111111',14800,current_date-365,true,'[DEMO] Acuerdo especial',
  '10000000-0000-4000-8000-000000000010'
) on conflict (id) do nothing;

insert into public.payment_methods(id,code,name,description,requires_reference,allows_credit,sort_order) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','efectivo','Efectivo','Pago en efectivo',false,false,1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','transferencia','Transferencia','Transferencia bancaria',true,false,2),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','contraentrega','Contraentrega','Pago al recibir',false,false,3),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','credito','Crédito','Crédito autorizado',false,true,4),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','otro','Otro','Método configurable',false,false,5)
on conflict (id) do nothing;
insert into public.delivery_methods(id,code,name,description,base_fee,free_from_amount,requires_address,sort_order) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','domicilio','Domicilio','Entrega en dirección registrada',5000,150000,true,1),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','recoger','Recoger en el negocio','Sin costo',0,null,false,2)
on conflict (id) do update set
  name=excluded.name,description=excluded.description,base_fee=excluded.base_fee,
  free_from_amount=excluded.free_from_amount,requires_address=excluded.requires_address,is_active=true,deleted_at=null;

insert into public.suppliers(
  id,name,document_type,document_number,contact_name,phone,email,address,payment_terms,credit_days,outstanding_balance,notes
) values (
  '50000000-0000-4000-8000-000000000001','Proveedor Cárnico Demo','NIT','900000001-1','Contacto Demo','573005555555',
  'proveedor@demo.invalid','Zona Industrial','credit',30,374000,'[DEMO] Proveedor'
) on conflict (id) do nothing;

insert into public.purchases(
  id,purchase_number,supplier_id,purchase_date,invoice_number,status,subtotal_amount,discount_amount,tax_amount,
  total_amount,paid_amount,balance_amount,due_date,notes,received_at,received_by,created_by
) values (
  '51000000-0000-4000-8000-000000000001','COM-DEMO-0001','50000000-0000-4000-8000-000000000001',
  current_date-10,'FAC-DEMO-001','received',674000,0,0,674000,300000,374000,current_date+20,
  '[DEMO] Compra recibida',now()-interval '10 days','10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000010'
) on conflict (id) do nothing;
insert into public.purchase_items(
  id,purchase_id,product_id,sku,product_name,quantity,received_quantity,unit_cost,subtotal_amount,discount_amount,tax_amount,total_amount
) values
  ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','CHO-SR-500','Santa Rosano',20,20,11000,220000,0,0,220000),
  ('52000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','CHO-AR-500','Argentino',20,20,11200,224000,0,0,224000),
  ('52000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000001','33333333-3333-4333-8333-333333333333','CHO-JA-500','Jalapeño',20,20,11500,230000,0,0,230000)
on conflict (id) do nothing;
insert into public.accounts_payable(
  id,supplier_id,purchase_id,original_amount,paid_amount,balance_amount,due_date,status,notes,created_by
) values (
  '53000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001',
  674000,300000,374000,current_date+20,'partial','[DEMO] Saldo de compra','10000000-0000-4000-8000-000000000010'
) on conflict (id) do nothing;

insert into public.orders(
  id,order_number,idempotency_key,customer_id,customer_name,customer_phone,customer_address_id,delivery_address,
  neighborhood,municipality,delivery_method_id,delivery_method_name,payment_method_id,payment_method_name,
  requested_delivery_date,channel,status,payment_status,subtotal_amount,discount_amount,delivery_amount,tax_amount,total_amount,
  amount_paid,sales_cost,gross_profit,customer_notes,created_by,delivered_by,delivered_at,created_at
) values
  ('60000000-0000-4000-8000-000000000001','PED-DEMO-0001','60000000-0000-4000-8000-000000000011','40000000-0000-4000-8000-000000000004','Acuerdo Especial Demo','573004444444','41000000-0000-4000-8000-000000000003','Calle 15 # 12-05','La Aurora','Pasto','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Domicilio','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Efectivo',current_date+1,'web','new','pending',29600,0,5000,0,34600,0,22000,7600,'[DEMO] Sin cebolla','10000000-0000-4000-8000-000000000010',null,null,now()-interval '1 hour'),
  ('60000000-0000-4000-8000-000000000002','PED-DEMO-0002','60000000-0000-4000-8000-000000000012','40000000-0000-4000-8000-000000000002','Mayorista Demo','573002222222','41000000-0000-4000-8000-000000000002','Carrera 5 # 8-20','Industrial','Pasto','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Domicilio','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','Crédito',current_date-2,'phone','delivered','partial',32000,0,5000,0,37000,20000,22400,9600,'[DEMO] Entregado','10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000010',now()-interval '2 days',now()-interval '3 days')
on conflict (id) do nothing;

insert into public.order_items(
  id,order_id,product_id,sku,product_name,image_url,unit,quantity,unit_price,public_unit_price,
  subtotal_amount,discount_amount,total_amount,unit_cost,total_cost,gross_profit,price_source,price_list_id,price_list_name,customer_product_price_id
) values
  ('61000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','CHO-SR-500','Santa Rosano','/assets/santa-rosano.png','paquete',2,14800,17300,29600,0,29600,11000,22000,7600,'customer_special','21000000-0000-4000-8000-000000000001','Público','42000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','CHO-AR-500','Argentino','/assets/argentino.png','paquete',2,16000,17300,32000,0,32000,11200,22400,9600,'price_list','21000000-0000-4000-8000-000000000003','Mayorista',null)
on conflict (id) do nothing;
insert into public.order_status_history(id,order_id,previous_status,new_status,changed_by,notes,created_at) values
  ('62000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',null,'new','10000000-0000-4000-8000-000000000010','[DEMO] Pedido creado',now()-interval '1 hour'),
  ('62000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002',null,'new','10000000-0000-4000-8000-000000000010','[DEMO] Pedido creado',now()-interval '3 days'),
  ('62000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000002','new','confirmed','10000000-0000-4000-8000-000000000010','[DEMO] Confirmado',now()-interval '2 days 20 hours'),
  ('62000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000002','confirmed','delivered','10000000-0000-4000-8000-000000000010','[DEMO] Entregado',now()-interval '2 days')
on conflict (id) do nothing;

insert into public.inventory_reservations(
  id,order_id,order_item_id,product_id,quantity,status,fulfilled_at,created_by
) values
  ('63000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',2,'active',null,'10000000-0000-4000-8000-000000000010'),
  ('63000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222',2,'fulfilled',now()-interval '2 days','10000000-0000-4000-8000-000000000010')
on conflict (id) do nothing;

insert into public.inventory_movements(
  id,product_id,movement_type,quantity,unit_cost,stock_on_hand_before,stock_on_hand_after,
  stock_reserved_before,stock_reserved_after,order_id,order_item_id,purchase_id,purchase_item_id,reservation_id,performed_by,notes,occurred_at
) values
  ('64000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','initial',20,11000,0,20,0,0,null,null,null,null,null,'10000000-0000-4000-8000-000000000010','[DEMO] Inventario inicial',now()-interval '20 days'),
  ('64000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','initial',20,11200,0,20,0,0,null,null,null,null,null,'10000000-0000-4000-8000-000000000010','[DEMO] Inventario inicial',now()-interval '20 days'),
  ('64000000-0000-4000-8000-000000000003','33333333-3333-4333-8333-333333333333','initial',20,11500,0,20,0,0,null,null,null,null,null,'10000000-0000-4000-8000-000000000010','[DEMO] Inventario inicial',now()-interval '20 days'),
  ('64000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','purchase',20,11000,20,40,0,0,null,null,'51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001',null,'10000000-0000-4000-8000-000000000010','[DEMO] Compra',now()-interval '10 days'),
  ('64000000-0000-4000-8000-000000000012','22222222-2222-4222-8222-222222222222','purchase',20,11200,20,40,0,0,null,null,'51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000002',null,'10000000-0000-4000-8000-000000000010','[DEMO] Compra',now()-interval '10 days'),
  ('64000000-0000-4000-8000-000000000013','33333333-3333-4333-8333-333333333333','purchase',20,11500,20,40,0,0,null,null,'51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000003',null,'10000000-0000-4000-8000-000000000010','[DEMO] Compra',now()-interval '10 days'),
  ('64000000-0000-4000-8000-000000000021','11111111-1111-4111-8111-111111111111','reservation',2,11000,40,40,0,2,'60000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',null,null,'63000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000010','[DEMO] Reserva activa',now()-interval '1 hour'),
  ('64000000-0000-4000-8000-000000000022','22222222-2222-4222-8222-222222222222','reservation',2,11200,40,40,0,2,'60000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002',null,null,'63000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000010','[DEMO] Reserva',now()-interval '3 days'),
  ('64000000-0000-4000-8000-000000000023','22222222-2222-4222-8222-222222222222','sale',2,11200,40,38,2,0,'60000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002',null,null,'63000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000010','[DEMO] Venta entregada',now()-interval '2 days')
on conflict (id) do nothing;

insert into public.payments(
  id,idempotency_key,order_id,customer_id,paid_at,amount,payment_method_id,payment_method_name,
  reference,status,notes,recorded_by,verified_by,verified_at
) values (
  '65000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000002',now()-interval '2 days',20000,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'Transferencia','TRX-DEMO-001','approved','[DEMO] Pago parcial','10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000010',now()-interval '2 days'
) on conflict (id) do nothing;
insert into public.accounts_receivable(
  id,customer_id,order_id,original_amount,paid_amount,balance_amount,due_date,status,notes,created_by
) values (
  '66000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002',
  37000,20000,17000,current_date+13,'partial','[DEMO] Saldo de pedido','10000000-0000-4000-8000-000000000010'
) on conflict (id) do nothing;

insert into public.expense_categories(id,code,name,is_operating_expense) values
  ('70000000-0000-4000-8000-000000000001','domicilios','Domicilios',true),
  ('70000000-0000-4000-8000-000000000002','transporte','Transporte',true),
  ('70000000-0000-4000-8000-000000000003','empaques','Empaques',true),
  ('70000000-0000-4000-8000-000000000004','publicidad','Publicidad',true),
  ('70000000-0000-4000-8000-000000000005','arriendo','Arriendo',true),
  ('70000000-0000-4000-8000-000000000006','servicios','Servicios',true),
  ('70000000-0000-4000-8000-000000000007','nomina','Nómina',true),
  ('70000000-0000-4000-8000-000000000008','comisiones','Comisiones',true),
  ('70000000-0000-4000-8000-000000000009','mantenimiento','Mantenimiento',true),
  ('70000000-0000-4000-8000-000000000010','impuestos','Impuestos',true),
  ('70000000-0000-4000-8000-000000000011','otros','Otros',true)
on conflict (id) do nothing;
insert into public.expenses(
  id,expense_date,category_id,description,beneficiary,amount,payment_method_id,payment_method_name,
  status,notes,created_by,approved_by,approved_at
) values (
  '71000000-0000-4000-8000-000000000001',current_date-1,'70000000-0000-4000-8000-000000000002',
  '[DEMO] Transporte semanal','Transportador Demo',85000,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Efectivo',
  'posted','[DEMO] Gasto operativo','10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000010',now()-interval '1 day'
) on conflict (id) do nothing;

insert into public.cash_accounts(id,code,name,account_type,opening_balance,current_balance,created_by) values
  ('72000000-0000-4000-8000-000000000001','caja','Caja principal','cash',500000,435000,'10000000-0000-4000-8000-000000000010'),
  ('72000000-0000-4000-8000-000000000002','banco','Banco demo','bank',1000000,700000,'10000000-0000-4000-8000-000000000010')
on conflict (id) do nothing;
insert into public.cash_movements(
  id,cash_account_id,movement_type,amount,balance_before,balance_after,occurred_at,description,reference,
  order_id,payment_id,purchase_id,expense_id,performed_by
) values
  ('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','income',20000,500000,520000,now()-interval '2 days','[DEMO] Pago parcial','TRX-DEMO-001','60000000-0000-4000-8000-000000000002','65000000-0000-4000-8000-000000000001',null,null,'10000000-0000-4000-8000-000000000010'),
  ('73000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','expense',85000,520000,435000,now()-interval '1 day','[DEMO] Gasto transporte',null,null,null,null,'71000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000010'),
  ('73000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000002','expense',300000,1000000,700000,now()-interval '10 days','[DEMO] Abono compra','FAC-DEMO-001',null,null,'51000000-0000-4000-8000-000000000001',null,'10000000-0000-4000-8000-000000000010')
on conflict (id) do nothing;

insert into public.notifications(id,event_type,title,body,payload,order_id,customer_id,created_at) values
  ('80000000-0000-4000-8000-000000000001','order.created','Nuevo pedido PED-DEMO-0001','[DEMO] Pedido pendiente de confirmar','{"demo":true}'::jsonb,'60000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004',now()-interval '1 hour')
on conflict (id) do nothing;
insert into public.notification_deliveries(
  id,notification_id,channel,status,recipient,provider,template_name,template_language,template_parameters,
  message_text,manual_url,attempt_count,max_attempts,next_attempt_at
) values (
  '81000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','whatsapp','manual_required',
  '573001234567','manual','nuevo_pedido_admin','es_CO','["PED-DEMO-0001","Acuerdo Especial Demo","34600"]'::jsonb,
  '[DEMO] Nuevo pedido PED-DEMO-0001','https://wa.me/573001234567?text=Pedido%20PED-DEMO-0001',0,5,now()
) on conflict (id) do nothing;

insert into public.whatsapp_settings(
  id,name,provider,business_phone,administrator_phone,administrator_template_name,template_language,
  fallback_manual_enabled,automatic_enabled,is_active
) values (
  '82000000-0000-4000-8000-000000000001','[DEMO] Principal','manual','573001234567','573001234567',
  'nuevo_pedido_admin','es_CO',true,false,true
) on conflict (id) do nothing;

insert into public.app_settings(id,key,value,description,is_public,is_secret_reference) values
  ('83000000-0000-4000-8000-000000000001','business_name',to_jsonb('Chorizos Artesanales'::text),'[DEMO] Nombre del negocio',true,false),
  ('83000000-0000-4000-8000-000000000002','business_whatsapp',to_jsonb('573001234567'::text),'[DEMO] WhatsApp público',true,false),
  ('83000000-0000-4000-8000-000000000003','currency',to_jsonb('COP'::text),'Moneda',true,false),
  ('83000000-0000-4000-8000-000000000004','timezone',to_jsonb('America/Bogota'::text),'Zona horaria',true,false),
  ('83000000-0000-4000-8000-000000000005','minimum_order',to_jsonb(0::numeric),'Pedido mínimo',true,false),
  ('83000000-0000-4000-8000-000000000006','volume_pricing_enabled','false'::jsonb,'Tramos por volumen preparados pero desactivados',false,false),
  ('83000000-0000-4000-8000-000000000007','admin_base_url',to_jsonb('http://localhost:5173'::text),'[DEMO] Base del panel',false,false),
  ('83000000-0000-4000-8000-000000000008','privacy_policy',to_jsonb('Datos usados únicamente para gestionar pedidos.'::text),'[DEMO]',true,false),
  ('83000000-0000-4000-8000-000000000009','terms',to_jsonb('Pedido sujeto a confirmación de disponibilidad.'::text),'[DEMO]',true,false)
on conflict (id) do nothing;

commit;
