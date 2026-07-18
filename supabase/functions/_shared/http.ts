const DEFAULT_ALLOWED_HEADERS =
  'authorization, apikey, content-type, x-client-info, x-idempotency-key';

function configuredOrigins(): string[] {
  return (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin') ?? '';
  const allowed = configuredOrigins();
  const allowOrigin = allowed.includes(origin)
    ? origin
    : allowed.includes('*')
      ? '*'
      : (allowed[0] ?? 'null');

  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-headers': DEFAULT_ALLOWED_HEADERS,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // Non-browser/server-to-server requests.
  const allowed = configuredOrigins();
  return allowed.includes('*') || allowed.includes(origin);
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
