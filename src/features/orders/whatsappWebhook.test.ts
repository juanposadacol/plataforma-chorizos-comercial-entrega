import { describe, expect, it } from 'vitest';
import {
  epochToIso,
  flattenInboundMessages,
  flattenStatusEvents,
  signatureIsValid,
  summarizeStatusEvent,
  verifyChallenge,
} from '../../../supabase/functions/_shared/whatsapp-webhook';

// Lógica pura de la Edge Function `whatsapp-webhook`. Se mantiene sin `Deno`
// para poder ejercitarla aquí, igual que `origins.ts` y `order-email.ts`.

const VERIFY_TOKEN = 'token-de-verificacion-largo-y-aleatorio';

/** Cuerpo real de un fallo de entrega de WhatsApp Cloud API. */
const FAILED_EVENT = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '573001112233',
              phone_number_id: '1247744058420553',
            },
            statuses: [
              {
                id: 'wamid.HBgMNTczMDUzMzUwMzU2FQIAERgS',
                status: 'failed',
                timestamp: '1754870400',
                recipient_id: '573053350356',
                errors: [
                  {
                    code: 131049,
                    title:
                      'This message was not delivered to maintain healthy ecosystem engagement.',
                    message: 'Message not delivered',
                    error_data: {
                      details: 'Meta chose not to deliver this marketing message',
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  ],
};

describe('verificación GET de la URL en Meta', () => {
  it('devuelve el challenge tal cual cuando el token coincide', () => {
    const outcome = verifyChallenge(
      { mode: 'subscribe', token: VERIFY_TOKEN, challenge: '1158201444' },
      VERIFY_TOKEN,
    );
    expect(outcome).toEqual({ ok: true, challenge: '1158201444' });
  });

  it('rechaza un token equivocado', () => {
    const outcome = verifyChallenge(
      { mode: 'subscribe', token: 'otro-token', challenge: '1158201444' },
      VERIFY_TOKEN,
    );
    expect(outcome).toEqual({ ok: false, reason: 'verify_token_mismatch' });
  });

  it('rechaza si el secreto no está configurado, en vez de aceptar a todos', () => {
    expect(verifyChallenge({ mode: 'subscribe', token: '', challenge: 'x' }, undefined)).toEqual({
      ok: false,
      reason: 'verify_token_not_configured',
    });
  });

  it('exige hub.mode=subscribe y un challenge presente', () => {
    expect(
      verifyChallenge({ mode: 'unsubscribe', token: VERIFY_TOKEN, challenge: 'x' }, VERIFY_TOKEN),
    ).toEqual({ ok: false, reason: 'unexpected_mode' });
    expect(
      verifyChallenge({ mode: 'subscribe', token: VERIFY_TOKEN, challenge: '' }, VERIFY_TOKEN),
    ).toEqual({ ok: false, reason: 'missing_challenge' });
  });
});

describe('firma HMAC del cuerpo (x-hub-signature-256)', () => {
  const SECRET = 'app-secret-de-prueba';
  const BODY = JSON.stringify({ hola: 'mundo' });

  it('acepta la firma que produce el App Secret', async () => {
    // Firma calculada con el mismo algoritmo que usa Meta.
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(BODY));
    const hex = Array.from(new Uint8Array(signed))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    expect(await signatureIsValid(BODY, `sha256=${hex}`, SECRET)).toBe(true);
  });

  it('rechaza un cuerpo alterado, una firma falsa o un encabezado ausente', async () => {
    expect(await signatureIsValid(BODY, 'sha256=deadbeef', SECRET)).toBe(false);
    expect(await signatureIsValid(BODY, null, SECRET)).toBe(false);
    expect(await signatureIsValid(BODY, 'deadbeef', SECRET)).toBe(false);
  });

  it('sin App Secret configurado nunca da por válida una firma', async () => {
    expect(await signatureIsValid(BODY, 'sha256=loquesea', undefined)).toBe(false);
  });
});

describe('lectura de los eventos de estado', () => {
  it('extrae wamid, estado, fecha, destinatario y el código de error', () => {
    const event = flattenStatusEvents(FAILED_EVENT)[0]!;

    expect(event).toMatchObject({
      messageId: 'wamid.HBgMNTczMDUzMzUwMzU2FQIAERgS',
      status: 'failed',
      recipientId: '573053350356',
      phoneNumberId: '1247744058420553',
    });
    expect(event.occurredAt).toBe('2025-08-11T00:00:00.000Z');
    // Esto es lo que explica por qué un mensaje aceptado no llegó.
    expect(event.errors[0]).toEqual({
      code: 131049,
      title: 'This message was not delivered to maintain healthy ecosystem engagement.',
      message: 'Message not delivered',
      details: 'Meta chose not to deliver this marketing message',
    });
  });

  it('lee los estados intermedios sin errores', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '1247744058420553' },
                statuses: [
                  { id: 'wamid.A', status: 'sent', timestamp: '1754870400' },
                  {
                    id: 'wamid.A',
                    status: 'delivered',
                    timestamp: '1754870405',
                    conversation: { id: 'conv-1' },
                  },
                  { id: 'wamid.A', status: 'read', timestamp: '1754870500' },
                ],
              },
            },
          ],
        },
      ],
    };

    const events = flattenStatusEvents(payload);
    expect(events.map((event) => event.status)).toEqual(['sent', 'delivered', 'read']);
    expect(events.every((event) => event.errors.length === 0)).toBe(true);
    expect(events[1]!.conversationId).toBe('conv-1');
  });

  it('aplana varios entry y varios changes sin perder eventos', () => {
    const payload = {
      entry: [
        {
          changes: [
            { field: 'messages', value: { statuses: [{ id: 'wamid.A', status: 'sent' }] } },
            { field: 'messages', value: { statuses: [{ id: 'wamid.B', status: 'delivered' }] } },
          ],
        },
        {
          changes: [
            { field: 'messages', value: { statuses: [{ id: 'wamid.C', status: 'read' }] } },
          ],
        },
      ],
    };
    expect(flattenStatusEvents(payload).map((event) => event.messageId)).toEqual([
      'wamid.A',
      'wamid.B',
      'wamid.C',
    ]);
  });

  it('ignora campos que no son messages y cuerpos inservibles', () => {
    expect(
      flattenStatusEvents({
        entry: [
          { changes: [{ field: 'account_review_update', value: { statuses: [{ id: 'x' }] } }] },
        ],
      }),
    ).toEqual([]);
    for (const value of [null, undefined, {}, { entry: 'no-es-lista' }, { entry: [{}] }]) {
      expect(flattenStatusEvents(value)).toEqual([]);
    }
  });

  it('descarta un estado sin wamid: no habría con qué unirlo al envío', () => {
    const payload = {
      entry: [{ changes: [{ field: 'messages', value: { statuses: [{ status: 'sent' }] } }] }],
    };
    expect(flattenStatusEvents(payload)).toEqual([]);
  });

  it('lee los mensajes entrantes por separado', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '1247744058420553' },
                messages: [
                  { id: 'wamid.IN', from: '573053350356', type: 'text', timestamp: '1754870400' },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(flattenInboundMessages(payload)[0]).toMatchObject({
      messageId: 'wamid.IN',
      from: '573053350356',
      type: 'text',
    });
  });
});

describe('epochToIso', () => {
  it('convierte el epoch en segundos que manda Meta', () => {
    expect(epochToIso('1754870400')).toBe('2025-08-11T00:00:00.000Z');
    expect(epochToIso(1754870400)).toBe('2025-08-11T00:00:00.000Z');
  });

  it('devuelve null ante un valor que no es un epoch', () => {
    for (const value of ['', 'ayer', null, undefined, '0', -5, {}]) {
      expect(epochToIso(value)).toBe(null);
    }
  });
});

describe('lo que se escribe en los logs', () => {
  it('incluye el código de error pero no el número completo del destinatario', () => {
    const event = flattenStatusEvents(FAILED_EVENT)[0]!;
    const summary = summarizeStatusEvent(event);

    expect(summary).toMatchObject({
      wamid: 'wamid.HBgMNTczMDUzMzUwMzU2FQIAERgS',
      status: 'failed',
      error_codes: [131049],
      phone_number_id: '1247744058420553',
    });
    // El destinatario es un dato personal y los logs los ve cualquiera con
    // acceso al proyecto: solo se conserva la cola para identificar la prueba.
    expect(summary.recipient_tail).toBe('***0356');
    expect(JSON.stringify(summary)).not.toContain('573053350356');
  });

  it('un estado normal no arrastra campos de error vacíos', () => {
    const event = flattenStatusEvents({
      entry: [
        {
          changes: [
            { field: 'messages', value: { statuses: [{ id: 'wamid.A', status: 'delivered' }] } },
          ],
        },
      ],
    })[0]!;
    const summary = summarizeStatusEvent(event);
    expect(summary).not.toHaveProperty('error_codes');
    expect(summary.status).toBe('delivered');
  });
});
