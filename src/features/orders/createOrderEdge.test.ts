import { describe, expect, it, vi } from 'vitest';
import {
  originIsAllowed,
  parseOriginList,
  resolveAllowedOrigin,
  resolveRejectionOrigin,
} from '../../../supabase/functions/_shared/origins';
import {
  classifyCredential,
  isJwtLike,
  resolveActor,
  type VerifiedUser,
} from '../../../supabase/functions/_shared/auth';

// Estos módulos son la lógica pura de la Edge Function `create-order`. Se
// mantienen libres de `Deno` justamente para poder ejercitarlos aquí; el
// handler solo les inyecta el entorno y el verificador real.

const PRODUCTION_ORIGIN = 'https://el-rey-del-chorizo.netlify.app';
const LOCAL_ORIGIN = 'http://localhost:5173';
const ALLOWED = parseOriginList(`${PRODUCTION_ORIGIN},${LOCAL_ORIGIN}`);

// Valores con la forma real de cada familia de credenciales. Ninguno es una
// clave verdadera: son literales inertes para fijar el comportamiento.
const PUBLISHABLE_KEY = 'sb_publishable_KQJzClieqq1vsERmmNSFuA_8_OA8sOV';
const LEGACY_ANON_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.firma-anon';
const LEGACY_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.firma-sr';
const MODERN_SECRET_KEY = 'sb_secret_3rYtQ0pLmXnB7vKcWs1AeZ';
const USER_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvLTEifQ.firma-usuario';

const ENVIRONMENT = {
  anonKey: LEGACY_ANON_KEY,
  publishableKeys: PUBLISHABLE_KEY,
  secretKeys: MODERN_SECRET_KEY,
  serviceRoleKey: LEGACY_SERVICE_ROLE_KEY,
};

describe('CORS — allowlist de orígenes', () => {
  it('1. acepta el origen de producción en Netlify', () => {
    expect(originIsAllowed(PRODUCTION_ORIGIN, ALLOWED)).toBe(true);
    expect(resolveAllowedOrigin(PRODUCTION_ORIGIN, ALLOWED)).toBe(PRODUCTION_ORIGIN);
  });

  it('2. acepta el origen de desarrollo en localhost', () => {
    expect(originIsAllowed(LOCAL_ORIGIN, ALLOWED)).toBe(true);
    expect(resolveAllowedOrigin(LOCAL_ORIGIN, ALLOWED)).toBe(LOCAL_ORIGIN);
  });

  it('3. rechaza un origen desconocido y falla cerrado en la cabecera', () => {
    expect(originIsAllowed('https://sitio-malicioso.example', ALLOWED)).toBe(false);
    expect(resolveAllowedOrigin('https://sitio-malicioso.example', ALLOWED)).toBe('null');
  });

  it('rechaza subdominios y esquemas que no coinciden exactamente', () => {
    expect(originIsAllowed('http://el-rey-del-chorizo.netlify.app', ALLOWED)).toBe(false);
    expect(originIsAllowed('https://evil.el-rey-del-chorizo.netlify.app', ALLOWED)).toBe(false);
    expect(originIsAllowed('https://el-rey-del-chorizo.netlify.app.evil.com', ALLOWED)).toBe(false);
  });

  it('normaliza barras finales al comparar y al configurar', () => {
    expect(parseOriginList(`${PRODUCTION_ORIGIN}/, ${LOCAL_ORIGIN}`)).toEqual(ALLOWED);
    expect(originIsAllowed(`${PRODUCTION_ORIGIN}/`, ALLOWED)).toBe(true);
  });

  it('sin cabecera Origin acepta: no es una petición de navegador', () => {
    expect(originIsAllowed(null, ALLOWED)).toBe(true);
    expect(originIsAllowed('', ALLOWED)).toBe(true);
  });

  it('sin ALLOWED_ORIGINS configurado no autoriza a nadie', () => {
    const vacio = parseOriginList(undefined);
    expect(vacio).toEqual([]);
    expect(originIsAllowed(PRODUCTION_ORIGIN, vacio)).toBe(false);
    expect(resolveAllowedOrigin(PRODUCTION_ORIGIN, vacio)).toBe('null');
  });

  it('7. un rechazo sigue siendo legible por el navegador, para conservar code y message', () => {
    // Sin esto el navegador bloquea la respuesta 403 y el usuario vuelve a ver
    // un mensaje genérico sin causa: exactamente el fallo que se corrigió.
    expect(resolveRejectionOrigin('https://sitio-malicioso.example')).toBe(
      'https://sitio-malicioso.example',
    );
    expect(resolveRejectionOrigin(null)).toBe('null');
  });
});

describe('Autenticación — clasificación de credenciales', () => {
  it('4. una publishable key moderna es una petición de invitado', () => {
    expect(classifyCredential(PUBLISHABLE_KEY, ENVIRONMENT)).toEqual({
      kind: 'guest',
      reason: 'publishable-key',
    });
  });

  it('4b. reconoce una publishable key aunque no esté listada en el entorno', () => {
    expect(classifyCredential(PUBLISHABLE_KEY, {})).toEqual({
      kind: 'guest',
      reason: 'publishable-key',
    });
  });

  it('la anon key legacy también es invitado, pese a tener forma de JWT', () => {
    // Regresión del defecto original: `token !== SUPABASE_ANON_KEY` era el único
    // criterio, y con claves modernas nunca coincidía.
    expect(isJwtLike(LEGACY_ANON_KEY)).toBe(true);
    expect(classifyCredential(LEGACY_ANON_KEY, ENVIRONMENT)).toEqual({
      kind: 'guest',
      reason: 'anon-key',
    });
  });

  it('sin cabecera Authorization es invitado', () => {
    expect(classifyCredential(null, ENVIRONMENT)).toEqual({
      kind: 'guest',
      reason: 'no-authorization',
    });
  });

  it('un token opaco desconocido cae a invitado, nunca a sesión', () => {
    expect(classifyCredential('token-opaco-sin-forma', ENVIRONMENT)).toEqual({
      kind: 'guest',
      reason: 'opaque-token',
    });
  });

  it('8. rechaza credenciales privilegiadas enviadas desde el navegador', () => {
    expect(classifyCredential(LEGACY_SERVICE_ROLE_KEY, ENVIRONMENT)).toEqual({
      kind: 'privileged',
      reason: 'service-role',
    });
    expect(classifyCredential(MODERN_SECRET_KEY, ENVIRONMENT)).toEqual({
      kind: 'privileged',
      reason: 'secret-key',
    });
    expect(classifyCredential('sb_secret_desconocida', {})).toEqual({
      kind: 'privileged',
      reason: 'secret-key',
    });
  });

  it('un JWT de usuario queda pendiente de verificación, sin conceder identidad', () => {
    expect(classifyCredential(USER_JWT, ENVIRONMENT)).toEqual({
      kind: 'user-token',
      token: USER_JWT,
    });
  });
});

describe('Autenticación — resolución del actor', () => {
  const verified: VerifiedUser = { id: 'usuario-1', phone: '+573001112233', role: 'authenticated' };

  it('5. un JWT real se valida con auth.getUser() y produce el usuario', async () => {
    const verify = vi.fn(async () => verified);
    const actor = await resolveActor(classifyCredential(USER_JWT, ENVIRONMENT), verify);

    expect(verify).toHaveBeenCalledExactlyOnceWith(USER_JWT);
    expect(actor).toEqual({ ok: true, userId: 'usuario-1', phone: '+573001112233' });
  });

  it('6. un JWT inválido se rechaza con INVALID_SESSION', async () => {
    const verify = vi.fn(async () => null);
    const actor = await resolveActor(classifyCredential(USER_JWT, ENVIRONMENT), verify);

    expect(verify).toHaveBeenCalledOnce();
    expect(actor).toEqual({ ok: false, code: 'INVALID_SESSION' });
  });

  it('nunca envía una publishable key a auth.getUser()', async () => {
    const verify = vi.fn(async () => verified);
    const actor = await resolveActor(classifyCredential(PUBLISHABLE_KEY, ENVIRONMENT), verify);

    expect(verify).not.toHaveBeenCalled();
    expect(actor).toEqual({ ok: true, userId: null, phone: null });
  });

  it('nunca envía la anon key legacy a auth.getUser()', async () => {
    const verify = vi.fn(async () => verified);
    await resolveActor(classifyCredential(LEGACY_ANON_KEY, ENVIRONMENT), verify);

    expect(verify).not.toHaveBeenCalled();
  });

  it('8b. una credencial privilegiada se rechaza sin llegar a verificarse', async () => {
    const verify = vi.fn(async () => verified);
    const actor = await resolveActor(
      classifyCredential(LEGACY_SERVICE_ROLE_KEY, ENVIRONMENT),
      verify,
    );

    expect(verify).not.toHaveBeenCalled();
    expect(actor).toEqual({ ok: false, code: 'PRIVILEGED_CREDENTIAL' });
  });

  it('8c. un token que Supabase resuelve como service_role no actúa como cliente', async () => {
    const verify = vi.fn(async () => ({ id: 'x', phone: null, role: 'service_role' }));
    const actor = await resolveActor(classifyCredential(USER_JWT, ENVIRONMENT), verify);

    expect(actor).toEqual({ ok: false, code: 'PRIVILEGED_CREDENTIAL' });
  });
});

describe('Frontend — ninguna credencial privilegiada en el código del navegador', () => {
  const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  const appSources = Object.entries(sources).filter(([path]) => !path.includes('.test.'));

  it('8d. el bundle del frontend no referencia service_role ni claves secretas', () => {
    expect(appSources.length).toBeGreaterThan(0);

    const offenders = appSources.filter(
      ([, source]) =>
        source.includes('SERVICE_ROLE') ||
        source.includes('service_role') ||
        source.includes('sb_secret_'),
    );

    expect(offenders.map(([path]) => path)).toEqual([]);
  });

  it('el frontend solo lee variables VITE_ públicas', () => {
    const offenders = appSources.filter(([, source]) =>
      /import\.meta\.env\.(?!DEV|PROD|MODE|SSR|BASE_URL|VITE_)[A-Z_]+/.test(source),
    );

    expect(offenders.map(([path]) => path)).toEqual([]);
  });
});
