import { normalizeColombianPhone } from '../../lib/format';
import { supabase } from '../../lib/supabase';

const STORAGE_KEY = 'chorizos-perfil-v1';

export interface CustomerProfile {
  phone: string;
  name: string;
  address: string;
  neighborhood: string;
  municipality: string;
  /**
   * Solo memoria del dispositivo. El servidor NO devuelve el correo en la
   * búsqueda por celular: sería exponer un dato personal a quien conozca el
   * número. Aquí sirve para que el mismo comprador no lo reescriba.
   */
  email?: string;
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Perfil guardado en ESTE dispositivo tras un pedido confirmado. Es el único
 * origen disponible para quien compra sin iniciar sesión: consultar el servidor
 * por celular dejaría que cualquiera leyera el nombre y la dirección de un
 * tercero con solo escribir su número.
 */
export const saveLocalProfile = (profile: CustomerProfile): void => {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...profile, phone: normalizeColombianPhone(profile.phone) }),
    );
  } catch {
    // Sin almacenamiento el checkout sigue funcionando; solo no se recuerda.
  }
};

export const readLocalProfile = (phone: string): CustomerProfile | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CustomerProfile>;
    if (normalizeColombianPhone(clean(parsed.phone)) !== normalizeColombianPhone(phone))
      return null;
    return {
      phone: clean(parsed.phone),
      name: clean(parsed.name),
      address: clean(parsed.address),
      neighborhood: clean(parsed.neighborhood),
      municipality: clean(parsed.municipality),
      email: clean(parsed.email),
    };
  } catch {
    return null;
  }
};

/**
 * Datos del cliente autenticado. `customer_self` y `customer_addresses` solo
 * devuelven la fila de quien tiene la sesión, así que esto nunca expone a otro
 * cliente aunque se escriba su celular.
 */
export const fetchSessionProfile = async (phone: string): Promise<CustomerProfile | null> => {
  if (!supabase) return null;
  const { data: self } = await supabase
    .from('customer_self')
    .select('id,full_name,phone')
    .maybeSingle();
  if (!self) return null;
  if (normalizeColombianPhone(clean(self.phone)) !== normalizeColombianPhone(phone)) return null;
  const { data: addresses } = await supabase
    .from('customer_addresses')
    .select('address_line,neighborhood,municipality,is_primary')
    .eq('customer_id', self.id)
    .order('is_primary', { ascending: false })
    .limit(1);
  const address = addresses?.[0];
  return {
    phone: clean(self.phone),
    name: clean(self.full_name),
    address: clean(address?.address_line),
    neighborhood: clean(address?.neighborhood),
    municipality: clean(address?.municipality),
  };
};

/**
 * Busca en el servidor el cliente dueño de ese celular. Solo devuelve nombre y
 * dirección de entrega: el resto de la ficha (documento, correo, saldo, cupo,
 * lista de precios) no sale del panel.
 */
export const fetchPhoneLookup = async (phone: string): Promise<CustomerProfile | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('lookup_customer_for_order', { p_phone: phone });
  if (error || !data) return null;
  const found = data as Partial<CustomerProfile>;
  return {
    phone: clean(found.phone),
    name: clean(found.name),
    address: clean(found.address),
    neighborhood: clean(found.neighborhood),
    municipality: clean(found.municipality),
  };
};

/** El servidor manda; la memoria del dispositivo es el respaldo si no responde. */
export const loadCustomerProfile = async (
  phone: string,
  hasSession: boolean,
): Promise<CustomerProfile | null> => {
  try {
    const profile = await fetchPhoneLookup(phone);
    if (profile) return profile;
  } catch {
    // Sin datos del servidor se sigue con lo guardado localmente.
  }
  if (hasSession) {
    try {
      const profile = await fetchSessionProfile(phone);
      if (profile) return profile;
    } catch {
      // Si la consulta falla se intenta con lo guardado localmente.
    }
  }
  return readLocalProfile(phone);
};
