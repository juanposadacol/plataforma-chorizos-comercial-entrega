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
import { normalizeColombianPhone } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { StaffAccess } from '../../types/domain';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  access: StaffAccess;
  sendOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, token: string) => Promise<void>;
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
    if (error || !data) return setAccess(defaultAccess);
    const value = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
    const roles = Array.isArray(value.roles) ? value.roles.map(String) : [];
    const permissions = Array.isArray(value.permissions) ? value.permissions.map(String) : [];
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

  const sendOtp = useCallback(async (phone: string) => {
    if (!supabase) throw new Error('Supabase no está configurado.');
    const { error } = await supabase.auth.signInWithOtp({
      phone: `+${normalizeColombianPhone(phone)}`,
    });
    if (error) throw error;
  }, []);

  const verifyOtp = useCallback(async (phone: string, token: string) => {
    if (!supabase) throw new Error('Supabase no está configurado.');
    const { error } = await supabase.auth.verifyOtp({
      phone: `+${normalizeColombianPhone(phone)}`,
      token,
      type: 'sms',
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      access,
      sendOtp,
      verifyOtp,
      signOut,
      refreshAccess,
    }),
    [session, loading, access, sendOtp, verifyOtp, signOut, refreshAccess],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return value;
};
