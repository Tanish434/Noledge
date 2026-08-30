/**
 * @file defaultDeckManager.ts
 * @description Manages default test deck ("test.json") auto-seeding and account-linked permanent removal.
 */

import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';

export const DEFAULT_DECK_ID = 'default-test-deck-id';
export const DEFAULT_SOURCE_ID = 'default-test-source-id';
export const DEFAULT_DECK_NAME = 'Test';

/**
 * Check if the default deck ("test.json") has been permanently removed by this user account.
 */
export function isDefaultDeckDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const user = useAuthStore.getState().user;
    if (user) {
      if (user.user_metadata?.dismissed_default_deck === true) return true;
      if (localStorage.getItem(`noledge_dismissed_default_deck_${user.id}`) === 'true') return true;
    }
    return localStorage.getItem('noledge_dismissed_default_deck_guest') === 'true';
  } catch {
    return false;
  }
}

/**
 * Permanently mark the default deck ("test.json") as removed for this user account and device.
 */
export async function dismissDefaultDeckPermanently(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const user = useAuthStore.getState().user;
    if (user) {
      localStorage.setItem(`noledge_dismissed_default_deck_${user.id}`, 'true');
      try {
        await supabase.auth.updateUser({
          data: { dismissed_default_deck: true },
        });
      } catch (e) {
        console.warn('[DefaultDeck] Failed to update user metadata in Supabase:', e);
      }
    }
    localStorage.setItem('noledge_dismissed_default_deck_guest', 'true');
  } catch {
    localStorage.setItem('noledge_dismissed_default_deck_guest', 'true');
  }
}
