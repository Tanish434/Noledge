/**
 * @file stores/deckStore.ts
 * @description Zustand store for deck state management.
 *
 * Zustand is a minimal, fast, and scalable state management library for React.
 * We chose it over Context + useReducer because:
 *   1. No re-render waterfall: components only re-render when the specific
 *      slice of state they subscribe to changes (using the selector pattern).
 *   2. Simpler than Redux: no actions, reducers, or boilerplate.
 *   3. Works outside React: non-component code (API routes, sync pipeline)
 *      can read store state via getState() without hooks.
 *
 * STORE ARCHITECTURE:
 * Each domain has its own store file. Stores are flat — no nesting.
 * Cross-store reads use each store's getState() method. Cross-store writes
 * are done by calling actions from different stores in sequence.
 *
 * PERSISTENCE STRATEGY:
 * Deck data is cached in IndexedDB (via lib/storage.ts), not in Zustand's
 * built-in persist middleware. Reason: Zustand's persist uses localStorage,
 * which has a 5-10MB limit. IndexedDB has no practical limit. This store is
 * the in-memory "view" of the IndexedDB data, loaded on app start and kept
 * in sync via the sync pipeline.
 */

import { create } from 'zustand';
import type { Deck, CreateDeckDTO, UpdateDeckDTO } from '@/types/deck';
import {
  getAllDecks,
  upsertDeck,
  upsertQuestion,
  getQuestionsByDeck,
  getAllQuestions,
  deleteQuestion,
  clearAllQuestionsAndDecks,
  deleteDeck as deleteFromIDB,
} from '@/lib/storage';
import { isDueToday, isMastered } from '@/engine/srs/sm2';
import { toUUID } from '@/lib/supabaseSync';
import { createLogger } from '@/lib/logger';
import { useSourceStore } from '@/stores/sourceStore';
import { DEFAULT_DECK_ID, isDefaultDeckDismissed, DEFAULT_SOURCE_ID } from '@/lib/defaultDeckManager';

const log = createLogger('storage');

let inFlightLoadDecks: Promise<void> | null = null;

// =============================================================================
// Store State Type
// =============================================================================

/**
 * DeckState — the shape of the deck store.
 *
 * Data:
 *   decks         — All decks, keyed by ID for O(1) lookup
 *   isLoading     — Whether decks are being fetched from IndexedDB
 *   error         — Last error message (null if no error)
 *   selectedDeckId — Currently selected deck in the management UI
 *
 * Actions:
 *   loadDecks     — Fetch all decks from IndexedDB into memory
 *   upsertDeck    — Add or update a deck in memory and IndexedDB
 *   deleteDeck    — Remove a deck from memory and IndexedDB
 *   selectDeck    — Set the currently selected deck ID
 *   updateDeckStats — Update cached stats for a deck after a study session
 */
interface DeckState {
  decks: Record<string, Deck>;
  isLoading: boolean;
  error: string | null;
  selectedDeckId: string | null;

  loadDecks: () => Promise<void>;
  upsertDeck: (deck: Deck) => Promise<void>;
  createDeck: (dto: CreateDeckDTO) => Promise<Deck>;
  updateDeck: (id: string, updates: UpdateDeckDTO) => Promise<void>;
  deleteDeck: (id: string) => Promise<void>;
  selectDeck: (id: string | null) => void;
}

// =============================================================================
// Store Factory Helpers
// =============================================================================

/**
 * generateDeckId — create a deterministic UUID for a deck based on its name.
 */
function generateDeckId(name: string): string {
  return toUUID(`deck:${name.trim().toLowerCase()}`);
}

/**
 * createDefaultStats — create a zeroed stats object for a new deck.
 */
function createDefaultStats(): Deck['stats'] {
  return {
    total_reviews: 0,
    correct_count: 0,
    accuracy_percent: 0,
    streak: 0,
    longest_streak: 0,
    due_today: 0,
    mastered: 0,
    difficulty_breakdown: { easy: 0, medium: 0, hard: 0 },
  };
}

// =============================================================================
// Store
// =============================================================================

export const useDeckStore = create<DeckState>((set, get) => ({
  // ─── Initial State ────────────────────────────────────────────────────
  decks: {},
  isLoading: false,
  error: null,
  selectedDeckId: null,

  // ─── Actions ──────────────────────────────────────────────────────────

  /**
   * loadDecks — load all decks from IndexedDB into memory.
   *
   * Called once on app mount. After initial load, all deck state is
   * kept in memory. IndexedDB is only read again on the next app launch
   * (unless explicitly called again, e.g., after a full sync).
   */
  loadDecks: async () => {
    if (inFlightLoadDecks) return inFlightLoadDecks;

    inFlightLoadDecks = (async () => {
      set({ isLoading: true, error: null });

      try {
        const [allDecks, allQuestions] = await Promise.all([
          getAllDecks(),
          getAllQuestions(),
        ]);

        // 1. Single pass: Aggregate counts and stats by deck_id
        const counts: Record<string, number> = {};
        const masteredCounts: Record<string, number> = {};
        const dueCounts: Record<string, number> = {};
        const reviewsCounts: Record<string, number> = {};
        const todayDate = new Date().toDateString();

        for (const q of allQuestions) {
          if (!q || !q.deck_id) continue;
          const dId = q.deck_id;
          counts[dId] = (counts[dId] || 0) + 1;

          if (!q.srs) {
            dueCounts[dId] = (dueCounts[dId] || 0) + 1;
            continue;
          }

          if (isMastered(q.srs)) {
            masteredCounts[dId] = (masteredCounts[dId] || 0) + 1;
          }

          const reviewCount = q.srs.review_count ?? 0;
          if (reviewCount === 0 || !q.srs.last_reviewed) {
            dueCounts[dId] = (dueCounts[dId] || 0) + 1;
          } else if (isDueToday(q.srs)) {
            const lastRevDate = new Date(q.srs.last_reviewed).toDateString();
            if (lastRevDate !== todayDate) {
              dueCounts[dId] = (dueCounts[dId] || 0) + 1;
            }
          }
          reviewsCounts[dId] = (reviewsCounts[dId] || 0) + reviewCount;
        }

        const activeSources = useSourceStore.getState().sources || [];
        const decksMap: Record<string, Deck> = {};
        const seenNames = new Map<string, Deck>();

        for (const deck of allDecks) {
          if (!deck || !deck.id || !deck.name) continue;

          const count = counts[deck.id] || 0;
          const exactName = deck.name.trim().toLowerCase();
          const isDefaultDeck = deck.id === DEFAULT_DECK_ID || exactName === 'test' || exactName === 'test.json';

          const isSourceBacked = activeSources.some((s) => {
            if (!s) return false;
            const sLabel = (s.label || '').toLowerCase();
            const sVault = ((s as any).vault_name || '').toLowerCase();
            const fileList: Array<{ name: string; path: string }> = (s as any).file_list || [];

            if (sLabel.includes(exactName) || (sVault && sVault.includes(exactName))) return true;
            return fileList.some((f) => {
              const fBase = f.name.replace(/\.(json|md|markdown)$/i, '').toLowerCase();
              return fBase === exactName || exactName.includes(fBase);
            });
          });

          // Purge leftover empty 0-card decks if not source-backed
          if (count === 0 && !isSourceBacked && !isDefaultDeck) {
            void deleteFromIDB(deck.id);
            continue;
          }

          if (seenNames.has(exactName)) {
            const existing = seenNames.get(exactName)!;
            const existingCount = counts[existing.id] || 0;

            if (count === 0) {
              void deleteFromIDB(deck.id);
              continue;
            }

            if (existingCount === 0) {
              void deleteFromIDB(existing.id);
              delete decksMap[existing.id];
              seenNames.set(exactName, deck);
            }
          } else {
            seenNames.set(exactName, deck);
          }

          let bestAccuracy = 0;
          if (typeof window !== 'undefined') {
            try {
              const savedAcc = localStorage.getItem(`noledge_deck_best_acc_${deck.id}`);
              if (savedAcc) bestAccuracy = parseInt(savedAcc, 10);
            } catch {}
          }

          decksMap[deck.id] = {
            ...deck,
            question_count: count,
            stats: {
              ...(deck.stats || createDefaultStats()),
              mastered: masteredCounts[deck.id] || 0,
              due_today: dueCounts[deck.id] || 0,
              total_reviews: reviewsCounts[deck.id] || 0,
              accuracy_percent: bestAccuracy,
            },
          };
        }

        // Merge in-memory decks created during this session
        const memoryDecks = get().decks;
        for (const mDeck of Object.values(memoryDecks)) {
          if (mDeck && mDeck.id && !decksMap[mDeck.id]) {
            const count = counts[mDeck.id] || mDeck.question_count || 0;
            decksMap[mDeck.id] = { ...mDeck, question_count: count };
          }
        }

        // Auto-seed Default Test Deck ("Test") if not dismissed
        const isDismissed = isDefaultDeckDismissed();
        if (isDismissed) {
          if (decksMap[DEFAULT_DECK_ID]) {
            delete decksMap[DEFAULT_DECK_ID];
            void deleteFromIDB(DEFAULT_DECK_ID);
          }
        } else {
          const hasTestDeck = Object.values(decksMap).some(
            (d) => d.id === DEFAULT_DECK_ID || d.name.toLowerCase() === 'test.json' || d.name.toLowerCase() === 'test'
          );

          if (!hasTestDeck && typeof window !== 'undefined') {
            try {
              const seedQuestions = await import('../../questions/test.json').then((m) => m.default || m);
              if (Array.isArray(seedQuestions) && seedQuestions.length > 0) {
                const defaultDeck: Deck = {
                  id: DEFAULT_DECK_ID,
                  name: 'Test',
                  description: 'Default Test Deck: pre-loaded sample questions covering Code, Web, SQL & Networking',
                  color: '#10b981',
                  icon: 'code',
                  tags: ['test', 'sample'],
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  question_count: seedQuestions.length,
                  stats: createDefaultStats(),
                };
                decksMap[DEFAULT_DECK_ID] = defaultDeck;
                set({ decks: { ...decksMap } });

                const { useQuestionStore } = await import('./questionStore');
                const qArr = seedQuestions.map((q: any) => ({
                  ...q,
                  deck_id: DEFAULT_DECK_ID,
                  source_file: 'questions/test.json',
                }));
                await useQuestionStore.getState().upsertQuestions(qArr);

                // Register default source in sourceStore so it appears in Import tab Active Sources list
                const { useSourceStore } = await import('./sourceStore');
                const existingSource = useSourceStore.getState().getSourceById(DEFAULT_SOURCE_ID);
                if (!existingSource) {
                  useSourceStore.getState().addSource({
                    id: DEFAULT_SOURCE_ID,
                    kind: 'obsidian',
                    label: 'Default Deck: test.json (10 questions)',
                    path: 'questions/test.json',
                    created_at: new Date().toISOString(),
                    file_list: [{ path: 'questions/test.json', name: 'test.json', question_count: seedQuestions.length }],
                  } as any);
                }
              }
            } catch {
              // Non-fatal if fetch fails
            }
          }
        }

        set({ decks: { ...decksMap }, isLoading: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load decks';
        log.error('load_decks_failed', 'Failed to load decks from IndexedDB', error);
        set({ isLoading: false, error: message });
      } finally {
        inFlightLoadDecks = null;
      }
    })();

    return inFlightLoadDecks;
  },

  /**
   * upsertDeck — add or update a deck in memory and IndexedDB.
   *
   * Optimistic update: we update memory immediately, then persist to IndexedDB.
   * If the IndexedDB write fails, we roll back the memory state and set an error.
   */
  upsertDeck: async (deck: Deck) => {
    const previousDecks = get().decks;

    // Optimistic update
    set((state) => ({
      decks: { ...state.decks, [deck.id]: deck },
    }));

    try {
      await upsertDeck(deck);
    } catch (error) {
      // Rollback
      set({ decks: previousDecks, error: 'Failed to save deck' });
      log.error('upsert_deck_failed', `Failed to persist deck ${deck.id}`, error);
    }
  },

  /**
   * createDeck — create or update a deck from a DTO.
   *
   * Reuses existing deck if the deck name already exists to prevent duplicate cards.
   *
   * @returns The Deck object
   */
  createDeck: async (dto: CreateDeckDTO) => {
    // Deduplicate: if a deck with the exact same name already exists in store, return existing deck
    const existingDeck = Object.values(get().decks).find(
      (d) => d.name.toLowerCase() === dto.name.toLowerCase()
    );
    if (existingDeck) {
      const updated: Deck = {
        ...existingDeck,
        description: dto.description ?? existingDeck.description,
        color: dto.color ?? existingDeck.color,
        icon: dto.icon ?? existingDeck.icon,
        updated_at: new Date().toISOString(),
      };
      await get().upsertDeck(updated);
      return updated;
    }

    const now = new Date().toISOString();
    const deck: Deck = {
      id: generateDeckId(dto.name),
      name: dto.name,
      description: dto.description,
      color: dto.color,
      icon: dto.icon,
      tags: dto.tags,
      source: dto.source,
      created_at: now,
      updated_at: now,
      question_count: 0,
      stats: createDefaultStats(),
    };

    await get().upsertDeck(deck);
    return deck;
  },

  /**
   * updateDeck — apply partial updates to an existing deck.
   *
   * @param id      The deck ID to update
   * @param updates The fields to change (all optional)
   */
  updateDeck: async (id: string, updates: UpdateDeckDTO) => {
    const existing = get().decks[id];
    if (!existing) {
      log.warn('update_deck_not_found', `Cannot update deck ${id}: not found in store`);
      return;
    }

    const updated: Deck = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    await get().upsertDeck(updated);
  },

  /**
   * deleteDeck — remove a deck and all its questions from memory and IndexedDB.
   */
  deleteDeck: async (id: string) => {
    const previousDecks = get().decks;

    // Optimistic update
    set((state) => {
      const next = { ...state.decks };
      delete next[id];
      return { decks: next };
    });

    try {
      await deleteFromIDB(id);
    } catch (error) {
      // Rollback
      set({ decks: previousDecks, error: 'Failed to delete deck' });
      log.error('delete_deck_failed', `Failed to delete deck ${id}`, error);
    }
  },

  /**
   * selectDeck — set the currently selected deck in the management UI.
   *
   * @param id  The deck ID to select, or null to deselect
   */
  selectDeck: (id: string | null) => {
    set({ selectedDeckId: id });
  },
}));
