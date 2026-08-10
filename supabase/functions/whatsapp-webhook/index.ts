import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import {
  flattenInboundMessages,
  flattenStatusEvents,
  signatureIsValid,
  summarizeStatusEvent,
  verifyChallenge,
} from '../_shared/whatsapp-webhook.ts';

/**
 * Webhook de estado de WhatsApp Cloud API.
 *
 * Por qué existe: la API responde 200 con un `wamid` cuando ACEPTA el mensaje,
 * no cuando lo entrega. Un mensaje aceptado que nunca llega solo se explica por
 * los eventos `statuses` de este webhook, donde viene `failed` con su
 * `errors.code`. Sin esto no hay forma de distinguir «entregado» de
 * «aceptado y descartado por Meta».
 *
 * Este endpoint NO envía nada ni modifica el outbox: solo observa. El envío y
 * la plantilla siguen exactamente como estaban.
 *
 * Meta exige `verify_jwt = false` (ver supabase/config.toml): sus servidores no
 * mandan una sesión de Supabase. La autenticidad se comprueba con la firma
 * HMAC del App Secret, no con un JWT.
 */

const VERIFY_TOKEN = Deno.env.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
const APP_SECRET = Deno.env.get('WHATSAPP_APP_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

/** Nombre de la tabla opcional de bitácora. Si no existe, todo va a los logs. */
const EVENTS_TABLE = 'whatsapp_status_events';

/**
 * Guarda el evento si la tabla de bitácora existe.
 *
 * Es deliberadamente opcional: el diagnóstico funciona solo con los logs de la
 * Edge Function, y así el webhook se puede desplegar sin tocar el esquema. Si
 * la tabla no está, se registra el motivo una vez y se sigue.
 */
async function persist(rows: Record<string, unknown>[]): Promise<string> {
  if (!rows.length) return 'nothing_to_persist';
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return 'db_not_configured';
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.from(EVENTS_TABLE).insert(rows);
  if (!error) return 'persisted';
  // 42P01 = la tabla no existe todavía; es el caso esperado antes de aplicar
  // supabase/diagnostics/whatsapp_status_events.sql.
  if (error.code === '42P01' || error.code === 'PGRST205') return 'table_absent';
  console.error('whatsapp-webhook: no se pudo guardar el evento', { code: error.code });
  return 'persist_failed';
}

Deno.serve(async (request) => {
  const url = new URL(request.url);

  // --- Verificación de la URL (Meta la hace una sola vez, al guardarla) ------
  if (request.method === 'GET') {
    const outcome = verifyChallenge(
      {
        mode: url.searchParams.get('hub.mode'),
        token: url.searchParams.get('hub.verify_token'),
        challenge: url.searchParams.get('hub.challenge'),
      },
      VERIFY_TOKEN,
    );
    if (!outcome.ok) {
      console.warn('whatsapp-webhook: verificación rechazada', { reason: outcome.reason });
      return new Response('Forbidden', { status: 403 });
    }
    console.log('whatsapp-webhook: verificación aceptada');
    // Meta espera el challenge crudo, sin JSON y sin comillas.
    return new Response(outcome.challenge, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, POST' } });
  }

  // --- Eventos ---------------------------------------------------------------
  // El cuerpo se lee como TEXTO porque la firma se calcula sobre los bytes
  // exactos que mandó Meta; volver a serializar el JSON la invalidaría.
  const rawBody = await request.text();

  if (APP_SECRET) {
    const valid = await signatureIsValid(
      rawBody,
      request.headers.get('x-hub-signature-256'),
      APP_SECRET,
    );
    if (!valid) {
      console.warn('whatsapp-webhook: firma inválida; evento descartado');
      return new Response('Forbidden', { status: 403 });
    }
  } else {
    // Sin App Secret el endpoint acepta cualquier cuerpo. Sirve para arrancar
    // el diagnóstico, pero conviene configurarlo antes de dejarlo puesto.
    console.warn('whatsapp-webhook: WHATSAPP_APP_SECRET sin configurar; firma NO verificada');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error('whatsapp-webhook: cuerpo no era JSON');
    // 200 igualmente: un 4xx hace que Meta reintente y termine desactivando la
    // suscripción. Lo que no se pudo leer ya quedó registrado.
    return new Response('EVENT_RECEIVED', { status: 200 });
  }

  const statuses = flattenStatusEvents(payload);
  const inbound = flattenInboundMessages(payload);

  for (const event of statuses) {
    const summary = summarizeStatusEvent(event);
    // `failed` es exactamente el caso que se está diagnosticando: se registra
    // como error para que salte en los logs sin tener que filtrar.
    if (event.status === 'failed') console.error('whatsapp-webhook: ENVÍO FALLIDO', summary);
    else console.log('whatsapp-webhook: estado', summary);
  }
  for (const message of inbound) {
    console.log('whatsapp-webhook: mensaje entrante', {
      wamid: message.messageId,
      type: message.type,
      occurred_at: message.occurredAt,
      from_tail: message.from ? `***${message.from.slice(-4)}` : null,
    });
  }
  if (!statuses.length && !inbound.length) {
    console.log('whatsapp-webhook: evento sin statuses ni messages', {
      object: (payload as { object?: unknown })?.object ?? null,
    });
  }

  const persistence = await persist(
    statuses.map((event) => ({
      message_id: event.messageId,
      status: event.status,
      occurred_at: event.occurredAt,
      recipient_id: event.recipientId,
      phone_number_id: event.phoneNumberId,
      conversation_id: event.conversationId,
      error_code: event.errors[0]?.code ?? null,
      error_title: event.errors[0]?.title ?? null,
      error_message: event.errors[0]?.message ?? null,
      error_details: event.errors[0]?.details ?? null,
      payload: event,
    })),
  );

  console.log('whatsapp-webhook: procesado', {
    statuses: statuses.length,
    inbound: inbound.length,
    persistence,
  });

  // Meta solo necesita un 200 rápido. Si responde otra cosa, reintenta y puede
  // desactivar la suscripción.
  return new Response('EVENT_RECEIVED', { status: 200 });
});
