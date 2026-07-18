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
import type { CartItem } from '../../types/domain';

const STORAGE_KEY = 'chorizos-cart-v3';

type State = Record<string, number>;
type Action =
  | { type: 'set'; productId: string; quantity: number }
  | { type: 'increment'; productId: string }
  | { type: 'decrement'; productId: string }
  | { type: 'replace'; items: CartItem[] }
  | { type: 'clear' };

const safeInitialState = (): State => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { version?: number; items?: CartItem[] };
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) return {};
    return Object.fromEntries(
      parsed.items
        .filter((item) => typeof item.productId === 'string' && Number.isInteger(item.quantity))
        .map((item) => [item.productId, Math.max(0, Math.min(999, item.quantity))]),
    );
  } catch {
    return {};
  }
};

const reducer = (state: State, action: Action): State => {
  if (action.type === 'clear') return {};
  if (action.type === 'replace') {
    return Object.fromEntries(action.items.map((item) => [item.productId, item.quantity]));
  }
  const current = state[action.productId] ?? 0;
  const next =
    action.type === 'increment'
      ? current + 1
      : action.type === 'decrement'
        ? current - 1
        : action.quantity;
  const quantity = Math.max(0, Math.min(999, Math.trunc(next)));
  const copy = { ...state };
  if (quantity === 0) delete copy[action.productId];
  else copy[action.productId] = quantity;
  return copy;
};

interface CartContextValue {
  quantities: State;
  items: CartItem[];
  units: number;
  setQuantity: (productId: string, quantity: number) => void;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  replace: (items: CartItem[]) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [quantities, dispatch] = useReducer(reducer, undefined, safeInitialState);

  useEffect(() => {
    try {
      const items = Object.entries(quantities).map(([productId, quantity]) => ({
        productId,
        quantity,
      }));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, items }));
    } catch {
      // El carrito sigue funcionando en memoria si el navegador bloquea almacenamiento.
    }
  }, [quantities]);

  const items = useMemo(
    () => Object.entries(quantities).map(([productId, quantity]) => ({ productId, quantity })),
    [quantities],
  );
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
  const replace = useCallback((next: CartItem[]) => dispatch({ type: 'replace', items: next }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  return (
    <CartContext.Provider
      value={{ quantities, items, units, setQuantity, increment, decrement, replace, clear }}
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
