-- OPCIONAL — NO SE APLICA SOLO. Bitácora de estados de WhatsApp Cloud API.
--
-- Este archivo NO está en supabase/migrations/ a propósito: así `supabase db
-- push` no puede crearlo por accidente. Ejecútelo solo si decide conservar los
-- eventos en la base; el webhook ya diagnostica sin él, escribiendo a los logs
-- de la Edge Function.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ NO SE REUTILIZA notification_deliveries
-- ---------------------------------------------------------------------------
-- La tabla ya guarda el `wamid` en `external_id` y tiene un índice único por
-- (provider, external_id), así que unir un evento con su entrega es trivial.
-- Lo que NO puede hacer es guardar el estado que reporta Meta:
--
--   1. El enum `notification_status` no tiene `delivered` ni `read`; solo
--      pending, processing, sent, retrying, manual_required, failed y
--      cancelled. Agregar valores exige `alter type ... add value`, que en
--      PostgreSQL no se puede usar en la misma transacción en que se agrega,
--      y todas las migraciones de este proyecto corren dentro de begin/commit.
--
--   2. Escribir `status` desde el webhook chocaría con la máquina de estados
--      del outbox. `complete_notification_delivery` exige que la fila esté en
--      `processing` y falla con 55000 si no; y `retry_notification_delivery`
--      reencola cualquier fila en `failed` poniendo attempt_count = 0. Marcar
--      `failed` desde un callback haría que el botón de reintento del panel
--      reenviara un mensaje que Meta ya rechazó.
--
--   3. `provider_response` se SOBRESCRIBE en cada intento
--      (`provider_response = coalesce(p_provider_response, '{}')`), así que no
--      puede guardar una línea de tiempo sent -> delivered -> read.
--
-- De ahí que la opción mínima y segura sea una tabla aparte, solo de escritura
-- por el webhook, que no toca el enum, ni el outbox, ni el envío, ni la
-- plantilla. Si mañana se descarta, se borra sin afectar nada.

begin;

set search_path = public, pg_temp;

create table if not exists public.whatsapp_status_events (
  id uuid primary key default gen_random_uuid(),
  -- `wamid...`: la misma cadena que el worker guardó en
  -- notification_deliveries.external_id.
  message_id text not null,
  -- Texto libre, NO el enum notification_status: aquí se guarda lo que diga
  -- Meta (sent, delivered, read, failed, deleted) sin traducirlo.
  status text not null,
  occurred_at timestamptz,
  recipient_id text,
  phone_number_id text,
  conversation_id text,
  error_code integer,
  error_title text,
  error_message text,
  error_details text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

comment on table public.whatsapp_status_events is
  'Bitácora de solo escritura de los eventos de estado de WhatsApp Cloud API. Diagnóstico: explica por qué un mensaje aceptado por Meta (HTTP 200 + wamid) no llega. No participa en el outbox ni en el envío.';
comment on column public.whatsapp_status_events.message_id is
  'wamid. Se une con notification_deliveries.external_id.';
comment on column public.whatsapp_status_events.error_code is
  'Código de error de Meta. 131049 y 131026 son las causas típicas de un mensaje aceptado que nunca se entrega.';

create index if not exists whatsapp_status_events_message_idx
  on public.whatsapp_status_events(message_id, received_at desc);
create index if not exists whatsapp_status_events_failed_idx
  on public.whatsapp_status_events(received_at desc)
  where status = 'failed';

-- Meta reintenta un mismo evento cuando no recibe 200 a tiempo. Esto evita que
-- un reintento duplique la fila sin necesidad de lógica en la función.
create unique index if not exists whatsapp_status_events_uq
  on public.whatsapp_status_events(message_id, status, coalesce(occurred_at, 'epoch'::timestamptz));

-- Solo el service_role escribe (el webhook) y solo el personal lee. `anon` y
-- `authenticated` no tienen nada que hacer aquí: son datos de operación.
alter table public.whatsapp_status_events enable row level security;
revoke all on public.whatsapp_status_events from anon, authenticated;

drop policy if exists whatsapp_status_events_staff_read on public.whatsapp_status_events;
create policy whatsapp_status_events_staff_read
  on public.whatsapp_status_events
  for select
  to authenticated
  using (public.has_any_role(array['superadmin','admin']::text[]));

grant select on public.whatsapp_status_events to authenticated;

notify pgrst, 'reload schema';

commit;
