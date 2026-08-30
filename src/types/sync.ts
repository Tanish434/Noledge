/**
 * @file sync.ts
 * @description Types for the real-time sync system between devices via Supabase.
 *
 * Noledge uses Supabase Realtime (WebSocket-based PostgreSQL change feed) to
 * keep all devices in sync. This file defines the event shapes, conflict
 * records, and sync log entries that flow through that channel.
 *
 * Sync architecture summary:
 *   - Each device subscribes to Supabase Realtime on the `sync_events` channel
 *   - Changes (new questions, updated SRS data, deck changes) emit events
 *   - Events are applied optimistically to the local IndexedDB cache
 *   - On conflict (same question edited on two devices simultaneously), the
 *     ConflictResolver component presents both versions to the user
 *
 * The sync system is designed around the CAP theorem trade-off:
 * Noledge chooses Availability + Partition Tolerance over strict Consistency.
 * The device is always usable offline. Conflicts are resolved lazily when
 * connectivity returns, not eagerly at write time.
 */

// =============================================================================
// Sync Event Types
// =============================================================================

/**
 * SyncEventType — the operation that triggered a sync event.
 *
 * Maps directly to SQL DML operations on the Supabase tables:
 *   'INSERT' — a new record was created
 *   'UPDATE' — an existing record was modified
 *   'DELETE' — a record was removed
 */
export type SyncEventType = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * SyncTableName — which Supabase table the event comes from.
 *
 * Only tables that participate in sync emit events. The `sync_log` table
 * itself does not emit events (that would cause infinite loops).
 */
export type SyncTableName = 'questions' | 'decks' | 'study_sessions';

/**
 * SyncEvent — a single change event broadcast via Supabase Realtime.
 *
 * Received by all connected devices in the same user's session channel.
 * Each device applies the event to its local state if the `device_id`
 * doesn't match its own (to avoid re-applying its own changes).
 *
 * Fields:
 *   id          — UUID of this event record (stored in sync_log table)
 *   table       — Which table changed
 *   event_type  — INSERT / UPDATE / DELETE
 *   record_id   — ID of the affected record in that table
 *   payload     — The new data (INSERT/UPDATE) or null (DELETE)
 *   device_id   — The device that originated this change. Each device has a
 *                 stable UUID in localStorage that it stamps on every event.
 *   user_id     — Supabase auth user ID
 *   timestamp   — ISO 8601 server-side timestamp (from Supabase trigger)
 *   vector_clock — Monotonically increasing logical clock value for this
 *                  device. Used to detect ordering violations during conflict
 *                  resolution (Lamport timestamps / vector clocks).
 */
export interface SyncEvent {
  id: string;
  table: SyncTableName;
  event_type: SyncEventType;
  record_id: string;
  payload: Record<string, unknown> | null;
  device_id: string;
  user_id: string;
  timestamp: string;
  vector_clock: number;
}

// =============================================================================
// Sync Log Entry
// =============================================================================

/**
 * SyncLogEntry — a locally-stored record of every sync event processed.
 *
 * Stored in IndexedDB (not Supabase) to avoid cloud storage growth.
 * Pruned to the last 1000 entries. Used for:
 *   1. Replay during offline → online transition (re-apply missed events)
 *   2. Conflict detection (was this record modified locally since last sync?)
 *   3. Debug inspection (what changed on which device, when?)
 *
 * Fields:
 *   event        — The original SyncEvent
 *   applied_at   — When this device processed/applied the event
 *   was_conflict — Whether this event caused a conflict with local state
 *   resolution   — How the conflict was resolved (if it was one)
 *   local_snapshot — Snapshot of local state at conflict time (for audit)
 */
export interface SyncLogEntry {
  event: SyncEvent;
  applied_at: string;
  was_conflict: boolean;
  resolution?: ConflictResolution;
  local_snapshot?: Record<string, unknown>;
}

// =============================================================================
// Conflict Types
// =============================================================================

/**
 * ConflictResolution — how a sync conflict was resolved.
 *
 * 'remote-wins'  — The incoming event's data replaced the local version.
 *                  Applied when the remote timestamp is newer.
 * 'local-wins'   — The local version was kept, remote change discarded.
 *                  Applied when local timestamp is newer.
 * 'user-resolved' — The user manually chose which version to keep via the
 *                   ConflictResolver UI.
 * 'merged'       — Field-level merge was possible (e.g. SRS data updated
 *                  on one device while question content edited on another —
 *                  both changes can coexist).
 */
export type ConflictResolution = 'remote-wins' | 'local-wins' | 'user-resolved' | 'merged';

/**
 * SyncConflict — a conflict record presented to the user for manual resolution.
 *
 * Created when two devices both modify the same record between syncs.
 * Stored in IndexedDB and surfaced in the ConflictResolver component.
 *
 * Fields:
 *   id           — UUID of this conflict record
 *   record_id    — The question/deck/session ID that conflicted
 *   table        — Which table the conflict is in
 *   local_version  — The version currently in local storage/IndexedDB
 *   remote_version — The version from the incoming sync event
 *   local_timestamp  — When the local version was last modified
 *   remote_timestamp — When the remote version was last modified
 *   created_at   — When this conflict was detected
 */
export interface SyncConflict {
  id: string;
  record_id: string;
  table: SyncTableName;
  local_version: Record<string, unknown>;
  remote_version: Record<string, unknown>;
  local_timestamp: string;
  remote_timestamp: string;
  created_at: string;
}

// =============================================================================
// Sync Status (runtime state, not persisted)
// =============================================================================

/**
 * SyncState — current runtime state of the sync system.
 *
 * Held in Zustand's syncStore. Displayed in SyncStatus component.
 *
 * 'idle'         — Connected to Supabase Realtime, no activity
 * 'syncing'      — Currently processing a fetch or push
 * 'offline'      — No network or Supabase unreachable
 * 'error'        — Last sync attempt failed
 * 'conflict'     — Unresolved conflicts waiting for user attention
 */
export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'conflict';

// =============================================================================
// Pending Event (Offline Queue)
// =============================================================================

/**
 * PendingEventType — the class of operation stored in the offline queue.
 *
 * 'srs_update'  — An SRS progress record that needs to be pushed to Supabase
 */
export type PendingEventType = 'srs_update';

/**
 * PendingEvent — an operation queued while the device was offline.
 *
 * Stored in IndexedDB's PENDING_EVENTS store. Drained and replayed by
 * offlineReplay.ts when connectivity returns.
 *
 * Fields:
 *   id           — UUID (client-generated)
 *   type         — Which operation to replay (drives the switch in replayPendingEvents)
 *   payload      — Operation-specific data (question_id, srs, deck_id, etc.)
 *   timestamp    — ISO 8601 when the event was created (used for ordering)
 *   retry_count  — How many replay attempts have failed. Incremented on each
 *                  failure and re-enqueue. Discarded after MAX_RETRIES.
 */
export interface PendingEvent {
  id: string;
  type: PendingEventType;
  payload: Record<string, unknown>;
  timestamp: string;
  retry_count: number;
}
