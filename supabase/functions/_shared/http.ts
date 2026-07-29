import {
  originIsAllowed,
  parseOriginList,
  resolveAllowedOrigin,
  resolveRejectionOrigin,
} from './origins.ts';

const DEFAULT_ALLOWED_HEADERS =
  'authorization, apikey, content-type, x-client-info, x-idempotency-key';

function configuredOrigins(): string[] {
  return parseOriginList(Deno.env.get('ALLOWED_ORIGINS'));
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin');
  return {
    'access-control-allow-origin': resolveAllowedOrigin(origin, configuredOrigins()),
    'access-control-allow-headers': DEFAULT_ALLOWED_HEADERS,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

/**
 * Cabeceras del preflight. Devuelven siempre el origen solicitante porque una
 * respuesta `OPTIONS` no transporta ningún dato: su único efecto es dejar que el
 * navegador envíe el POST, que sí pasa por la allowlist. Sin esto, un origen no
 * autorizado falla en el preflight y el cliente nunca puede leer el motivo.
 */
export function preflightHeaders(request: Request): HeadersInit {
  return {
    ...corsHeaders(request),
    'access-control-allow-origin': resolveRejectionOrigin(request.headers.get('origin')),
  };
}

/**
 * Permite que el cliente lea el cuerpo de una respuesta de rechazo. El cuerpo
 * solo contiene `{ error: { code, message } }`; no autoriza nada.
 */
export function readableRejectionHeaders(request: Request): HeadersInit {
  return {
    'access-control-allow-origin': resolveRejectionOrigin(request.headers.get('origin')),
  };
}

export function isAllowedOrigin(request: Request): boolean {
  return originIsAllowed(request.headers.get('origin'), configuredOrigins());
}

export function jsonResponse(
  request: Request,
  status: number,
  body: unknown,
  extraHeaders: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      ...extraHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error('PAYLOAD_TOO_LARGE');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('INVALID_JSON');
  }
}

export function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    forwarded ??
    'unknown'
  ).slice(0, 128);
}

export function bearerToken(request: Request): string | null {
  const value = request.headers.get('authorization');
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}
