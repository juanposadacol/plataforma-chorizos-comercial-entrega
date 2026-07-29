// Clasificación de credenciales entrantes para las Edge Functions.
//
// Igual que `origins.ts`, este módulo es puro y no toca `Deno`, para poder
// probarlo con Vitest. El handler inyecta el entorno y el verificador real.
//
// Contexto del defecto que corrige: la versión anterior decidía "¿hay sesión?"
// con `token !== SUPABASE_ANON_KEY`. Esa variable contiene la anon key *legacy*
// (un JWT `eyJ…`), pero el frontend envía una publishable key moderna
// (`sb_publishable_…`). La comparación nunca coincidía, así que toda compra de
// invitado se interpretaba como sesión de usuario y terminaba en 401.

/** Resultado de clasificar el `Authorization` de una petición. */
export type Credential =
  /** Sin sesión. Es el mínimo privilegio y el caso normal de una compra de invitado. */
  | { kind: 'guest'; reason: 'no-authorization' | 'publishable-key' | 'anon-key' | 'opaque-token' }
  /** Tiene forma de JWT. La forma NO otorga permisos: obliga a verificar contra Supabase Auth. */
  | { kind: 'user-token'; token: string }
  /** Credencial privilegiada. Jamás debe llegar desde un navegador. */
  | { kind: 'privileged'; reason: 'secret-key' | 'service-role' };

export interface CredentialEnvironment {
  /** `SUPABASE_ANON_KEY` — anon key legacy (JWT). */
  anonKey?: string | null;
  /** `SUPABASE_PUBLISHABLE_KEYS` — claves publicables modernas, separadas por comas. */
  publishableKeys?: string | null;
  /** `SUPABASE_SECRET_KEYS` — claves secretas modernas, separadas por comas. */
  secretKeys?: string | null;
  /** `SUPABASE_SERVICE_ROLE_KEY` — service role legacy (JWT). */
  serviceRoleKey?: string | null;
}

const commaList = (raw: string | null | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

/** Estructura `xxx.yyy.zzz` con los tres segmentos no vacíos. Solo forma, no validez. */
export function isJwtLike(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

/**
 * Clasifica el token del `Authorization` sin concederle confianza.
 *
 * El orden importa:
 *  1. credenciales privilegiadas primero, para rechazarlas siempre;
 *  2. claves de API públicas ANTES de la comprobación de forma JWT, porque la
 *     anon key legacy también es `xxx.yyy.zzz` y no es una sesión;
 *  3. forma JWT, que solo habilita la verificación posterior;
 *  4. cualquier otra cosa cae a invitado, nunca a sesión.
 */
export function classifyCredential(
  token: string | null | undefined,
  environment: CredentialEnvironment,
): Credential {
  const value = token?.trim();
  if (!value) return { kind: 'guest', reason: 'no-authorization' };

  if (value.startsWith('sb_secret_') || commaList(environment.secretKeys).includes(value)) {
    return { kind: 'privileged', reason: 'secret-key' };
  }
  const serviceRoleKey = environment.serviceRoleKey?.trim();
  if (serviceRoleKey && value === serviceRoleKey) {
    return { kind: 'privileged', reason: 'service-role' };
  }

  if (
    value.startsWith('sb_publishable_') ||
    commaList(environment.publishableKeys).includes(value)
  ) {
    return { kind: 'guest', reason: 'publishable-key' };
  }
  const anonKey = environment.anonKey?.trim();
  if (anonKey && value === anonKey) {
    return { kind: 'guest', reason: 'anon-key' };
  }

  if (isJwtLike(value)) return { kind: 'user-token', token: value };

  return { kind: 'guest', reason: 'opaque-token' };
}

/** Usuario confirmado por Supabase Auth. `null` si el token no es válido. */
export interface VerifiedUser {
  id: string;
  phone: string | null;
  role?: string | null;
}

export type Actor =
  | { ok: true; userId: string | null; phone: string | null }
  | { ok: false; code: 'INVALID_SESSION' | 'PRIVILEGED_CREDENTIAL' };

/**
 * Resuelve quién hace la petición.
 *
 * `verify` es la fuente de verdad para usuarios autenticados (en producción,
 * `auth.getUser()`), y solo se invoca cuando el token tiene forma de JWT: nunca
 * se le pasa una publishable key ni una anon key.
 */
export async function resolveActor(
  credential: Credential,
  verify: (token: string) => Promise<VerifiedUser | null>,
): Promise<Actor> {
  if (credential.kind === 'privileged') {
    return { ok: false, code: 'PRIVILEGED_CREDENTIAL' };
  }
  if (credential.kind === 'guest') {
    return { ok: true, userId: null, phone: null };
  }

  const user = await verify(credential.token);
  if (!user) return { ok: false, code: 'INVALID_SESSION' };
  // Defensa en profundidad: un token de servicio jamás actúa como cliente.
  if (user.role === 'service_role') return { ok: false, code: 'PRIVILEGED_CREDENTIAL' };
  return { ok: true, userId: user.id, phone: user.phone ?? null };
}
