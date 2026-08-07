import type { ProductPrice } from '../types';
import { toNumber } from '../utils';

/**
 * `product_prices` es una tabla versionada: cada cambio agrega una fila nueva con
 * su `valid_from` y el servidor resuelve el precio con
 * `order by valid_from desc, created_at desc limit 1`
 * (202607170002_transactional_api.sql). Esta función reproduce esa misma regla en
 * el panel para que la matriz muestre exactamente lo que cobrará el servidor.
 */
export const pickEffectivePrices = (
  rows: ProductPrice[],
  listId: string,
  today: string,
): Record<string, ProductPrice> => {
  const best: Record<string, ProductPrice> = {};
  rows
    .filter(
      (row) =>
        row.price_list_id === listId &&
        !row.variant_id &&
        !row.deleted_at &&
        row.is_active !== false &&
        (!row.valid_from || row.valid_from <= today) &&
        (!row.valid_until || row.valid_until >= today),
    )
    .forEach((row) => {
      const current = best[row.product_id];
      if (!current) {
        best[row.product_id] = row;
        return;
      }
      const key = (price: ProductPrice) =>
        `${price.valid_from ?? ''}|${String(price.created_at ?? '')}`;
      if (key(row) > key(current)) best[row.product_id] = row;
    });
  return best;
};

/** Fila vigente de HOY, la única que puede actualizarse sin romper el índice único por fecha. */
export const findTodayRow = (
  rows: ProductPrice[],
  listId: string,
  productId: string,
  today: string,
): ProductPrice | undefined =>
  rows.find(
    (row) =>
      row.price_list_id === listId &&
      row.product_id === productId &&
      !row.variant_id &&
      !row.deleted_at &&
      row.valid_from === today,
  );

/** Precios que realmente cambiaron: evita crear versiones nuevas idénticas. */
export const changedPrices = (
  draft: Record<string, string>,
  effective: Record<string, ProductPrice>,
): Array<{ productId: string; unitPrice: number }> =>
  Object.entries(draft)
    .filter(([, value]) => value !== '' && value !== undefined)
    .map(([productId, value]) => ({ productId, unitPrice: Number(value) }))
    .filter(
      ({ productId, unitPrice }) =>
        Number.isFinite(unitPrice) &&
        unitPrice >= 0 &&
        unitPrice !== toNumber(effective[productId]?.unit_price),
    );
