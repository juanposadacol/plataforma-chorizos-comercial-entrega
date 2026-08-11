// Lógica pura del webhook de estado de WhatsApp Cloud API.
//
// Igual que `origins.ts` y `order-email.ts`, este módulo no toca `Deno` a
// propósito: así se puede ejercitar desde Vitest sin desplegar nada.
//
// Para qué existe: Meta responde 200 con un `wamid` en cuanto ACEPTA el mensaje,
// no cuando lo entrega. Todo lo que pasa después —`sent`, `delivered`, `read` o
// `failed` con un código de error— solo llega por webhook. Sin esto, un mensaje
// aceptado y nunca entregado es indistinguible de uno entregado.

/** Estados que Meta reporta en el arreglo `statuses`. */
export type WhatsAppStatus = 'sent' | 'delivered' | 'read' | 'failed' | 'deleted';

export interface WhatsAppStatusError {
  code: number | null;
  title: string | null;
  message: string | null;
  details: string | null;
}

export interface WhatsAppStatusEvent {
  /** `wamid...`. Es la misma cadena que el worker guardó en `external_id`. */
  messageId: string;
  status: WhatsAppStatus | string;
  /** ISO 8601 en UTC. Meta manda epoch en segundos, como texto. */
  occurredAt: string | null;
  recipientId: string | null;
  /** Número del negocio que emitió el mensaje, para distinguir remitentes. */
  phoneNumberId: string | null;
  conversationId: string | null;
  /** Meta puede mandar varios errores por estado; se conservan todos. */
  errors: WhatsAppStatusError[];
}

export interface WhatsAppInboundMessage {
  messageId: string;
  from: string | null;
  type: string | null;
  occurredAt: string | null;
  phoneNumberId: string | null;
}

const str = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};

/** Meta manda el timestamp como epoch en segundos, casi siempre en texto. */
export const epochToIso = (value: unknown): string | null => {
  const raw = str(value);
  if (!raw || !/^\d{1,13}$/.test(raw)) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toErrors = (value: unknown): WhatsAppStatusError[] => {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    // `error_data.details` es donde Meta pone la explicación accionable;
    // `title` suele ser genérico.
    const data = (item.error_data ?? {}) as Record<string, unknown>;
    const code = Number(item.code);
    return {
      code: Number.isFinite(code) ? code : null,
      title: str(item.title),
      message: str(item.message),
      details: str(data.details) ?? str(item.details),
    };
  });
};

/**
 * Decisión de la verificación GET que Meta hace al guardar la URL.
 *
 * Meta llama con `hub.mode=subscribe`, `hub.verify_token` y `hub.challenge`, y
 * espera el challenge TAL CUAL en el cuerpo, con 200. Cualquier otra cosa —un
 * JSON, un 204, un challenge modificado— hace que la consola muestre
 * «No se pudo validar la URL de devolución de llamada».
 */
export const verifyChallenge = (
  params: { mode?: string | null; token?: string | null; challenge?: string | null },
  expectedToken: string | null | undefined,
): { ok: true; challenge: string } | { ok: false; reason: string } => {
  if (!expectedToken) return { ok: false, reason: 'verify_token_not_configured' };
  if (params.mode !== 'subscribe') return { ok: false, reason: 'unexpected_mode' };
  if (typeof params.token !== 'string' || !timingSafeEqual(params.token, expectedToken)) {
    return { ok: false, reason: 'verify_token_mismatch' };
  }
  const challenge = params.challenge;
  if (typeof challenge !== 'string' || challenge === '') {
    return { ok: false, reason: 'missing_challenge' };
  }
  return { ok: true, challenge };
};

/** Comparación de duración constante: no filtra por tiempo cuántos caracteres coinciden. */
export function timingSafeEqual(left: string, right: string): boolean {
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

/**
 * Confirma que el cuerpo viene de Meta y no de un tercero.
 *
 * Meta firma cada POST con HMAC-SHA256 del cuerpo CRUDO usando el App Secret,
 * en la cabecera `x-hub-signature-256: sha256=<hex>`. Hay que usar el texto
 * exacto recibido: volver a serializar el JSON cambia la firma.
 */
export const signatureIsValid = async (
  rawBody: string,
  header: string | null | undefined,
  appSecret: string | null | undefined,
): Promise<boolean> => {
  if (!appSecret) return false;
  const provided = (header ?? '').trim().toLowerCase();
  if (!provided.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(signed))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return timingSafeEqual(provided.slice(7), expected);
};

const changeValues = (payload: unknown): Record<string, unknown>[] => {
  const root = (payload ?? {}) as Record<string, unknown>;
  const entries = Array.isArray(root.entry) ? root.entry : [];
  const values: Record<string, unknown>[] = [];
  for (const entry of entries) {
    const changes = ((entry ?? {}) as Record<string, unknown>).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const item = (change ?? {}) as Record<string, unknown>;
      // Solo interesa el campo `messages`; una cuenta puede estar suscrita a más.
      if (item.field !== undefined && item.field !== 'messages') continue;
      if (item.value && typeof item.value === 'object') {
        values.push(item.value as Record<string, unknown>);
      }
    }
  }
  return values;
};

const phoneNumberIdOf = (value: Record<string, unknown>): string | null => {
  const metadata = (value.metadata ?? {}) as Record<string, unknown>;
  return str(metadata.phone_number_id);
};

/**
 * Extrae los eventos de estado. Un solo POST puede traer varios `entry`, varios
 * `changes` y varios `statuses`; se aplanan todos para no perder ninguno.
 */
export const flattenStatusEvents = (payload: unknown): WhatsAppStatusEvent[] => {
  const events: WhatsAppStatusEvent[] = [];
  for (const value of changeValues(payload)) {
    const statuses = Array.isArray(value.statuses) ? value.statuses : [];
    for (const raw of statuses) {
      const item = (raw ?? {}) as Record<string, unknown>;
      const messageId = str(item.id);
      if (!messageId) continue;
      const conversation = (item.conversation ?? {}) as Record<string, unknown>;
      events.push({
        messageId,
        status: str(item.status) ?? 'unknown',
        occurredAt: epochToIso(item.timestamp),
        recipientId: str(item.recipient_id),
        phoneNumberId: phoneNumberIdOf(value),
        conversationId: str(conversation.id),
        errors: toErrors(item.errors),
      });
    }
  }
  return events;
};

/** Mensajes entrantes. No se procesan todavía; se registran para ver el tráfico. */
export const flattenInboundMessages = (payload: unknown): WhatsAppInboundMessage[] => {
  const messages: WhatsAppInboundMessage[] = [];
  for (const value of changeValues(payload)) {
    const list = Array.isArray(value.messages) ? value.messages : [];
    for (const raw of list) {
      const item = (raw ?? {}) as Record<string, unknown>;
      const messageId = str(item.id);
      if (!messageId) continue;
      messages.push({
        messageId,
        from: str(item.from),
        type: str(item.type),
        occurredAt: epochToIso(item.timestamp),
        phoneNumberId: phoneNumberIdOf(value),
      });
    }
  }
  return messages;
};

/**
 * Línea de log de un evento. Va a los logs de la Edge Function, que es donde se
 * lee el diagnóstico sin depender de ninguna tabla.
 *
 * No incluye el número completo del destinatario: los logs los puede ver
 * cualquiera con acceso al proyecto y `recipient_id` es un dato personal. Los
 * últimos cuatro dígitos alcanzan para saber a qué prueba corresponde.
 */
export const summarizeStatusEvent = (event: WhatsAppStatusEvent): Record<string, unknown> => ({
  wamid: event.messageId,
  status: event.status,
  occurred_at: event.occurredAt,
  recipient_tail: event.recipientId ? `***${event.recipientId.slice(-4)}` : null,
  phone_number_id: event.phoneNumberId,
  ...(event.errors.length
    ? {
        error_codes: event.errors.map((error) => error.code),
        error_titles: event.errors.map((error) => error.title),
        error_details: event.errors.map((error) => error.details ?? error.message),
      }
    : {}),
});
