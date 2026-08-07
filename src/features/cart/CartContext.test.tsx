// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { CartProvider, cartLineKey, useCart } from './CartContext';
import { mergeLinesByProduct } from '../../domain/packs';

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

const ARGENTINO = 'argentino-id';
const JALAPENO = 'jalapeno-id';

const setup = () =>
  renderHook(() => useCart(), {
    wrapper: ({ children }) => <CartProvider>{children}</CartProvider>,
  });

// El caso reportado: "si quiero 4 chorizos argentinos de 3 unidades y 5 chorizos
// argentinos de 10 unidades, el carrito no diferencia eso".
describe('el carrito distingue presentaciones del mismo producto', () => {
  it('4 paquetes de 3 unidades y 5 de 10 conviven como dos líneas', () => {
    const { result } = setup();

    act(() => result.current.setQuantity(ARGENTINO, 3, 4));
    act(() => result.current.setQuantity(ARGENTINO, 10, 5));

    expect(result.current.lines).toEqual([
      { key: cartLineKey(ARGENTINO, 3), productId: ARGENTINO, packSize: 3, quantity: 4 },
      { key: cartLineKey(ARGENTINO, 10), productId: ARGENTINO, packSize: 10, quantity: 5 },
    ]);
    expect(result.current.quantityOf(ARGENTINO, 3)).toBe(4);
    expect(result.current.quantityOf(ARGENTINO, 10)).toBe(5);
    expect(result.current.unitsOfProduct(ARGENTINO)).toBe(9);
    expect(result.current.units).toBe(9);
  });

  it('sumar o restar una presentación no toca la otra', () => {
    const { result } = setup();
    act(() => result.current.setQuantity(ARGENTINO, 3, 4));
    act(() => result.current.setQuantity(ARGENTINO, 10, 5));

    act(() => result.current.increment(ARGENTINO, 3));
    act(() => result.current.decrement(ARGENTINO, 10));

    expect(result.current.quantityOf(ARGENTINO, 3)).toBe(5);
    expect(result.current.quantityOf(ARGENTINO, 10)).toBe(4);
  });

  it('una línea desaparece al llegar a cero, y la otra sigue', () => {
    const { result } = setup();
    act(() => result.current.setQuantity(ARGENTINO, 3, 1));
    act(() => result.current.setQuantity(ARGENTINO, 10, 5));

    act(() => result.current.decrement(ARGENTINO, 3));

    expect(result.current.quantityOf(ARGENTINO, 3)).toBe(0);
    expect(result.current.linesOfProduct(ARGENTINO)).toHaveLength(1);
  });

  it('se puede quitar una presentación concreta desde el resumen', () => {
    const { result } = setup();
    act(() => result.current.setQuantity(ARGENTINO, 3, 4));
    act(() => result.current.setQuantity(ARGENTINO, 10, 5));

    act(() => result.current.removeLine(cartLineKey(ARGENTINO, 10)));

    expect(result.current.linesOfProduct(ARGENTINO)).toHaveLength(1);
    expect(result.current.quantityOf(ARGENTINO, 3)).toBe(4);
  });

  it('cambiar la presentación activa no borra lo ya agregado', () => {
    const { result } = setup();
    act(() => result.current.setQuantity(ARGENTINO, 3, 4));

    act(() => result.current.selectPackSize(ARGENTINO, 10));

    expect(result.current.selectedPack[ARGENTINO]).toBe(10);
    expect(result.current.quantityOf(ARGENTINO, 3)).toBe(4);
    // La presentación recién elegida arranca vacía para este producto.
    expect(result.current.quantityOf(ARGENTINO, 10)).toBe(0);
  });

  it('el pedido consolida las presentaciones en una línea por producto', () => {
    const { result } = setup();
    act(() => result.current.setQuantity(ARGENTINO, 3, 4));
    act(() => result.current.setQuantity(ARGENTINO, 10, 5));
    act(() => result.current.setQuantity(JALAPENO, 4, 2));

    // `create-order` rechaza product_id repetidos: 4 + 5 viajan como 9.
    expect(mergeLinesByProduct(result.current.lines)).toEqual([
      { product_id: ARGENTINO, quantity: 9 },
      { product_id: JALAPENO, quantity: 2 },
    ]);
  });

  it('sobrevive a recargar la página con todas sus presentaciones', () => {
    const first = setup();
    act(() => first.result.current.setQuantity(ARGENTINO, 3, 4));
    act(() => first.result.current.setQuantity(ARGENTINO, 10, 5));
    cleanup();

    const second = setup();
    expect(second.result.current.lines).toHaveLength(2);
    expect(second.result.current.quantityOf(ARGENTINO, 3)).toBe(4);
    expect(second.result.current.quantityOf(ARGENTINO, 10)).toBe(5);
  });

  it('«repetir pedido» agrupa por presentación y limpia con clear', () => {
    const { result } = setup();

    act(() =>
      result.current.replace([
        { productId: ARGENTINO, quantity: 2, packSize: 6 },
        { productId: ARGENTINO, quantity: 3, packSize: 6 },
        { productId: JALAPENO, quantity: 1 },
      ]),
    );

    expect(result.current.quantityOf(ARGENTINO, 6)).toBe(5);
    // Sin presentación explícita se usa la de por defecto (4 unidades).
    expect(result.current.quantityOf(JALAPENO, 4)).toBe(1);

    act(() => result.current.clear());
    expect(result.current.lines).toEqual([]);
  });

  it('exige el proveedor: usar el carrito fuera de él es un error de programación', () => {
    expect(() => render(<Broken />)).toThrow(/CartProvider/);
  });
});

function Broken() {
  useCart();
  return null;
}
