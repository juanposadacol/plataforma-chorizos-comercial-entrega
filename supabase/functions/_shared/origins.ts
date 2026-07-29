// Lógica pura de la allowlist de orígenes (CORS).
//
// Este módulo no toca `Deno` ni ninguna API del runtime a propósito: así puede
// importarse desde Vitest en el proyecto de frontend y probarse sin desplegar.
// El acceso a variables de entorno vive en `http.ts`.

/** Quita espacios y barras finales: `https://sitio.app/` y `https://sitio.app` son el mismo origen. */
export function normalizeOrigin(origin: string | null | undefined): string {
  return (origin ?? '').trim().replace(/\/+$/, '');
}

/** Convierte el valor de `ALLOWED_ORIGINS` (lista separada por comas) en orígenes normalizados. */
export function parseOriginList(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
}

/**
 * ¿Puede este origen ejecutar la operación?
 *
 * Sin cabecera `Origin` se acepta: son llamadas servidor-a-servidor, donde CORS
 * no aplica y la autorización real la aportan la clave y las políticas de la BD.
 */
export function originIsAllowed(origin: string | null | undefined, allowed: string[]): boolean {
  if (origin === null || origin === undefined || origin === '') return true;
  if (allowed.includes('*')) return true;
  return allowed.includes(normalizeOrigin(origin));
}

/**
 * Valor de `access-control-allow-origin` para una respuesta normal.
 *
 * Falla cerrado: si el origen no está en la allowlist devuelve `'null'`, que
 * ningún navegador acepta. Nunca devuelve un origen distinto del solicitante,
 * porque eso no autoriza a nadie y solo confunde al depurar.
 */
export function resolveAllowedOrigin(origin: string | null | undefined, allowed: string[]): string {
  const candidate = normalizeOrigin(origin);
  if (candidate && allowed.includes(candidate)) return candidate;
  if (allowed.includes('*')) return '*';
  return 'null';
}

/**
 * Valor de `access-control-allow-origin` para una respuesta de RECHAZO.
 *
 * Devuelve el origen solicitante tal cual para que el navegador deje al cliente
 * leer el cuerpo `{ error: { code, message } }`. Esto no autoriza la operación
 * —la petición ya fue rechazada con 403— y no expone ningún dato: el único
 * contenido es el propio código de error. Sin esto, el navegador bloquea la
 * respuesta y el usuario recibe un mensaje genérico sin causa.
 */
export function resolveRejectionOrigin(origin: string | null | undefined): string {
  return normalizeOrigin(origin) || 'null';
}
