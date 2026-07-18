import { z } from 'npm:zod@3.24.2';

const uuid = z.string().uuid();
const phone = z
  .string()
  .trim()
  .transform((value) => value.replace(/[^0-9+]/g, ''))
  .refine((value) => /^\+?[0-9]{10,15}$/.test(value), 'Celular inválido');

const normalizedOrderSchema = z
  .object({
    idempotency_key: uuid.optional(),
    customer_id: uuid.optional(),
    customer: z
      .object({
        name: z.string().trim().min(2).max(140),
        phone,
        email: z.string().trim().email().max(254).optional().nullable(),
        document_type: z.string().trim().max(30).optional().nullable(),
        document_number: z.string().trim().max(40).optional().nullable(),
      })
      .optional(),
    address_id: uuid.optional(),
    delivery_address: z.string().trim().min(4).max(300),
    neighborhood: z.string().trim().max(120).optional().nullable(),
    municipality: z.string().trim().max(120).optional().nullable(),
    delivery_method_id: uuid.optional(),
    delivery_method_code: z
      .string()
      .trim()
      .regex(/^[a-z0-9_-]{2,40}$/)
      .optional(),
    payment_method_id: uuid.optional(),
    payment_method_code: z
      .string()
      .trim()
      .regex(/^[a-z0-9_-]{2,40}$/)
      .optional(),
    requested_delivery_date: z.string().date().optional().nullable(),
    customer_notes: z.string().trim().max(1000).optional().nullable(),
    channel: z.enum(['web', 'pwa', 'admin', 'phone']).default('web'),
    items: z
      .array(
        z
          .object({
            product_id: uuid,
            variant_id: uuid.optional().nullable(),
            quantity: z.number().int().positive().max(9999),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.customer_id && !value.customer) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Se requiere customer_id o los datos del cliente',
        path: ['customer'],
      });
    }
    if (!value.delivery_method_id && !value.delivery_method_code) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Se requiere una forma de entrega',
        path: ['delivery_method_code'],
      });
    }
    if (!value.payment_method_id && !value.payment_method_code) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Se requiere una forma de pago',
        path: ['payment_method_code'],
      });
    }
    const keys = value.items.map((item) => `${item.product_id}:${item.variant_id ?? ''}`);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'No se permiten productos duplicados',
        path: ['items'],
      });
    }
  });

const storefrontOrderSchema = z
  .object({
    idempotency_key: uuid,
    customer: z
      .object({
        name: z.string().trim().min(2).max(140),
        phone,
      })
      .strict(),
    items: z
      .array(
        z
          .object({
            product_id: uuid,
            quantity: z.number().int().positive().max(9999),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    delivery: z
      .object({
        address: z.string().trim().min(4).max(300),
        neighborhood: z.string().trim().max(120),
        municipality: z.string().trim().max(120),
        delivery_method_id: uuid,
        requested_date: z.string().date().optional().nullable(),
      })
      .strict(),
    payment_method_id: uuid,
    notes: z.string().trim().max(1000).optional(),
  })
  .strict()
  .transform((value) => ({
    idempotency_key: value.idempotency_key,
    customer: value.customer,
    items: value.items,
    delivery_address: value.delivery.address,
    neighborhood: value.delivery.neighborhood,
    municipality: value.delivery.municipality,
    delivery_method_id: value.delivery.delivery_method_id,
    payment_method_id: value.payment_method_id,
    requested_delivery_date: value.delivery.requested_date,
    customer_notes: value.notes,
    channel: 'web' as const,
  }));

// Accepts the current storefront contract and a normalized contract for other trusted clients.
// Both schemas are strict, so injected price/discount/total fields are rejected.
export const createOrderSchema = z.union([storefrontOrderSchema, normalizedOrderSchema]);

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
