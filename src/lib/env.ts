const clean = (value: string | undefined) => value?.trim() ?? '';

export const env = {
  supabaseUrl: clean(import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: clean(import.meta.env.VITE_SUPABASE_ANON_KEY),
  appUrl:
    clean(import.meta.env.VITE_APP_URL) ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'),
  demoMode: clean(import.meta.env.VITE_ENABLE_DEMO_DATA).toLowerCase() === 'true',
};

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
