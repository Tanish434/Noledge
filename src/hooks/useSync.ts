/**
 * @file hooks/useSync.ts
 * @description Automatic sync scheduling hook for background data refresh.
 *
 * WHY THIS FILE EXISTS:
 * The sync engine (lib/syncEngine.ts) fetches fresh question data from
 * GitHub/Obsidian sources. We want this to run automatically in two cases:
 *   1. When the user switches back to the app (page visibility change)
 *   2. When the device reconnects to the internet
 *
 * We do NOT use setInterval (would fire even when the tab is hidden,
 * wasting battery and API rate limits). Instead, we use the Page Visibility
 * API and the 'online' event — event-driven sync is more efficient.
 *
 * MIN_SYNC_INTERVAL:
 * We enforce a minimum gap between syncs to avoid hammering the GitHub API
 * (rate limit: 5000 req/hour for authenticated users). If the user switches
 * tabs every 30 seconds, we should NOT sync every time. The minimum is 5
 * minutes (300,000ms).
 *
 * RETURN VALUE:
 * The hook returns the sync state and a manual trigger function so the UI
 * (e.g., a "Sync Now" button in settings) can trigger sync programmatically.
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { syncAll, triggerManualPickerSync } from '@/lib/syncEngine';
import { useSyncStore } from '@/stores/syncStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { createLogger } from '@/lib/logger';

const log = createLogger('sync');

// =============================================================================
// Constants
// =============================================================================

/**
 * MIN_SYNC_INTERVAL_MS — minimum time between automatic syncs.
 *
 * 5 minutes = 300,000ms. Below this threshold, visibility/online events
 * will not trigger a new sync (the last sync was too recent).
 */
const MIN_SYNC_INTERVAL_MS = 300_000;

// =============================================================================
// Return Type
// =============================================================================

/**
 * UseSyncReturn — object returned by useSync().
 *
 * Fields:
 *   isSyncing    — true while a sync is in progress (sourced from syncStore)
 *   lastSyncAt   — timestamp (ms) of the last successful sync, or null
 *   manualSync   — function to trigger a sync immediately (bypasses interval check)
 */
export interface UseSyncReturn {
  isSyncing: boolean;
  lastSyncAt: number | null;
  manualSync: () => Promise<{ synced: number; failed: number }>;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * useSync — register automatic sync triggers and expose sync controls.
 *
 * Registers two automatic triggers:
 *   1. visibilitychange → syncs when the user returns to the tab
 *   2. online           → syncs when connectivity is restored
 *
 * Both triggers check whether MIN_SYNC_INTERVAL_MS has elapsed since the
 * last sync before actually running syncAll().
 *
 * Should be called ONCE at the layout level (app/layout.tsx) — not in
 * individual pages, to ensure it always runs regardless of which route is active.
 *
 * @returns  UseSyncReturn — isSyncing, lastSyncAt, manualSync
 */
export function useSync(): UseSyncReturn {
  const { syncState, lastSyncAt } = useSyncStore();
  const { auto_sync, sync_interval_mins, sync_on_app_focus, sync_on_reconnect } = useSettingsStore();

  // isSyncing derived from syncState
  const isSyncing = syncState === 'syncing';

  // useRef to track last sync time — we use a ref (not state) because we
  // don't want to re-render when this changes. It's internal scheduling logic.
  const lastSyncAtRef = useRef<number | null>(
    lastSyncAt ? new Date(lastSyncAt).getTime() : null
  );

  // ── Run a sync if auto-sync is enabled and interval has passed ────────────
  const attemptSync = useCallback(
    async (reason: string) => {
      if (!auto_sync) {
        log.debug('sync_disabled', 'Auto-sync is disabled in settings');
        return;
      }

      const now = Date.now();
      const minIntervalMs = (sync_interval_mins || 5) * 60 * 1000;
      const timeSinceLast = lastSyncAtRef.current ? now - lastSyncAtRef.current : Infinity;

      if (timeSinceLast < minIntervalMs) {
        log.debug(
          'sync_skipped',
          `Skipping sync (${reason}): last sync was ${Math.round(timeSinceLast / 1000)}s ago`
        );
        return;
      }

      log.info('sync_triggered', `Auto-sync triggered: ${reason}`);
      try {
        await triggerManualPickerSync();
        lastSyncAtRef.current = Date.now();
      } catch (err) {
        log.error('sync_failed', `Auto-sync failed (${reason})`, err);
      }
    },
    [auto_sync, sync_interval_mins]
  );

  // ── Manual sync (no interval check) ──────────────────────────────────────
  const manualSync = useCallback(async (): Promise<{ synced: number; failed: number }> => {
    log.info('sync_manual', 'Manual sync triggered');
    try {
      const res = await triggerManualPickerSync();
      lastSyncAtRef.current = Date.now();
      return res;
    } catch (err) {
      log.error('sync_manual_failed', 'Manual sync failed', err);
      return { synced: 0, failed: 1 };
    }
  }, []);

  useEffect(() => {
    // ── Visibility change handler ─────────────────────────────────────────
    const handleVisibilityChange = () => {
      if (sync_on_app_focus && document.visibilityState === 'visible') {
        void attemptSync('visibility_restored');
      }
    };

    // ── Online reconnect handler ──────────────────────────────────────────
    const handleOnline = () => {
      if (sync_on_reconnect) {
        lastSyncAtRef.current = null;
        void attemptSync('online_reconnect');
      }
    };

    // ── Periodic interval timer handler ────────────────────────────────────
    let timerId: NodeJS.Timeout | undefined;
    if (auto_sync && sync_interval_mins > 0) {
      const intervalMs = Math.max(1, sync_interval_mins) * 60 * 1000;
      timerId = setInterval(() => {
        void attemptSync('interval_timer');
      }, intervalMs);
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      if (timerId) clearInterval(timerId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [attemptSync, auto_sync, sync_interval_mins, sync_on_app_focus, sync_on_reconnect]);

  return {
    isSyncing,
    lastSyncAt: lastSyncAtRef.current,
    manualSync,
  };
}
