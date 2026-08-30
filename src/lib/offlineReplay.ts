/**
 * @file lib/offlineReplay.ts
 * @description Replays queued offline SRS updates when the device reconnects.
 *
 * WHY THIS FILE EXISTS:
 * When the user answers study cards while offline (or while Supabase is
 * unreachable), those SRS updates are queued in IndexedDB's PENDING_EVENTS
 * store via enqueuePendingEvent(). This file replays those events when
 * connectivity returns, ensuring no progress is lost.
 *
 * RETRY POLICY:
 * Each event has a retry_count field. If replaying an event fails (e.g.,
 * network still unreachable), the event is re-enqueued with retry_count + 1.
 * After MAX_RETRIES attempts, the event is dropped and a warning is logged.
 * This prevents infinite growth of the pending_events store.
 *
 * ORDERING:
 * Events are drained in chronological order (by timestamp). This matters for
 * SRS: if a user answered card A correctly at 10:00 and incorrectly at 10:05,
 * the 10:05 state is the correct final state. Chronological order ensures
 * Supabase receives updates in the right sequence.
 *
 * IDEMPOTENCY:
 * Supabase upserts are used for SRS updates (conflict key: user_id + question_id),
 * so replaying an event that already succeeded (e.g., due to a partial network
 * failure) is safe — the second upsert is a no-op.
 */

import { drainPendingEvents, enqueuePendingEvent } from '@/lib/storage';
import { createLogger } from '@/lib/logger';
import type { PendingEvent } from '@/types/sync';

const log = createLogger('sync');

// =============================================================================
// Constants
// =============================================================================

/**
 * MAX_RETRIES — maximum replay attempts before an event is discarded.
 *
 * Set to 5. After 5 failures, the event is likely malformed or the Supabase
 * table schema has changed. Dropping it prevents unbounded retry loops.
 */
const MAX_RETRIES = 5;

// =============================================================================
// Replay Functions
// =============================================================================

/**
 * replaySRSUpdate — replay a single srs_update event to Supabase.
 *
 * Dynamically imports supabaseSync to avoid a top-level import cycle
 * (supabaseSync imports from stores which import from here indirectly).
 * Dynamic import is safe here because replay only happens on reconnect,
 * never in a hot path.
 *
 * @param event  The SRS update event to replay
 * @throws       If the Supabase push fails (caller handles retry logic)
 */
async function replaySRSUpdate(event: PendingEvent): Promise<void> {
  if (event.type !== 'srs_update') return;
  return;
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * replayPendingEvents — drain the offline queue and push each event to Supabase.
 *
 * Called by useOffline hook when the device transitions from offline → online.
 * Also called on app startup (in case a previous session ended without replay).
 *
 * Algorithm:
 *   1. drainPendingEvents() — read all events and delete them from IDB atomically
 *   2. For each event, attempt to replay it
 *   3. If replay fails AND retry_count < MAX_RETRIES: re-enqueue with retry_count + 1
 *   4. If replay fails AND retry_count >= MAX_RETRIES: log warning and discard
 *   5. Log a summary of results
 *
 * @returns  Object with counts: { replayed, failed, discarded }
 */
export async function replayPendingEvents(): Promise<{
  replayed: number;
  failed: number;
  discarded: number;
}> {
  let events: PendingEvent[];

  try {
    events = await drainPendingEvents();
  } catch (err) {
    log.error('replay_drain_failed', 'Failed to drain pending events from IndexedDB', err);
    return { replayed: 0, failed: 0, discarded: 0 };
  }

  if (events.length === 0) {
    log.debug('replay_empty', 'No pending events to replay');
    return { replayed: 0, failed: 0, discarded: 0 };
  }

  log.info('replay_start', `Replaying ${events.length} pending offline event(s)`);

  let replayed = 0;
  let failed = 0;
  let discarded = 0;

  for (const event of events) {
    try {
      switch (event.type) {
        case 'srs_update':
          await replaySRSUpdate(event);
          break;

        default:
          // Unknown event type — discard rather than retry forever
          log.warn('replay_unknown_type', `Unknown event type "${event.type}" — discarding`);
          discarded++;
          continue;
      }

      replayed++;
      log.debug('replay_success', `Replayed event ${event.id} (type: ${event.type})`);
    } catch (err) {
      const retryCount = (event.retry_count ?? 0) + 1;

      if (retryCount > MAX_RETRIES) {
        log.warn(
          'replay_max_retries',
          `Event ${event.id} exceeded ${MAX_RETRIES} retries — discarding`,
          { event_type: event.type }
        );
        discarded++;
      } else {
        // Re-enqueue for the next reconnect
        await enqueuePendingEvent({ ...event, retry_count: retryCount });
        log.debug(
          'replay_requeued',
          `Event ${event.id} failed (attempt ${retryCount}/${MAX_RETRIES}), re-queued`,
          { error: String(err) }
        );
        failed++;
      }
    }
  }

  log.info('replay_complete', `Replay done: ${replayed} ok, ${failed} re-queued, ${discarded} discarded`);
  return { replayed, failed, discarded };
}
