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
 * Suma las líneas del carrito por producto para el pedido.
 *
 * El carrito distingue presentaciones (4 paquetes de 3 unidades y 5 de 10 son
 * dos líneas), pero el inventario y el precio son por producto y el contrato de
 * `create-order` rechaza `product_id` repetidos: aquí se consolidan en una sola
 * línea por producto. El desglose por presentación viaja aparte, en la nota que
 * arma `buildPackNote`. Conserva el orden en que se agregaron los productos.
 */
export const mergeLinesByProduct = <T extends { productId: string; quantity: number }>(
  lines: T[],
): Array<{ product_id: string; quantity: number }> => {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.quantity);
  }
  return [...totals.entries()].map(([product_id, quantity]) => ({ product_id, quantity }));
};

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
