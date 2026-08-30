/**
 * @file stores/syncStore.ts
 * @description Zustand store for sync state and Supabase Realtime connection management.
 */

import { create } from 'zustand';
import type { SyncState, SyncConflict } from '@/types/sync';
import { createLogger } from '@/lib/logger';

const log = createLogger('sync');

interface SyncStoreState {
  syncState: SyncState;
  isOnline: boolean;
  conflicts: SyncConflict[];
  lastSyncAt: string | null;
  pendingEventCount: number;
  error: string | null;

  setSyncState: (state: SyncState) => void;
  setOnline: (online: boolean) => void;
  addConflict: (conflict: SyncConflict) => void;
  resolveConflict: (conflictId: string) => void;
  setLastSyncAt: (timestamp: string) => void;
  setPendingCount: (count: number) => void;
  setError: (error: string | null) => void;
}

export const useSyncStore = create<SyncStoreState>((set) => ({
  syncState: 'idle',
  isOnline: true, // Always start optimistic (true). useOffline hook sets real value after mount via navigator.onLine.
  conflicts: [],
  lastSyncAt: null,
  pendingEventCount: 0,
  error: null,

  setSyncState: (state: SyncState) => {
    log.debug('sync_state_change', `Sync state → ${state}`);
    set({ syncState: state });
  },

  setOnline: (online: boolean) => {
    log.info(online ? 'network_online' : 'network_offline', `Network ${online ? 'connected' : 'disconnected'}`);
    set({ isOnline: online, syncState: online ? 'idle' : 'offline' });
  },

  addConflict: (conflict: SyncConflict) => {
    log.warn('sync_conflict_added', `Conflict detected for record ${conflict.record_id}`);
    set((state) => ({
      conflicts: [...state.conflicts, conflict],
      syncState: 'conflict',
    }));
  },

  resolveConflict: (conflictId: string) => {
    set((state) => {
      const remaining = state.conflicts.filter((c) => c.id !== conflictId);
      return {
        conflicts: remaining,
        syncState: remaining.length > 0 ? 'conflict' : 'idle',
      };
    });
  },

  setLastSyncAt: (timestamp: string) => {
    set({ lastSyncAt: timestamp });
  },

  setPendingCount: (count: number) => {
    set({ pendingEventCount: count });
  },

  setError: (error: string | null) => {
    set({ error, syncState: error ? 'error' : 'idle' });
  },
}));
