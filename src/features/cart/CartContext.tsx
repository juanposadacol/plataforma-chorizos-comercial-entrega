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
import type { CartItem } from '../../types/domain';

const STORAGE_KEY = 'chorizos-cart-v4';

interface State {
  quantities: Record<string, number>;
  packSizes: Record<string, PackSize>;
}

type Action =
  | { type: 'set'; productId: string; quantity: number }
  | { type: 'increment'; productId: string }
  | { type: 'decrement'; productId: string }
  | { type: 'pack'; productId: string; packSize: PackSize }
  | { type: 'replace'; items: CartItem[] }
  | { type: 'clear' };

const emptyState: State = { quantities: {}, packSizes: {} };

const safeInitialState = (): State => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState;
    const parsed = JSON.parse(raw) as { version?: number; items?: CartItem[] };
    if (parsed.version !== 2 || !Array.isArray(parsed.items)) return emptyState;
    const valid = parsed.items.filter(
      (item) => typeof item.productId === 'string' && Number.isInteger(item.quantity),
    );
    return {
      quantities: Object.fromEntries(
        valid.map((item) => [item.productId, Math.max(0, Math.min(999, item.quantity))]),
      ),
      packSizes: Object.fromEntries(
        valid.map((item) => [
          item.productId,
          isPackSize(item.packSize) ? item.packSize : DEFAULT_PACK_SIZE,
        ]),
      ),
    };
  } catch {
    return emptyState;
  }
};

const reducer = (state: State, action: Action): State => {
  if (action.type === 'clear') return emptyState;
  if (action.type === 'replace') {
    return {
      quantities: Object.fromEntries(action.items.map((item) => [item.productId, item.quantity])),
      packSizes: Object.fromEntries(
        action.items.map((item) => [
          item.productId,
          isPackSize(item.packSize) ? item.packSize : DEFAULT_PACK_SIZE,
        ]),
      ),
    };
  }
  if (action.type === 'pack') {
    return { ...state, packSizes: { ...state.packSizes, [action.productId]: action.packSize } };
  }
  const current = state.quantities[action.productId] ?? 0;
  const next =
    action.type === 'increment'
      ? current + 1
      : action.type === 'decrement'
        ? current - 1
        : action.quantity;
  const quantity = Math.max(0, Math.min(999, Math.trunc(next)));
  const quantities = { ...state.quantities };
  const packSizes = { ...state.packSizes };
  if (quantity === 0) {
    delete quantities[action.productId];
    delete packSizes[action.productId];
  } else {
    quantities[action.productId] = quantity;
    packSizes[action.productId] = packSizes[action.productId] ?? DEFAULT_PACK_SIZE;
  }
  return { quantities, packSizes };
};

interface CartContextValue {
  quantities: Record<string, number>;
  packSizes: Record<string, PackSize>;
  items: CartItem[];
  units: number;
  setQuantity: (productId: string, quantity: number) => void;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  setPackSize: (productId: string, packSize: PackSize) => void;
  replace: (items: CartItem[]) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, safeInitialState);
  const { quantities, packSizes } = state;

  const items = useMemo(
    () =>
      Object.entries(quantities).map(([productId, quantity]) => ({
        productId,
        quantity,
        packSize: packSizes[productId] ?? DEFAULT_PACK_SIZE,
      })),
    [quantities, packSizes],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, items }));
    } catch {
      // El carrito sigue funcionando en memoria si el navegador bloquea almacenamiento.
    }
  }, [items]);

  const units = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);
  const setQuantity = useCallback(
    (productId: string, quantity: number) => dispatch({ type: 'set', productId, quantity }),
    [],
  );
  const increment = useCallback(
    (productId: string) => dispatch({ type: 'increment', productId }),
    [],
  );
  const decrement = useCallback(
    (productId: string) => dispatch({ type: 'decrement', productId }),
    [],
  );
  const setPackSize = useCallback(
    (productId: string, packSize: PackSize) => dispatch({ type: 'pack', productId, packSize }),
    [],
  );
  const replace = useCallback((next: CartItem[]) => dispatch({ type: 'replace', items: next }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  return (
    <CartContext.Provider
      value={{
        quantities,
        packSizes,
        items,
        units,
        setQuantity,
        increment,
        decrement,
        setPackSize,
        replace,
        clear,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export const useCart = (): CartContextValue => {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart debe usarse dentro de CartProvider');
  return value;
};
