/**
 * @file lib/supabase.ts
 * @description Supabase client singleton for browser and server usage.
 *
 * Browser client:  used by React components and Zustand stores.
 * Server client:   used by API route handlers (uses service role key for elevated access).
 *
 * Why singleton pattern?
 *   Supabase maintains a WebSocket connection for Realtime. Creating multiple
 *   instances would open multiple sockets. The singleton ensures one connection
 *   per tab regardless of how many modules import the client.
 *
 * Environment variables (set in .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL      — Supabase project URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY — Public anon key (safe to expose)
 *   SUPABASE_SERVICE_ROLE_KEY     — Service role key (server-only, never in browser)
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn(
    '[Noledge] Supabase env vars not set. Cloud sync will be disabled. ' +
    'Copy .env.example → .env.local and fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

/**
 * supabase — the browser-safe Supabase client.
 *
 * Safe to import in any React component or Zustand store.
 * Uses the anon key — respects Row Level Security (RLS) policies.
 */
const globalForSupabase = globalThis as unknown as {
  supabaseClient?: ReturnType<typeof createClient<Database>>;
};

export const supabase =
  globalForSupabase.supabaseClient ??
  createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'noledge:auth',
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForSupabase.supabaseClient = supabase;
}

/**
 * createServerSupabaseClient — create a service-role Supabase client for API routes.
 *
 * IMPORTANT: Only call this in Next.js API route handlers (server-side).
 * Never import this in client components — it would expose the service key.
 *
 * @returns A Supabase client with elevated (service role) permissions.
 */
export function createServerSupabaseClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  return createClient<Database>(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
