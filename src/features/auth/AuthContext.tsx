/* eslint-disable react-refresh/only-export-components */
import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '../../lib/supabase';
import type { StaffAccess } from '../../types/domain';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  access: StaffAccess;
  signOut: () => Promise<void>;
  refreshAccess: () => Promise<void>;
}

const defaultAccess: StaffAccess = { isStaff: false, roles: [], permissions: [] };
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [access, setAccess] = useState<StaffAccess>(defaultAccess);

  const refreshAccess = useCallback(async () => {
    if (!supabase) return setAccess(defaultAccess);
    const { data, error } = await supabase.rpc('get_my_access');
    if (error || !data) {
      // Degradar a "sin permisos" es lo correcto por seguridad, pero hacerlo en
      // silencio vuelve indistinguible «no tengo el rol» de «no se pudo leer el
      // rol»: un permiso ausente en la interfaz quedaba sin explicación. Solo en
      // desarrollo, y solo el código del error: nunca el token ni el usuario.
      if (import.meta.env.DEV) {
        console.warn('[auth] get_my_access no devolvió permisos', { code: error?.code ?? null });
      }
      return setAccess(defaultAccess);
    }
    const value = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
    const roles = Array.isArray(value.roles) ? value.roles.map(String) : [];
    const permissions = Array.isArray(value.permissions) ? value.permissions.map(String) : [];
    if (import.meta.env.DEV) {
      // Solo los códigos de rol (no son datos personales); permite verificar de
      // inmediato si la sesión trae 'superadmin'.
      console.info('[auth] roles cargados', roles);
    }
    setAccess({ isStaff: roles.some((role) => role !== 'customer'), roles, permissions });
  }, []);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      if (data.session) void refreshAccess();
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) void refreshAccess();
      else setAccess(defaultAccess);
    });
    return () => data.subscription.unsubscribe();
  }, [refreshAccess]);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      access,
      signOut,
      refreshAccess,
    }),
    [session, loading, access, signOut, refreshAccess],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return value;
};
