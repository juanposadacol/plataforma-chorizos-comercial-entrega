// @vitest-environment jsdom
// El perfil del dispositivo vive en localStorage: sin DOM no hay nada que probar.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `lookup_customer_for_order` es la única consulta pública por celular. Lo que
// se prueba aquí es qué llega desde ella al checkout y qué NUNCA llega.
const rpc = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
  isSupabaseConfigured: true,
}));

const { fetchPhoneLookup, loadCustomerProfile, readLocalProfile, saveLocalProfile } =
  await import('./customerProfile');

const PHONE = '3013350356';

/** Respuesta real de la RPC: nombre y entrega completos, correo solo insinuado. */
const LOOKUP_ROW = {
  phone: PHONE,
  name: 'JUAN PEREZ',
  address: 'Calle 10 # 20-30',
  neighborhood: 'El Playón',
  municipality: 'Medellín',
  has_email: true,
  email_hint: 'j••••@g••••.com',
};

beforeEach(() => {
  rpc.mockReset();
  window.localStorage.clear();
});

describe('la búsqueda pública por celular no entrega el correo', () => {
  it('trae nombre y dirección, pero del correo solo que existe y una pista', async () => {
    rpc.mockResolvedValue({ data: LOOKUP_ROW, error: null });

    const profile = await fetchPhoneLookup(PHONE);

    expect(profile).toMatchObject({
      name: 'JUAN PEREZ',
      address: 'Calle 10 # 20-30',
      hasSavedEmail: true,
      emailHint: 'j••••@g••••.com',
    });
    // Lo esencial: el correo utilizable no está en ninguna parte del perfil.
    expect(profile?.email).toBeUndefined();
    expect(JSON.stringify(profile)).not.toContain('gmail');
    expect(JSON.stringify(profile)).not.toContain('juan.perez');
  });

  it('la pista no permite reconstruir ni la cuenta ni el dominio', () => {
    // Contrato de `mask_email` en 202608070014: primera letra de cada parte y
    // la extensión. Todo lo demás queda oculto.
    const hint = LOOKUP_ROW.email_hint;
    expect(hint).toBe('j••••@g••••.com');
    expect(hint).not.toContain('uan');
    expect(hint).not.toContain('mail.com');
  });

  it('sin correo guardado no anuncia ninguno', async () => {
    rpc.mockResolvedValue({
      data: { ...LOOKUP_ROW, has_email: false, email_hint: null },
      error: null,
    });

    const profile = await fetchPhoneLookup(PHONE);
    expect(profile?.hasSavedEmail).toBe(false);
    expect(profile?.emailHint).toBe('');
  });
});

describe('autocarga del checkout: el correo se comporta como los demás datos', () => {
  // Este es el defecto reportado. `loadCustomerProfile` devolvía la PRIMERA
  // fuente que respondiera; como el servidor responde a todo cliente ya
  // registrado, la memoria del dispositivo no se leía nunca y el correo era el
  // único campo que quedaba vacío bajo el aviso «Cargamos los datos guardados».
  it('conserva el correo del dispositivo aunque el servidor conteste', async () => {
    saveLocalProfile({
      phone: PHONE,
      name: 'Juan',
      address: 'Calle vieja',
      neighborhood: 'Centro',
      municipality: 'Medellín',
      email: 'juan.perez@gmail.com',
    });
    rpc.mockResolvedValue({ data: LOOKUP_ROW, error: null });

    const profile = await loadCustomerProfile(PHONE, false);

    // El servidor manda en lo que sí devuelve...
    expect(profile?.address).toBe('Calle 10 # 20-30');
    expect(profile?.name).toBe('JUAN PEREZ');
    // ...y el dispositivo aporta el correo, que el servidor jamás devuelve.
    expect(profile?.email).toBe('juan.perez@gmail.com');
  });

  it('sin memoria en el dispositivo deja el correo vacío y solo señala que existe', async () => {
    rpc.mockResolvedValue({ data: LOOKUP_ROW, error: null });

    const profile = await loadCustomerProfile(PHONE, false);

    expect(profile?.email).toBe('');
    // El checkout usa esto para explicar que el pedido llegará igual a su
    // correo guardado, aunque él deje el campo en blanco.
    expect(profile?.hasSavedEmail).toBe(true);
    expect(profile?.emailHint).toBe('j••••@g••••.com');
  });

  it('la memoria de otro celular no se filtra a este comprador', async () => {
    saveLocalProfile({
      phone: '3009998877',
      name: 'Ana',
      address: 'Otra calle',
      neighborhood: 'Centro',
      municipality: 'Medellín',
      email: 'ana@correo.com',
    });
    rpc.mockResolvedValue({ data: LOOKUP_ROW, error: null });

    const profile = await loadCustomerProfile(PHONE, false);
    expect(profile?.email).toBe('');
  });

  it('si el servidor falla, el dispositivo sigue autocompletando', async () => {
    saveLocalProfile({
      phone: PHONE,
      name: 'Juan',
      address: 'Calle guardada',
      neighborhood: 'Centro',
      municipality: 'Medellín',
      email: 'juan.perez@gmail.com',
    });
    rpc.mockRejectedValue(new Error('sin red'));

    const profile = await loadCustomerProfile(PHONE, false);
    expect(profile?.address).toBe('Calle guardada');
    expect(profile?.email).toBe('juan.perez@gmail.com');
  });

  it('un celular desconocido y sin memoria no autocompleta nada', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await loadCustomerProfile(PHONE, false)).toBe(null);
  });

  it('el correo se recuerda en el dispositivo después de comprar', () => {
    saveLocalProfile({
      phone: PHONE,
      name: 'Juan',
      address: 'Calle 10',
      neighborhood: 'Centro',
      municipality: 'Medellín',
      email: 'juan.perez@gmail.com',
    });
    expect(readLocalProfile(PHONE)?.email).toBe('juan.perez@gmail.com');
  });
});
