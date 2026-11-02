import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL || (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_URL : undefined);
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_ANON_KEY : undefined);

/**
 * Indicates whether valid Supabase environment variables have been provided.
 */
export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl.trim() !== '' &&
  supabaseAnonKey.trim() !== '' &&
  supabaseUrl !== 'https://your-project-id.supabase.co' &&
  supabaseAnonKey !== 'your-anon-key-here'
);

const rawClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/**
 * Retrieves the initialized Supabase client.
 * Throws a descriptive configuration error if required environment variables are absent.
 */
export function getSupabaseClient() {
  if (!rawClient) {
    throw new Error(
      '[TFH Configuration Error] Supabase client is not configured. ' +
      'Please copy .env.example to .env and provide valid VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY values.'
    );
  }
  return rawClient;
}

/**
 * Transparent proxy around the Supabase client.
 * Provides clear developer feedback on invocation if environment variables are not configured.
 */
export const supabase = new Proxy({}, {
  get(_target, prop) {
    const client = getSupabaseClient();
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export default supabase;
