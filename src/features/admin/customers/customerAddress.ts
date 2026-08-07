import { insertRecord, updateRecord } from '../adminService';
import type { AdminRecord } from '../types';

/**
 * Dirección del cliente. Vive en `customer_addresses`, no en `customers`: la
 * ficha del cliente no tiene columnas de dirección porque una persona puede
 * tener varias (casa, negocio) y el pedido guarda cuál usó.
 */
export interface CustomerAddress extends AdminRecord {
  customer_id: string;
  address_line: string;
  neighborhood?: string | null;
  municipality?: string | null;
  is_primary?: boolean;
  is_active?: boolean;
  deleted_at?: string | null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Campos del formulario que no pertenecen a la tabla `customers`. */
export const ADDRESS_FIELD_KEYS = ['address', 'neighborhood', 'municipality'] as const;

export const primaryAddressByCustomer = (
  addresses: CustomerAddress[],
): Map<string, CustomerAddress> => {
  const map = new Map<string, CustomerAddress>();
  addresses.forEach((address) => {
    if (address.deleted_at) return;
    const current = map.get(address.customer_id);
    // Gana la principal; si ninguna lo es, la primera que llegue.
    if (!current || (address.is_primary && !current.is_primary))
      map.set(address.customer_id, address);
  });
  return map;
};

/**
 * Guarda la dirección escrita en la ficha del cliente. Actualiza la principal
 * si ya existe y, si no, la crea. Una dirección vacía se deja como está: se
 * borra desde la libreta del cliente, no vaciando el formulario.
 */
export const saveCustomerAddress = async (
  customerId: string,
  values: Record<string, unknown>,
  existing: CustomerAddress | undefined,
): Promise<void> => {
  const addressLine = text(values.address);
  const neighborhood = text(values.neighborhood) || null;
  const municipality = text(values.municipality) || null;

  if (!addressLine) return;
  // `address_line` exige entre 4 y 300 caracteres en la base.
  if (addressLine.length < 4)
    throw new Error('La dirección principal debe tener al menos 4 caracteres.');

  if (existing) {
    await updateRecord('customer_addresses', existing.id, {
      address_line: addressLine,
      neighborhood,
      municipality,
    });
    return;
  }

  await insertRecord('customer_addresses', {
    customer_id: customerId,
    label: 'Principal',
    address_line: addressLine,
    neighborhood,
    municipality,
    is_primary: true,
    is_active: true,
  });
};
