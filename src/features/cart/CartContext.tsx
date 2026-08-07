/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import { DEFAULT_PACK_SIZE, isPackSize, type PackSize } from '../../domain/packs';
import type { CartItem, CartLine } from '../../types/domain';

const STORAGE_KEY = 'chorizos-cart-v5';
const STORAGE_VERSION = 3;
const MAX_LINE_QUANTITY = 999;

/**
 * Clave de una línea del carrito. El mismo producto en dos presentaciones son
 * dos líneas distintas: 4 paquetes de 3 unidades y 5 paquetes de 10 unidades
 * conviven sin sumarse ni pisarse.
 */
export const cartLineKey = (productId: string, packSize: PackSize): string =>
  `${productId}::${packSize}`;

interface State {
  /** Líneas del carrito indexadas por `cartLineKey`, en orden de agregado. */
  lines: Record<string, CartLine>;
  /** Presentación que la tarjeta de cada producto muestra seleccionada. */
  selectedPack: Record<string, PackSize>;
}

type Action =
  | { type: 'set'; productId: string; packSize: PackSize; quantity: number }
  | { type: 'increment'; productId: string; packSize: PackSize }
  | { type: 'decrement'; productId: string; packSize: PackSize }
  | { type: 'remove'; key: string }
  | { type: 'select'; productId: string; packSize: PackSize }
  | { type: 'replace'; items: CartItem[] }
  | { type: 'clear' };

const emptyState: State = { lines: {}, selectedPack: {} };

const packOf = (value: unknown): PackSize => (isPackSize(value) ? value : DEFAULT_PACK_SIZE);

const clampQuantity = (value: number): number =>
  Math.max(0, Math.min(MAX_LINE_QUANTITY, Math.trunc(value)));

const linesFromItems = (items: CartItem[]): Record<string, CartLine> => {
  const lines: Record<string, CartLine> = {};
  for (const item of items) {
    if (typeof item.productId !== 'string' || !item.productId) continue;
    const quantity = clampQuantity(Number(item.quantity));
    if (!quantity) continue;
    const packSize = packOf(item.packSize);
    const key = cartLineKey(item.productId, packSize);
    // Una lista de entrada con la misma presentación repetida se acumula.
    const current = lines[key]?.quantity ?? 0;
    lines[key] = {
      key,
      productId: item.productId,
      packSize,
      quantity: clampQuantity(current + quantity),
    };
  }
  return lines;
};

const selectionFromLines = (lines: Record<string, CartLine>): Record<string, PackSize> =>
  Object.fromEntries(Object.values(lines).map((line) => [line.productId, line.packSize]));

const safeInitialState = (): State => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState;
    const parsed = JSON.parse(raw) as { version?: number; items?: CartItem[] };
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.items)) return emptyState;
    const lines = linesFromItems(parsed.items);
    return { lines, selectedPack: selectionFromLines(lines) };
  } catch {
    return emptyState;
  }
};

const withQuantity = (state: State, productId: string, packSize: PackSize, next: number): State => {
  const key = cartLineKey(productId, packSize);
  const quantity = clampQuantity(next);
  const lines = { ...state.lines };
  if (quantity === 0) delete lines[key];
  else lines[key] = { key, productId, packSize, quantity };
  return { lines, selectedPack: { ...state.selectedPack, [productId]: packSize } };
};

const reducer = (state: State, action: Action): State => {
  if (action.type === 'clear') return emptyState;
  if (action.type === 'replace') {
    const lines = linesFromItems(action.items);
    return { lines, selectedPack: { ...state.selectedPack, ...selectionFromLines(lines) } };
  }
  if (action.type === 'select') {
    return {
      ...state,
      selectedPack: { ...state.selectedPack, [action.productId]: action.packSize },
    };
  }
  if (action.type === 'remove') {
    if (!state.lines[action.key]) return state;
    const lines = { ...state.lines };
    delete lines[action.key];
    return { ...state, lines };
  }
  const current = state.lines[cartLineKey(action.productId, action.packSize)]?.quantity ?? 0;
  const next =
    action.type === 'increment'
      ? current + 1
      : action.type === 'decrement'
        ? current - 1
        : action.quantity;
  return withQuantity(state, action.productId, action.packSize, next);
};

interface CartContextValue {
  /** Una línea por producto y presentación, en el orden en que se agregaron. */
  lines: CartLine[];
  /** Presentación seleccionada en la tarjeta de cada producto. */
  selectedPack: Record<string, PackSize>;
  /** Paquetes totales del carrito. */
  units: number;
  /** Cantidad de una presentación concreta. */
  quantityOf: (productId: string, packSize: PackSize) => number;
  /** Paquetes de un producto sumando todas sus presentaciones. */
  unitsOfProduct: (productId: string) => number;
  /** Líneas de un producto (todas sus presentaciones). */
  linesOfProduct: (productId: string) => CartLine[];
  setQuantity: (productId: string, packSize: PackSize, quantity: number) => void;
  increment: (productId: string, packSize: PackSize) => void;
  decrement: (productId: string, packSize: PackSize) => void;
  removeLine: (key: string) => void;
  /** Cambia la presentación activa de la tarjeta, sin tocar las líneas ya agregadas. */
  selectPackSize: (productId: string, packSize: PackSize) => void;
  replace: (items: CartItem[]) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, safeInitialState);
  const { lines: lineMap, selectedPack } = state;

  const lines = useMemo(() => Object.values(lineMap), [lineMap]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: STORAGE_VERSION,
          items: lines.map(({ productId, quantity, packSize }) => ({
            productId,
            quantity,
            packSize,
          })),
        }),
      );
    } catch {
      // El carrito sigue funcionando en memoria si el navegador bloquea almacenamiento.
    }
  }, [lines]);

  const units = useMemo(() => lines.reduce((sum, line) => sum + line.quantity, 0), [lines]);

  const quantityOf = useCallback(
    (productId: string, packSize: PackSize) =>
      lineMap[cartLineKey(productId, packSize)]?.quantity ?? 0,
    [lineMap],
  );
  const linesOfProduct = useCallback(
    (productId: string) => lines.filter((line) => line.productId === productId),
    [lines],
  );
  const unitsOfProduct = useCallback(
    (productId: string) =>
      lines.reduce((sum, line) => (line.productId === productId ? sum + line.quantity : sum), 0),
    [lines],
  );
  const setQuantity = useCallback(
    (productId: string, packSize: PackSize, quantity: number) =>
      dispatch({ type: 'set', productId, packSize, quantity }),
    [],
  );
  const increment = useCallback(
    (productId: string, packSize: PackSize) => dispatch({ type: 'increment', productId, packSize }),
    [],
  );
  const decrement = useCallback(
    (productId: string, packSize: PackSize) => dispatch({ type: 'decrement', productId, packSize }),
    [],
  );
  const removeLine = useCallback((key: string) => dispatch({ type: 'remove', key }), []);
  const selectPackSize = useCallback(
    (productId: string, packSize: PackSize) => dispatch({ type: 'select', productId, packSize }),
    [],
  );
  const replace = useCallback((next: CartItem[]) => dispatch({ type: 'replace', items: next }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  const value = useMemo(
    () => ({
      lines,
      selectedPack,
      units,
      quantityOf,
      unitsOfProduct,
      linesOfProduct,
      setQuantity,
      increment,
      decrement,
      removeLine,
      selectPackSize,
      replace,
      clear,
    }),
    [
      lines,
      selectedPack,
      units,
      quantityOf,
      unitsOfProduct,
      linesOfProduct,
      setQuantity,
      increment,
      decrement,
      removeLine,
      selectPackSize,
      replace,
      clear,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = (): CartContextValue => {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart debe usarse dentro de CartProvider');
  return value;
};
