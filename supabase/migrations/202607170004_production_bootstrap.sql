-- Required production reference data. This migration is not demo data and is safe with db push.
begin;
set search_path = public, pg_temp;

insert into public.roles(id,code,name,description,is_system,is_active) values
  ('10000000-0000-4000-8000-000000000001','superadmin','Superadministrador','Acceso total',true,true),
  ('10000000-0000-4000-8000-000000000002','admin','Administrador','Operación comercial',true,true),
  ('10000000-0000-4000-8000-000000000003','vendedor','Vendedor','Clientes y pedidos',true,true),
  ('10000000-0000-4000-8000-000000000004','bodega','Bodega','Inventario y logística',true,true),
  ('10000000-0000-4000-8000-000000000005','contabilidad','Contabilidad','Finanzas y reportes',true,true),
  ('10000000-0000-4000-8000-000000000006','customer','Cliente','Acceso a sus propios datos',true,true)
on conflict (id) do update set name=excluded.name,description=excluded.description,is_system=true,is_active=true,deleted_at=null;

insert into public.price_lists(
  id,code,name,description,is_public,is_active,valid_from,currency
) values (
  '21000000-0000-4000-8000-000000000001','publico','Público','Lista predeterminada para clientes nuevos',true,true,current_date,'COP'
) on conflict (id) do update set is_public=true,is_active=true,deleted_at=null;

insert into public.payment_methods(
  id,code,name,description,requires_reference,allows_credit,sort_order,is_active
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','efectivo','Efectivo','Pago en efectivo',false,false,1,true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','transferencia','Transferencia','Transferencia bancaria',true,false,2,true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','contraentrega','Contraentrega','Pago al recibir',false,false,3,true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','credito','Crédito','Sujeto a autorización administrativa',false,true,4,true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','otro','Otro','Método configurable',false,false,5,true)
on conflict (id) do update set name=excluded.name,description=excluded.description,is_active=true,deleted_at=null;

insert into public.delivery_methods(
  id,code,name,description,base_fee,requires_address,sort_order,is_active
) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','domicilio','Domicilio','Entrega en la dirección indicada',0,true,1,true),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','recoger','Recoger en el negocio','Sin costo de entrega',0,false,2,true)
on conflict (id) do update set name=excluded.name,description=excluded.description,is_active=true,deleted_at=null;

insert into public.app_settings(id,key,value,description,is_public,is_secret_reference) values
  ('83000000-0000-4000-8000-000000000001','business_name',to_jsonb('Chorizos Artesanales'::text),'Nombre público del negocio',true,false),
  ('83000000-0000-4000-8000-000000000003','currency',to_jsonb('COP'::text),'Moneda',true,false),
  ('83000000-0000-4000-8000-000000000004','timezone',to_jsonb('America/Bogota'::text),'Zona horaria',true,false),
  ('83000000-0000-4000-8000-000000000005','minimum_order',to_jsonb(0::numeric),'Pedido mínimo',true,false),
  ('83000000-0000-4000-8000-000000000006','volume_pricing_enabled','false'::jsonb,'Activa precios por cantidad',false,false)
on conflict (id) do nothing;

commit;
