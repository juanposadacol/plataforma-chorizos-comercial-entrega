import { z } from 'zod';

export const checkoutSchema = z.object({
  customerName: z.string().trim().min(3, 'Escribe el nombre completo.').max(120),
  customerPhone: z
    .string()
    .trim()
    .refine(
      (value) => /^(?:\+?57)?3\d{9}$/.test(value.replace(/[\s()-]/g, '')),
      'Escribe un celular colombiano válido.',
    ),
  address: z.string().trim().min(5, 'Escribe una dirección o punto de entrega.').max(250),
  neighborhood: z.string().trim().min(2, 'Escribe el barrio o sector.').max(100),
  municipality: z.string().trim().min(2, 'Escribe el municipio.').max(100),
  deliveryMethodId: z.string().uuid('Selecciona una forma de entrega.'),
  paymentMethodId: z.string().uuid('Selecciona una forma de pago.'),
  requestedDate: z.string().min(1, 'Selecciona una fecha.'),
  notes: z.string().trim().max(500, 'Máximo 500 caracteres.'),
  privacyAccepted: z
    .boolean()
    .refine((value) => value, 'Debes aceptar el tratamiento de datos para crear el pedido.'),
});

export type CheckoutFormValues = z.infer<typeof checkoutSchema>;
