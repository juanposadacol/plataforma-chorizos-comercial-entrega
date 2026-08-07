/**
 * Presentaciones disponibles para cada tipo de producto.
 * El paquete pesa lo mismo en las cuatro versiones, solo cambia en cuántas
 * unidades viene dividido, así que el precio y el inventario no cambian.
 */
export const PACK_SIZE_OPTIONS = [3, 4, 6, 10] as const;

export type PackSize = (typeof PACK_SIZE_OPTIONS)[number];

export const DEFAULT_PACK_SIZE: PackSize = 4;

export const isPackSize = (value: unknown): value is PackSize =>
  PACK_SIZE_OPTIONS.some((option) => option === value);

export const packSizeLabel = (size: PackSize): string => `${size} unidades`;

/** Quita el "· 4 unidades" heredado del catálogo: la presentación ahora la elige el cliente. */
export const basePresentation = (presentation: string): string =>
  presentation
    .replace(/\d+\s*unidades?/i, '')
    .replace(/[·|,\-/]+\s*$/, '')
    .replace(/^\s*[·|,\-/]+/, '')
    .trim() || presentation;

/**
 * Resumen legible que viaja con el pedido para que el negocio sepa cómo empacar
 * cada línea. Se antepone a las observaciones del cliente.
 */
export const buildPackNote = (
  lines: Array<{ name: string; quantity: number; packSize: PackSize }>,
): string => {
  const detail = lines
    .filter((line) => line.quantity > 0)
    .map((line) => `${line.name} x${line.quantity} (${packSizeLabel(line.packSize)})`)
    .join('; ');
  return detail ? `Presentación: ${detail}` : '';
};
