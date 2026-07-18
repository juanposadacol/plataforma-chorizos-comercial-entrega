import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { createOrderSchema } from '../_shared/order-schema.ts';
import {
  bearerToken,
  clientAddress,
  corsHeaders,
  isAllowedOrigin,
  jsonResponse,
  readJson,
} from '../_shared/http.ts';

const url = Deno.env.get('SUPABASE_URL');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

function publicError(error: unknown): { status: number; code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw === 'PAYLOAD_TOO_LARGE') {
    return { status: 413, code: raw, message: 'La solicitud supera el tamaño permitido.' };
  }
  if (raw === 'INVALID_JSON') {
    return { status: 400, code: raw, message: 'El cuerpo JSON no es válido.' };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'No fue posible crear el pedido.' };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') {
    return jsonResponse(request, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }, { allow: 'POST' });
  }
  if (!isAllowedOrigin(request)) {
    return jsonResponse(request, 403, { error: { code: 'ORIGIN_NOT_ALLOWED' } });
  }
  if (!url || !anonKey || !serviceRoleKey) {
    return jsonResponse(request, 503, {
      error: { code: 'SERVER_NOT_CONFIGURED', message: 'Servicio no configurado.' },
    });
  }

  try {
    const body = await readJson(request);
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse(request, 422, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Revisa los datos del pedido.',
          fields: parsed.error.flatten().fieldErrors,
        },
      });
    }

    const idempotencyKey = request.headers.get('x-idempotency-key') ?? parsed.data.idempotency_key;
    if (
      !idempotencyKey ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        idempotencyKey,
      )
    ) {
      return jsonResponse(request, 400, {
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Falta una clave de idempotencia UUID válida.',
        },
      });
    }

    let authUserId: string | null = null;
    let authPhone: string | null = null;
    const token = bearerToken(request);
    // supabase-js sends the anon key as Bearer when there is no user session.
    if (token && token !== anonKey) {
      const authClient = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await authClient.auth.getUser(token);
      if (error || !data.user) {
        return jsonResponse(request, 401, {
          error: { code: 'INVALID_SESSION', message: 'La sesión no es válida.' },
        });
      }
      authUserId = data.user.id;
      authPhone = data.user.phone ?? null;
    }

    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // The DB function serializes this bucket; no price or total from the browser is used.
    const address = clientAddress(request);
    const subject = authUserId ?? `${address}:${parsed.data.customer?.phone ?? 'guest'}`;
    const { data: allowed, error: rateError } = await admin.rpc('check_request_rate_limit', {
      p_bucket: 'create_order',
      p_subject: subject,
      p_max_requests: 12,
      p_window_seconds: 300,
    });
    if (rateError) throw rateError;
    if (!allowed) {
      return jsonResponse(
        request,
        429,
        { error: { code: 'RATE_LIMITED', message: 'Demasiados intentos. Intenta más tarde.' } },
        { 'retry-after': '300' },
      );
    }

    const { data, error } = await admin.rpc('create_order', {
      p_payload: { ...parsed.data, idempotency_key: undefined },
      p_idempotency_key: idempotencyKey,
      p_auth_user_id: authUserId,
      p_request_context: {
        ip: address,
        auth_phone: authPhone,
        user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
      },
    });
    if (error) {
      const known =
        /^(OUT_OF_STOCK|PRODUCT_NOT_AVAILABLE|CUSTOMER_NOT_AUTHORIZED|CUSTOMER_AUTH_REQUIRED|INVALID_DELIVERY_METHOD|INVALID_PAYMENT_METHOD|INVALID_REQUEST|DELIVERY_DATE_IN_PAST):/.exec(
          error.message,
        );
      if (known) {
        const status =
          known[1] === 'CUSTOMER_AUTH_REQUIRED'
            ? 401
            : known[1] === 'CUSTOMER_NOT_AUTHORIZED'
              ? 403
              : known[1] === 'OUT_OF_STOCK'
                ? 409
                : 422;
        return jsonResponse(request, status, {
          error: { code: known[1], message: error.message.split(':').slice(1).join(':').trim() },
        });
      }
      // Do not return Postgres internals or customer data.
      console.error('create_order RPC failed', { code: error.code, hint: error.hint });
      throw new Error('CREATE_ORDER_FAILED');
    }

    // Commit has already happened. Notification delivery is best-effort and cannot roll back the order.
    const workerSecret = Deno.env.get('OUTBOX_WORKER_SECRET');
    if (workerSecret) {
      const delivery = fetch(`${url}/functions/v1/process-whatsapp-outbox`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-outbox-secret': workerSecret,
        },
        body: JSON.stringify({ limit: 5 }),
      }).catch((error) => console.error('Outbox wake-up failed', error));
      // Supported by Supabase Edge Runtime; graceful fallback for local Deno.
      // deno-lint-ignore no-explicit-any
      const runtime = (globalThis as any).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(delivery);
    }

    return jsonResponse(request, 201, data);
  } catch (error) {
    const mapped = publicError(error);
    console.error('create-order failed', mapped.code);
    return jsonResponse(request, mapped.status, {
      error: { code: mapped.code, message: mapped.message },
    });
  }
});
