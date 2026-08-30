/**
 * @file hooks/useOffline.ts
 * @description Hook for online/offline detection and automatic offline replay.
 *
 * WHY THIS FILE EXISTS:
 * The browser's navigator.onLine property and the 'online'/'offline' window
 * events allow us to detect when the user's network connectivity changes.
 * When the device goes from offline → online, any SRS updates that were
 * queued in IndexedDB's pending_events store need to be replayed to Supabase.
 *
 * CAVEAT — navigator.onLine is unreliable:
 * navigator.onLine returns true if the browser believes there is a network
 * connection, but it does NOT verify that the connection reaches the internet.
 * On captive portal Wi-Fi (airports, hotels), navigator.onLine = true but
 * actual network requests fail. We treat onLine as a HINT, not ground truth.
 * The actual Supabase pushes will fail gracefully if the hint is wrong.
 *
 * USAGE:
 *   const { isOnline } = useOffline();
 *   // isOnline is reactive — changes trigger re-render
 *
 * Call this once at the layout level (app/layout.tsx) so it's always active.
 * Do NOT call it in individual pages — the replay only needs to run once.
 */

'use client';

import { useState, useEffect } from 'react';
import { replayPendingEvents } from '@/lib/offlineReplay';
import { useSyncStore } from '@/stores/syncStore';
import { createLogger } from '@/lib/logger';

const log = createLogger('sync');

// =============================================================================
// Return Type
// =============================================================================

/**
 * UseOfflineReturn — the object returned by useOffline().
 *
 * Fields:
 *   isOnline  — Current network status. True if the browser reports network
 *               connectivity (see caveat above about reliability).
 */
export interface UseOfflineReturn {
  isOnline: boolean;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * useOffline — track network connectivity and trigger offline event replay.
 *
 * Behaviour:
 *   - Initialises isOnline from navigator.onLine (safe for SSR via guard)
 *   - Listens to window 'online' event: sets isOnline=true, triggers replay
 *   - Listens to window 'offline' event: sets isOnline=false
 *   - Cleans up both listeners on component unmount (no memory leaks)
 *
 * WHY trigger replay on 'online' event (not on a timer):
 * Event-driven replay is instant (fires within ~1 second of reconnect) and
 * does not burn battery/CPU while the user is online. A timer-based approach
 * would poll every N seconds unnecessarily.
 *
 * @returns  { isOnline: boolean }
 */
export function useOffline(): UseOfflineReturn {
  // Guard for SSR — navigator is not available server-side
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    // Sync store state on mount
    const initialOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    useSyncStore.getState().setOnline(initialOnline);

    // ── Online handler ───────────────────────────────────────────────────────
    const handleOnline = () => {
      log.info('network_online', 'Device is back online — replaying pending events');
      setIsOnline(true);
      useSyncStore.getState().setOnline(true);

      // Run replay in the background. Don't await — we don't want to block
      // the state update or show a loading state on the whole app just for replay.
      void replayPendingEvents().then(({ replayed, failed, discarded }) => {
        if (replayed > 0 || discarded > 0) {
          log.info('replay_summary', `Replayed ${replayed}, re-queued ${failed}, discarded ${discarded}`);
        }
      });
    };

    // ── Offline handler ──────────────────────────────────────────────────────
    const handleOffline = () => {
      log.info('network_offline', 'Device went offline — SRS updates will be queued');
      setIsOnline(false);
      useSyncStore.getState().setOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Also attempt replay on mount — in case events were queued in a
    // previous session that ended without reconnecting
    void replayPendingEvents();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []); // Empty deps — only register once, never re-run

  return { isOnline };
}
