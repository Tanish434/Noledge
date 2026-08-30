/**
 * @file stores/authStore.ts
 * @description Zustand store for Supabase auth state.
 *
 * Manages the current user session, login/logout flows, and auth state changes
 * from Supabase's onAuthStateChange subscription.
 *
 * Usage:
 *   const { user, session, signIn, signOut } = useAuthStore();
 *
 * The store is initialized in AppProviders.tsx where onAuthStateChange is
 * called once at mount to sync the initial session.
 */

import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { createLogger } from '@/lib/logger';

const log = createLogger('auth');

interface AuthStoreState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setSession: (session: Session | null) => void;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  signInWithOAuth: (provider: 'github' | 'google') => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthStoreState>((set) => ({
  user: null,
  session: null,
  isLoading: true,
  error: null,

  setSession: (session) => {
    set({
      session,
      user: session?.user ?? null,
      isLoading: false,
      error: null,
    });
    log.info('auth_session_set', session ? `User: ${session.user.email}` : 'Signed out');
  },

  signInWithEmail: async (email, password) => {
    set({ isLoading: true, error: null });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      log.warn('auth_sign_in_failed', error.message);
      set({ isLoading: false, error: error.message });
    } else {
      set({ session: data.session, user: data.user, isLoading: false, error: null });
    }
  },

  signUpWithEmail: async (email, password) => {
    set({ isLoading: true, error: null });
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      log.warn('auth_sign_up_failed', error.message);
      set({ isLoading: false, error: error.message });
    } else if (data.user && data.user.identities && data.user.identities.length === 0) {
      const errMsg = 'User already registered. Please sign in instead.';
      log.warn('auth_user_exists', errMsg);
      set({ isLoading: false, error: errMsg });
    } else {
      set({ session: data.session, user: data.user, isLoading: false, error: null });
    }
  },

  signInWithMagicLink: async (email) => {
    set({ isLoading: true, error: null });
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      log.error('auth_magic_link_failed', error.message, error);
      set({ isLoading: false, error: error.message });
    } else {
      set({ isLoading: false });
    }
  },

  signInWithOAuth: async (provider) => {
    set({ isLoading: true, error: null });
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        queryParams: {
          prompt: 'select_account',
        },
      },
    });
    if (error) {
      log.error('auth_oauth_failed', error.message, error);
      set({ isLoading: false, error: error.message });
    }
  },

  signOut: async () => {
    set({ user: null, session: null, isLoading: true });
    try {
      await supabase.auth.signOut();
    } catch (e) {
      log.error('auth_signout_failed', 'Error during Supabase signout', e);
    }
    if (typeof window !== 'undefined') {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (err) {
        log.error('storage_clear_failed', 'Failed to clear local storage', err);
      }
    }
    set({ isLoading: false, error: null });
    log.info('auth_signed_out', 'User signed out & local storage wiped');
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  },

  clearError: () => set({ error: null }),
}));
