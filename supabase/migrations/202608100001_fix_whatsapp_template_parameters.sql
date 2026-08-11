-- Corrige los parametros enviados a las plantillas de confirmacion de pedido.
-- confirmacion_pedido_v2 y v3 utilizan 7 variables en el cuerpo.

create or replace function public.fill_order_whatsapp_template_parameters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if new.channel = 'whatsapp'
     and new.template_name in ('confirmacion_pedido_v2', 'confirmacion_pedido_v3') then

    select o.*
      into v_order
      from public.notifications n
      join public.orders o
        on o.id = n.order_id
     where n.id = new.notification_id;

    if v_order.id is not null then
      new.template_parameters := jsonb_build_array(
        v_order.order_number,
        v_order.customer_name,
        coalesce(nullif(btrim(v_order.customer_phone), ''), 'No indicado'),
        to_char(v_order.total_amount, 'FM999999999990D00'),
        coalesce(nullif(btrim(v_order.delivery_address), ''), 'Por confirmar'),
        coalesce(to_char(v_order.requested_delivery_date, 'DD/MM/YYYY'), 'Por confirmar'),
        coalesce(nullif(btrim(v_order.customer_notes), ''), 'Sin observaciones')
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_whatsapp_template_parameters
on public.notification_deliveries;

create trigger trg_order_whatsapp_template_parameters
before insert on public.notification_deliveries
for each row
execute function public.fill_order_whatsapp_template_parameters();

-- Corrige entregas existentes que aun no hayan sido enviadas.
update public.notification_deliveries nd
set template_parameters = jsonb_build_array(
      o.order_number,
      o.customer_name,
      coalesce(nullif(btrim(o.customer_phone), ''), 'No indicado'),
      to_char(o.total_amount, 'FM999999999990D00'),
      coalesce(nullif(btrim(o.delivery_address), ''), 'Por confirmar'),
      coalesce(to_char(o.requested_delivery_date, 'DD/MM/YYYY'), 'Por confirmar'),
      coalesce(nullif(btrim(o.customer_notes), ''), 'Sin observaciones')
    )
from public.notifications n
join public.orders o
  on o.id = n.order_id
where nd.notification_id = n.id
  and nd.channel = 'whatsapp'
  and nd.template_name in ('confirmacion_pedido_v2', 'confirmacion_pedido_v3')
  and nd.status <> 'sent';
