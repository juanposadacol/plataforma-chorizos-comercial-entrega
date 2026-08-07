import { describe, expect, it } from 'vitest';
import type { ProductPrice } from '../types';
import { changedPrices, findTodayRow, pickEffectivePrices } from './priceMatrix';

const TODAY = '2026-08-07';
const LIST = 'lista-publica';

const price = (partial: Partial<ProductPrice> & { id: string; product_id: string }): ProductPrice =>
  ({
    price_list_id: LIST,
    unit_price: 17300,
    valid_from: '2026-01-01',
    is_active: true,
    ...partial,
  }) as ProductPrice;

describe('matriz de precios por lista', () => {
  it('toma la versión más reciente vigente de cada producto', () => {
    const rows = [
      price({ id: 'a1', product_id: 'p1', unit_price: 15000, valid_from: '2026-01-01' }),
      price({ id: 'a2', product_id: 'p1', unit_price: 17300, valid_from: '2026-07-01' }),
    ];
    expect(pickEffectivePrices(rows, LIST, TODAY).p1?.unit_price).toBe(17300);
  });

  it('ignora versiones futuras, inactivas, borradas y de otra lista', () => {
    const rows = [
      price({ id: 'a1', product_id: 'p1', unit_price: 17300 }),
      price({ id: 'a2', product_id: 'p1', unit_price: 99000, valid_from: '2026-12-01' }),
      price({ id: 'a3', product_id: 'p2', unit_price: 50000, is_active: false }),
      price({ id: 'a4', product_id: 'p3', unit_price: 50000, deleted_at: '2026-05-01' }),
      price({ id: 'a5', product_id: 'p4', unit_price: 50000, price_list_id: 'otra' }),
    ];
    const effective = pickEffectivePrices(rows, LIST, TODAY);
    expect(effective.p1?.unit_price).toBe(17300);
    expect(effective.p2).toBeUndefined();
    expect(effective.p3).toBeUndefined();
    expect(effective.p4).toBeUndefined();
  });

  it('descarta versiones ya vencidas', () => {
    const rows = [price({ id: 'a1', product_id: 'p1', valid_until: '2026-06-30' })];
    expect(pickEffectivePrices(rows, LIST, TODAY).p1).toBeUndefined();
  });

  it('encuentra la fila de hoy para actualizarla en vez de duplicarla', () => {
    const rows = [
      price({ id: 'vieja', product_id: 'p1', valid_from: '2026-01-01' }),
      price({ id: 'hoy', product_id: 'p1', valid_from: TODAY }),
    ];
    expect(findTodayRow(rows, LIST, 'p1', TODAY)?.id).toBe('hoy');
    expect(findTodayRow(rows, LIST, 'p2', TODAY)).toBeUndefined();
  });

  it('solo reporta los precios que cambiaron', () => {
    const effective = pickEffectivePrices(
      [
        price({ id: 'a1', product_id: 'p1', unit_price: 17300 }),
        price({ id: 'a2', product_id: 'p2', unit_price: 12000 }),
      ],
      LIST,
      TODAY,
    );
    expect(changedPrices({ p1: '17300', p2: '13000', p3: '' }, effective)).toEqual([
      { productId: 'p2', unitPrice: 13000 },
    ]);
  });

  it('acepta un precio nuevo para un producto que aún no está en la lista', () =>
    expect(changedPrices({ p9: '9000' }, {})).toEqual([{ productId: 'p9', unitPrice: 9000 }]));
});
