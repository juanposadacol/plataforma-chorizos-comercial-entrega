import { describe, expect, it } from 'vitest';
import { formatSqlDate } from './format';

// Regresión: el reporte "Ventas por día" mostraba una venta entregada el
// 2026-07-18 (Bogotá) como si hubiera ocurrido el 17/07/2026. Causa raíz:
// `formatAdminDate()` hacía `new Date("2026-07-18")`, que ECMA-262 interpreta
// como medianoche UTC. Al formatear ese instante en America/Bogota (UTC-5), la
// fecha retrocede al día calendario anterior. Una columna PostgreSQL DATE (sin
// hora ni zona horaria) no debe pasar nunca por una conversión de zona horaria:
// debe mostrarse exactamente como llegó de la base de datos. `formatSqlDate`
// nunca construye un objeto Date, así que es imposible que se vea afectada por
// la zona horaria del entorno de ejecución (incluida TZ=America/Bogota).
describe('formatSqlDate — columnas PostgreSQL DATE (sin hora/zona horaria)', () => {
  it('el caso reportado: 2026-07-18 se muestra como 18/07/2026, nunca 17/07/2026', () => {
    expect(formatSqlDate('2026-07-18')).toBe('18/07/2026');
    expect(formatSqlDate('2026-07-18')).not.toBe('17/07/2026');
  });

  it('formatea el primer día del mes correctamente', () =>
    expect(formatSqlDate('2026-07-01')).toBe('01/07/2026'));

  it('conserva el día exacto en un límite de año', () =>
    expect(formatSqlDate('2025-12-31')).toBe('31/12/2025'));

  it('conserva el día exacto en un año bisiesto (29 de febrero)', () =>
    expect(formatSqlDate('2028-02-29')).toBe('29/02/2028'));

  it('valores que no son una fecha SQL de tipo DATE se devuelven sin cambios', () => {
    expect(formatSqlDate('no-es-una-fecha')).toBe('no-es-una-fecha');
    // Un TIMESTAMPTZ tiene un componente de hora/zona y no debe pasar por aquí;
    // si llega uno, se devuelve intacto en vez de truncarlo silenciosamente.
    expect(formatSqlDate('2026-07-18T23:33:32.462341+00:00')).toBe(
      '2026-07-18T23:33:32.462341+00:00',
    );
  });

  it('no depende de la zona horaria del entorno: nunca construye un objeto Date ni usa Intl', () => {
    // formatSqlDate es una transformación puramente textual (regex + interpolación
    // de los mismos dígitos recibidos). No hay new Date(...) ni Intl.DateTimeFormat
    // en su implementación, así que el resultado no puede variar con TZ=America/Bogota,
    // TZ=UTC, o cualquier otra zona horaria del proceso que ejecute la prueba.
    expect(formatSqlDate.toString()).not.toMatch(/new Date\(/);
    expect(formatSqlDate.toString()).not.toMatch(/Intl\./);
    expect(formatSqlDate('2026-07-18')).toBe('18/07/2026');
  });
});
