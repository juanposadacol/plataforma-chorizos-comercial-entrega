import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { jsonResponse, readJson } from '../_shared/http.ts';
import {
  appsScriptRequestBody,
  classifyAppsScriptOutcome,
  normalizeOrderEmailPayload,
  type OrderEmailPayload,
} from '../_shared/order-email.ts';

/**
 * Worker del outbox de correo. Mismo patrón que `process-whatsapp-outbox`: el
 * pedido ya está confirmado y guardado cuando esto corre, así que un fallo de
 * Gmail o de Apps Script solo deja el envío pendiente de reintento — nunca
 * revierte ni ensucia la compra.
 *
 * El envío real lo hace un Web App de Google Apps Script con la cuenta de Gmail
 * del negocio. Su URL y su secreto viven como secretos de la Edge Function y
 * jamás llegan al navegador.
 */

type ClaimedDelivery = {
  delivery_id: string;
  recipient: string;
  message_text: string | null;
  attempt_count: number;
};

type SendResult = {
  ok: boolean;
  retryable: boolean;
  externalId: string | null;
  response: Record<string, unknown>;
  error: string | null;
};

function safeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let mismatch = a.length ^ b.length;
  const size = Math.max(a.length, b.length, 1);
  for (let index = 0; index < size; index += 1) {
    mismatch |= (a[index % Math.max(a.length, 1)] ?? 0) ^ (b[index % Math.max(b.length, 1)] ?? 0);
  }
  return mismatch === 0;
}

async function sendWithAppsScript(payload: OrderEmailPayload): Promise<SendResult> {
  const endpoint = Deno.env.get('APPS_SCRIPT_EMAIL_URL');
  const secret = Deno.env.get('APPS_SCRIPT_EMAIL_SECRET');
  if (!endpoint || !secret) {
    return {
      ok: false,
      retryable: false,
      externalId: null,
      response: { reason: 'provider_not_configured' },
      error: 'El envío de correo no está configurado (APPS_SCRIPT_EMAIL_URL/SECRET).',
    };
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      // Apps Script responde 302 hacia googleusercontent; `redirect: follow` es
      // el comportamiento por defecto y es el que devuelve el JSON final.
      headers: { 'content-type': 'application/json' },
      body: appsScriptRequestBody(payload, secret),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    // Red caída o timeout: se reintenta más tarde.
    return {
      ok: false,
      retryable: true,
      externalId: null,
      response: {},
      error: error instanceof Error ? error.message.slice(0, 500) : 'Error de red',
    };
  }

  let decoded: Record<string, unknown> = {};
  try {
    decoded = (await response.json()) as Record<string, unknown>;
  } catch {
    decoded = { status: response.status };
  }

  const outcome = classifyAppsScriptOutcome(response.status, decoded);
  return {
    ok: outcome.ok,
    retryable: outcome.retryable,
    externalId: outcome.externalId,
    response: {
      status: response.status,
      ok: decoded.ok === true,
      duplicated: outcome.duplicated,
      ...(typeof decoded.error === 'string' ? { error: decoded.error.slice(0, 300) } : {}),
    },
    error: outcome.ok ? null : `HTTP ${response.status}`,
  };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse(request, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }, { allow: 'POST' });
  }

  const expectedSecret = Deno.env.get('OUTBOX_WORKER_SECRET');
  const providedSecret = request.headers.get('x-outbox-secret') ?? '';
  if (!expectedSecret || !safeEqual(providedSecret, expectedSecret)) {
    return jsonResponse(request, 401, { error: { code: 'UNAUTHORIZED' } });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    return jsonResponse(request, 503, { error: { code: 'SERVER_NOT_CONFIGURED' } });
  }

  let limit = 10;
  try {
    const body = (await readJson(request, 4096)) as { limit?: unknown };
    if (typeof body.limit === 'number' && Number.isInteger(body.limit)) {
      limit = Math.max(1, Math.min(body.limit, 50));
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_JSON';
    return jsonResponse(request, code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { error: { code } });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc('claim_notification_deliveries', {
    p_channel: 'email',
    p_limit: limit,
    p_lease_seconds: 120,
  });
  if (error) {
    console.error('Unable to claim email deliveries', { code: error.code });
    return jsonResponse(request, 500, { error: { code: 'OUTBOX_CLAIM_FAILED' } });
  }

  const claimed = (data ?? []) as ClaimedDelivery[];
  const summary = { claimed: claimed.length, sent: 0, retrying: 0, failed: 0, skipped: 0 };
  const businessName = Deno.env.get('BUSINESS_NAME') ?? undefined;

  for (const delivery of claimed) {
    let result: SendResult;
    const { data: raw, error: payloadError } = await admin.rpc('build_order_email_payload', {
      p_delivery_id: delivery.delivery_id,
    });
    const payload = payloadError
      ? null
      : normalizeOrderEmailPayload(raw, {
          deliveryId: delivery.delivery_id,
          recipient: delivery.recipient,
          businessName,
        });

    if (!payload) {
      // Sin datos utilizables no hay nada que reintentar.
      summary.skipped += 1;
      result = {
        ok: false,
        retryable: false,
        externalId: null,
        response: { reason: 'payload_unavailable' },
        error: 'No fue posible construir el contenido del correo.',
      };
    } else {
      result = await sendWithAppsScript(payload);
    }

    const { error: completionError } = await admin.rpc('complete_notification_delivery', {
      p_delivery_id: delivery.delivery_id,
      p_succeeded: result.ok,
      p_external_id: result.externalId,
      p_provider_response: result.response,
      p_error: result.error,
      p_retryable: result.retryable,
    });
    if (completionError) {
      summary.failed += 1;
      console.error('Unable to complete email delivery', { code: completionError.code });
      continue;
    }
    if (result.ok) summary.sent += 1;
    else if (result.retryable) summary.retrying += 1;
    else if (!payload) summary.failed += 0;
    else summary.failed += 1;
  }

  return jsonResponse(request, 200, { data: summary });
});
