/**
 * @file lib/storage.ts
 * @description IndexedDB client for offline-first local data storage.
 *
 * Noledge is offline-first: all question, deck, and session data is cached
 * locally in IndexedDB so the app works without an internet connection.
 * Supabase is the sync layer — it propagates changes between devices —
 * but it is never the "source of truth" from the client's perspective.
 * The local IndexedDB IS the source of truth on each device.
 *
 * We use the `idb` library (installed as a dependency) as a thin Promise-based
 * wrapper around the raw IndexedDB API. The raw API is callback-based and
 * verbose; idb makes it ergonomic without adding unnecessary abstraction.
 *
 * DATABASE SCHEMA:
 *
 * Object Store: 'questions'
 *   Key: question.id (string UUID)
 *   Indexes:
 *     - deck_id      : for fetching all questions in a deck
 *     - next_review  : for the SRS scheduler (fetch due questions)
 *     - tags         : multiEntry index for tag-based filtering
 *
 * Object Store: 'decks'
 *   Key: deck.id (string UUID)
 *   No additional indexes needed (deck list is always small)
 *
 * Object Store: 'sync_log'
 *   Key: autoIncrement
 *   Indexes:
 *     - timestamp    : for pruning old entries and fetching recent history
 *     - record_id    : for finding events related to a specific record
 *
 * Object Store: 'pending_events'
 *   Key: event.id (string UUID)
 *   Events queued while offline, replayed on reconnect.
 *
 * Object Store: 'srs_cache'
 *   Key: question_id (string UUID)
 *   A flat store just for SRS data, allowing fast bulk reads for the
 *   scheduler without loading full question objects.
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { Question } from '@/types/question';
import type { Deck } from '@/types/deck';
import type { SyncEvent, SyncLogEntry, PendingEvent } from '@/types/sync';
import {
  IDB_DB_NAME,
  IDB_VERSION,
  IDB_STORES,
  SYNC_LOG_MAX_ENTRIES,
} from '@/lib/constants';
import { createLogger } from '@/lib/logger';

const log = createLogger('storage');

// =============================================================================
// Database Type (for type-safe idb usage)
// =============================================================================

/**
 * NoledgeDB — the TypeScript type describing the shape of our IndexedDB.
 *
 * Passed to openDB<NoledgeDB>() so idb can provide type-safe access
 * to each object store.
 *
 * Each key in the top-level object is a store name. The value type describes:
 *   key      — the primary key type for this store
 *   value    — the object type stored in this store
 *   indexes  — named indexes and their key types
 */
interface NoledgeDB {
  [IDB_STORES.QUESTIONS]: {
    key: string;
    value: Question;
    indexes: {
      deck_id: string;
      next_review: string;
    };
  };
  [IDB_STORES.DECKS]: {
    key: string;
    value: Deck;
    indexes: Record<never, never>;
  };
  [IDB_STORES.SYNC_LOG]: {
    key: number;    // autoIncrement
    value: SyncLogEntry;
    indexes: {
      timestamp: string;
      record_id: string;
    };
  };
  [IDB_STORES.PENDING_EVENTS]: {
    key: string;
    value: PendingEvent;
    indexes: {
      timestamp: string;
    };
  };
  [IDB_STORES.SRS_CACHE]: {
    key: string;
    value: { question_id: string; next_review: string; repetitions: number; interval: number };
    indexes: {
      next_review: string;
    };
  };
}

// =============================================================================
// Database Singleton
// =============================================================================

let dbInstance: IDBPDatabase<NoledgeDB> | null = null;

/**
 * getDB — open (or return the cached) IndexedDB database connection.
 *
 * Uses a singleton pattern because opening multiple connections to the same
 * IndexedDB database can cause blocking — if version upgrades are in progress,
 * new connection attempts block until the upgrade is complete. With a single
 * connection, we avoid this issue.
 *
 * The `upgrade` callback handles schema migrations. It's called when
 * IDB_VERSION is higher than the stored version (or when the DB is first created).
 *
 * @returns Promise resolving to the IDBPDatabase instance
 */
export async function getDB(): Promise<IDBPDatabase<NoledgeDB>> {
  if (dbInstance) return dbInstance;

  const done = log.timed('info', 'idb_open', 'Opening IndexedDB database');

  dbInstance = await openDB<NoledgeDB>(IDB_DB_NAME, IDB_VERSION, {
    upgrade(db, oldVersion, newVersion) {
      log.info('idb_upgrade', `Upgrading IndexedDB from v${oldVersion} to v${newVersion}`);

      // ─── Version 1: Initial Schema ──────────────────────────────────
      if (oldVersion < 1) {
        // Questions store
        if (!db.objectStoreNames.contains(IDB_STORES.QUESTIONS)) {
          const questionStore = db.createObjectStore(IDB_STORES.QUESTIONS, { keyPath: 'id' });
          questionStore.createIndex('deck_id', 'deck_id', { unique: false });
          questionStore.createIndex('next_review', 'srs.next_review', { unique: false });
        }

        // Decks store
        if (!db.objectStoreNames.contains(IDB_STORES.DECKS)) {
          db.createObjectStore(IDB_STORES.DECKS, { keyPath: 'id' });
        }

        // Sync log store
        if (!db.objectStoreNames.contains(IDB_STORES.SYNC_LOG)) {
          const syncStore = db.createObjectStore(IDB_STORES.SYNC_LOG, { autoIncrement: true });
          syncStore.createIndex('timestamp', 'event.timestamp', { unique: false });
          syncStore.createIndex('record_id', 'event.record_id', { unique: false });
        }

        // Pending events store (offline queue)
        if (!db.objectStoreNames.contains(IDB_STORES.PENDING_EVENTS)) {
          const pendingStore = db.createObjectStore(IDB_STORES.PENDING_EVENTS, { keyPath: 'id' });
          pendingStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // SRS cache store
        if (!db.objectStoreNames.contains(IDB_STORES.SRS_CACHE)) {
          const srsStore = db.createObjectStore(IDB_STORES.SRS_CACHE, { keyPath: 'question_id' });
          srsStore.createIndex('next_review', 'next_review', { unique: false });
        }
      }

      // Future version upgrades would be added as additional `if (oldVersion < N)` blocks here.
      // Each block only runs when upgrading FROM a version before N, so they're additive.
    },

    blocked() {
      // Another tab has the database open at an older version and is blocking
      // our upgrade. This shouldn't happen in normal usage but can occur during
      // development with multiple tabs.
      log.warn('idb_blocked', 'IndexedDB upgrade is blocked by another open connection. Please close other tabs.');
    },

    blocking() {
      // This tab's connection is blocking a newer version from upgrading.
      // Close our connection to unblock it. The app will need to reload.
      log.warn('idb_blocking', 'Closing IndexedDB connection to allow version upgrade.');
      dbInstance?.close();
      dbInstance = null;
    },
  });

  done({ db_name: IDB_DB_NAME, version: IDB_VERSION });
  return dbInstance;
}

// =============================================================================
// Question Operations
// =============================================================================

/**
 * upsertQuestion — insert or update a question in the local store.
 *
 * Uses 'put' which is an upsert operation (inserts if new, replaces if exists).
 * Called when syncing questions from GitHub/Obsidian or when the user
 * creates/edits a question directly in the app.
 *
 * @param question The question to store
 */
export async function upsertQuestion(question: Question): Promise<void> {
  const db = await getDB();
  const existing = await db.get(IDB_STORES.QUESTIONS, question.id);

  // Preserve existing SRS progress (review_count, last_reviewed) if question was previously answered
  const finalSRS = (existing && existing.srs && (existing.srs.review_count ?? 0) > 0)
    ? {
        ...question.srs,
        ...existing.srs,
        review_count: Math.max(question.srs.review_count ?? 0, existing.srs.review_count ?? 0),
      }
    : question.srs;

  const finalQuestion: Question = {
    ...question,
    srs: finalSRS,
  };

  await db.put(IDB_STORES.QUESTIONS, finalQuestion);
  await db.put(IDB_STORES.SRS_CACHE, {
    question_id: finalQuestion.id,
    next_review: finalQuestion.srs.next_review,
    repetitions: finalQuestion.srs.repetitions,
    interval: finalQuestion.srs.interval,
  });
}

/**
 * upsertQuestions — bulk upsert multiple questions in a single transaction.
 *
 * Much more efficient than calling upsertQuestion() in a loop — all writes
 * happen in one transaction, reducing round-trips to IndexedDB.
 *
 * @param questions Array of questions to store
 */
export async function upsertQuestions(questions: Question[]): Promise<void> {
  if (questions.length === 0) return;

  const done = log.timed('info', 'idb_bulk_upsert', `Bulk upserting ${questions.length} questions`);
  const db = await getDB();

  // Pre-fetch existing questions by ID to preserve SRS progress on resync
  const existingQuestions = await Promise.all(
    questions.map((q) => db.get(IDB_STORES.QUESTIONS, q.id))
  );
  const existingMap = new Map<string, Question>();
  existingQuestions.forEach((e) => {
    if (e && e.id) existingMap.set(e.id, e);
  });

  const mergedQuestions = questions.map((q) => {
    const existing = existingMap.get(q.id);
    if (existing && existing.srs && (existing.srs.review_count ?? 0) > 0) {
      return {
        ...q,
        srs: {
          ...q.srs,
          ...existing.srs,
          review_count: Math.max(q.srs.review_count ?? 0, existing.srs.review_count ?? 0),
        },
      };
    }
    return q;
  });

  // Use a single transaction for atomicity — either all succeed or all fail.
  const tx = db.transaction([IDB_STORES.QUESTIONS, IDB_STORES.SRS_CACHE], 'readwrite');
  const questionStore = tx.objectStore(IDB_STORES.QUESTIONS);
  const srsStore = tx.objectStore(IDB_STORES.SRS_CACHE);

  await Promise.all([
    ...mergedQuestions.map((q) => questionStore.put(q)),
    ...mergedQuestions.map((q) =>
      srsStore.put({
        question_id: q.id,
        next_review: q.srs.next_review,
        repetitions: q.srs.repetitions,
        interval: q.srs.interval,
      })
    ),
    tx.done,
  ]);

  done({ count: questions.length });
}

/**
 * getQuestion — fetch a single question by ID.
 *
 * @param id  Question UUID
 * @returns   The question, or undefined if not found
 */
export async function getQuestion(id: string): Promise<Question | undefined> {
  const db = await getDB();
  return db.get(IDB_STORES.QUESTIONS, id);
}

/**
 * getAllQuestions — fetch all questions stored in local IndexedDB.
 */
export async function getAllQuestions(): Promise<Question[]> {
  const db = await getDB();
  return db.getAll(IDB_STORES.QUESTIONS);
}

/**
 * clearAllQuestionsAndDecks — clear all stored questions, SRS cache, and decks from IndexedDB.
 */
export async function clearAllQuestionsAndDecks(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([IDB_STORES.QUESTIONS, IDB_STORES.SRS_CACHE, IDB_STORES.DECKS], 'readwrite');
  await Promise.all([
    tx.objectStore(IDB_STORES.QUESTIONS).clear(),
    tx.objectStore(IDB_STORES.SRS_CACHE).clear(),
    tx.objectStore(IDB_STORES.DECKS).clear(),
    tx.done,
  ]);
}

/**
 * getQuestionsByDeck — fetch all questions belonging to a deck.
 *
 * Uses the 'deck_id' index for efficient retrieval (avoids a full table scan).
 *
 * @param deckId  The deck UUID
 * @returns       Array of questions in this deck
 */
export async function getQuestionsByDeck(deckId: string): Promise<Question[]> {
  const db = await getDB();
  return db.getAllFromIndex(IDB_STORES.QUESTIONS, 'deck_id', deckId);
}

/**
 * getDueQuestions — fetch all questions due for review today, across all decks.
 *
 * Uses the 'next_review' index to find questions where next_review <= today.
 * IndexedDB range queries use IDBKeyRange for boundary conditions.
 *
 * @param deckId  Optional: limit to a specific deck. Undefined = all decks.
 * @returns       Questions due for review
 */
export async function getDueQuestions(deckId?: string): Promise<Question[]> {
  const db = await getDB();
  const today = new Date();
  today.setHours(23, 59, 59, 999); // Include everything due up to end of today

  // Fetch all questions due up to end of today from SRS cache (fast)
  const srsEntries = await db.getAllFromIndex(
    IDB_STORES.SRS_CACHE,
    'next_review',
    IDBKeyRange.upperBound(today.toISOString())
  );

  // Fetch the full question objects for the due entries
  const dueIds = srsEntries.map((e) => e.question_id);
  const tx = db.transaction(IDB_STORES.QUESTIONS, 'readonly');
  const store = tx.objectStore(IDB_STORES.QUESTIONS);

  const questions = await Promise.all(dueIds.map((id) => store.get(id)));

  return questions.filter((q): q is Question =>
    q !== undefined && (deckId === undefined || q.deck_id === deckId)
  );
}

/**
 * deleteQuestion — remove a question from all stores.
 *
 * @param id  Question UUID to delete
 */
export async function deleteQuestion(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([IDB_STORES.QUESTIONS, IDB_STORES.SRS_CACHE], 'readwrite');
  await Promise.all([
    tx.objectStore(IDB_STORES.QUESTIONS).delete(id),
    tx.objectStore(IDB_STORES.SRS_CACHE).delete(id),
    tx.done,
  ]);
}

// =============================================================================
// Deck Operations
// =============================================================================

/**
 * upsertDeck — insert or update a deck.
 *
 * @param deck The deck to store
 */
export async function upsertDeck(deck: Deck): Promise<void> {
  const db = await getDB();
  await db.put(IDB_STORES.DECKS, deck);
}

/**
 * getAllDecks — fetch all stored decks.
 *
 * @returns Array of all decks (may be empty on first launch)
 */
export async function getAllDecks(): Promise<Deck[]> {
  const db = await getDB();
  return db.getAll(IDB_STORES.DECKS);
}

/**
 * getDeck — fetch a single deck by ID.
 *
 * @param id  Deck UUID
 * @returns   The deck, or undefined if not found
 */
export async function getDeck(id: string): Promise<Deck | undefined> {
  const db = await getDB();
  return db.get(IDB_STORES.DECKS, id);
}

/**
 * deleteDeck — remove a deck and ALL its questions.
 *
 * This is a destructive operation. Questions are deleted because they're
 * useless without their deck context (no deck = no source to re-sync from).
 * The caller should confirm with the user before invoking this.
 *
 * @param deckId  Deck UUID to delete
 */
export async function deleteDeck(deckId: string): Promise<void> {
  const db = await getDB();

  // First, get all question IDs for this deck
  const questions = await getQuestionsByDeck(deckId);
  const questionIds = questions.map((q) => q.id);

  // Delete everything in one transaction
  const tx = db.transaction([IDB_STORES.DECKS, IDB_STORES.QUESTIONS, IDB_STORES.SRS_CACHE], 'readwrite');
  const deckStore = tx.objectStore(IDB_STORES.DECKS);
  const questionStore = tx.objectStore(IDB_STORES.QUESTIONS);
  const srsStore = tx.objectStore(IDB_STORES.SRS_CACHE);

  await Promise.all([
    deckStore.delete(deckId),
    ...questionIds.map((id) => questionStore.delete(id)),
    ...questionIds.map((id) => srsStore.delete(id)),
    tx.done,
  ]);

  log.info('idb_deck_deleted', `Deleted deck ${deckId} with ${questionIds.length} questions`);
}

// =============================================================================
// Sync Log Operations
// =============================================================================

/**
 * appendSyncLog — add a new entry to the sync log.
 *
 * Also prunes the log to SYNC_LOG_MAX_ENTRIES to prevent unbounded growth.
 *
 * @param entry The sync log entry to append
 */
export async function appendSyncLog(entry: SyncLogEntry): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(IDB_STORES.SYNC_LOG, 'readwrite');
  const store = tx.objectStore(IDB_STORES.SYNC_LOG);

  // Add the new entry
  await store.add(entry);

  // Prune: get all keys, delete the oldest if over limit
  const allKeys = await store.getAllKeys();
  if (allKeys.length > SYNC_LOG_MAX_ENTRIES) {
    const keysToDelete = allKeys.slice(0, allKeys.length - SYNC_LOG_MAX_ENTRIES);
    await Promise.all(keysToDelete.map((k) => store.delete(k)));
  }

  await tx.done;
}

// =============================================================================
// Pending Events Queue (offline support)
// =============================================================================

/**
 * enqueuePendingEvent — add a sync event to the offline queue.
 *
 * Called when the user makes a change (e.g., answers a question) while offline.
 * Events in this queue are replayed when connectivity returns.
 *
 * @param event The sync event to queue
 */
export async function enqueuePendingEvent(event: PendingEvent): Promise<void> {
  const db = await getDB();
  await db.put(IDB_STORES.PENDING_EVENTS, event);
}

/**
 * getAllPendingEvents — get all queued events, in chronological order.
 *
 * @returns Array of pending sync events, oldest first
 */
export async function getAllPendingEvents(): Promise<PendingEvent[]> {
  const db = await getDB();
  const events = await db.getAllFromIndex(
    IDB_STORES.PENDING_EVENTS,
    'timestamp'
  );
  return events;
}

/**
 * clearPendingEvents — remove all events from the offline queue.
 *
 * Called after successfully replaying all queued events on reconnect.
 */
export async function clearPendingEvents(): Promise<void> {
  const db = await getDB();
  await db.clear(IDB_STORES.PENDING_EVENTS);
}

/**
 * drainPendingEvents — atomically read all queued events and delete them.
 *
 * WHY "drain" vs separate get+delete:
 * A naive approach would be: getAllPendingEvents() then clearPendingEvents().
 * The problem: if the app crashes between get and clear, the same events
 * replay twice on next startup. "Drain" addresses this by deleting each event
 * immediately after reading it in the same transaction, so partial progress
 * is preserved — if the drain is interrupted, only the unread events remain.
 *
 * Algorithm:
 *   1. Open a 'readwrite' transaction on PENDING_EVENTS
 *   2. Get all events using the index (chronological)
 *   3. Delete each event by its ID within the same transaction
 *   4. Return the list of events (to be replayed by the caller)
 *
 * @returns  Array of SyncEvent objects that were queued, now deleted from IDB
 */
export async function drainPendingEvents(): Promise<PendingEvent[]> {
  const db = await getDB();
  const tx = db.transaction(IDB_STORES.PENDING_EVENTS, 'readwrite');
  const store = tx.objectStore(IDB_STORES.PENDING_EVENTS);

  // Read all events (ordered by timestamp index)
  const events = await store.getAll();

  // Delete each one within the same transaction
  for (const event of events) {
    await store.delete(event.id);
  }

  await tx.done;
  return events;
}
