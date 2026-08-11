-- Persiste la normalizacion de observaciones para plantillas WhatsApp.

create or replace function public.fill_order_whatsapp_template_parameters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_notes text;
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

      v_notes := coalesce(
        nullif(
          btrim(
            regexp_replace(
              coalesce(v_order.customer_notes, ''),
              E'[\n\r\t]+',
              ' ',
              'g'
            )
          ),
          ''
        ),
        'Sin observaciones'
      );

      v_notes := regexp_replace(
        v_notes,
        E'\s+',
        ' ',
        'g'
      );

      new.template_parameters := jsonb_build_array(
        v_order.order_number,
        v_order.customer_name,
        coalesce(nullif(btrim(v_order.customer_phone), ''), 'No indicado'),
        to_char(v_order.total_amount, 'FM999999999990D00'),
        coalesce(nullif(btrim(v_order.delivery_address), ''), 'Por confirmar'),
        coalesce(to_char(v_order.requested_delivery_date, 'DD/MM/YYYY'), 'Por confirmar'),
        v_notes
      );
    end if;
  end if;

  return new;
end;
$$;
