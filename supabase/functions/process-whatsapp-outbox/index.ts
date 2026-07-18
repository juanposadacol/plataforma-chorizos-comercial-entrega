import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { jsonResponse, readJson } from '../_shared/http.ts';

type ClaimedDelivery = {
  delivery_id: string;
  recipient: string;
  template_name: string | null;
  template_language: string | null;
  template_parameters: string[] | null;
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
  const size = Math.max(a.length, b.length);
  for (let index = 0; index < size; index += 1) {
    mismatch |= (a[index % Math.max(a.length, 1)] ?? 0) ^ (b[index % Math.max(b.length, 1)] ?? 0);
  }
  return mismatch === 0;
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function redactProviderResponse(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  if (Array.isArray(source.messages)) result.messages = source.messages;
  if (source.error && typeof source.error === 'object') {
    const error = source.error as Record<string, unknown>;
    result.error = {
      code: error.code,
      type: error.type,
      error_subcode: error.error_subcode,
      is_transient: error.is_transient,
      message: typeof error.message === 'string' ? error.message.slice(0, 500) : undefined,
    };
  }
  return result;
}

async function sendWhatsApp(delivery: ClaimedDelivery): Promise<SendResult> {
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const apiVersion = Deno.env.get('WHATSAPP_GRAPH_API_VERSION') ?? 'v23.0';
  const configuredTemplate = Deno.env.get('WHATSAPP_TEMPLATE_NAME');
  const templateName = delivery.template_name ?? configuredTemplate;
  const language =
    delivery.template_language ?? Deno.env.get('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'es_CO';

  if (!accessToken || !phoneNumberId || !templateName) {
    return {
      ok: false,
      retryable: false,
      externalId: null,
      response: { fallback: 'manual', reason: 'provider_not_configured' },
      error: 'WhatsApp automático no está configurado; se requiere envío manual.',
    };
  }

  const parameters = (delivery.template_parameters ?? []).map((text) => ({
    type: 'text',
    text: String(text).slice(0, 1024),
  }));
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: digits(delivery.recipient),
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      ...(parameters.length ? { components: [{ type: 'body', parameters }] } : {}),
    },
  };

  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${encodeURIComponent(apiVersion)}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      externalId: null,
      response: {},
      error: error instanceof Error ? error.message.slice(0, 500) : 'Error de red',
    };
  }

  let decoded: unknown = {};
  try {
    decoded = await response.json();
  } catch {
    decoded = { status: response.status };
  }
  const redacted = redactProviderResponse(decoded);
  const messages = (decoded as { messages?: Array<{ id?: string }> })?.messages;
  const externalId = messages?.[0]?.id ?? null;
  const providerError = (decoded as { error?: { message?: string; is_transient?: boolean } })
    ?.error;
  const retryable =
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500 ||
    providerError?.is_transient === true;

  return {
    ok: response.ok && Boolean(externalId),
    retryable,
    externalId,
    response: redacted,
    error: response.ok
      ? null
      : (providerError?.message?.slice(0, 500) ?? `HTTP ${response.status}`),
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
    p_channel: 'whatsapp',
    p_limit: limit,
    p_lease_seconds: 120,
  });
  if (error) {
    console.error('Unable to claim outbox deliveries', { code: error.code });
    return jsonResponse(request, 500, { error: { code: 'OUTBOX_CLAIM_FAILED' } });
  }

  const claimed = (data ?? []) as ClaimedDelivery[];
  const summary = { claimed: claimed.length, sent: 0, retrying: 0, manual: 0, failed: 0 };

  for (const delivery of claimed) {
    const result = await sendWhatsApp(delivery);
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
      console.error('Unable to complete delivery', { code: completionError.code });
      continue;
    }
    if (result.ok) summary.sent += 1;
    else if (result.response.fallback === 'manual') summary.manual += 1;
    else if (result.retryable) summary.retrying += 1;
    else summary.failed += 1;
  }

  return jsonResponse(request, 200, { data: summary });
});
