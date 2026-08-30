/**
 * @file stores/questionStore.ts
 * @description Zustand store for question state and study session management.
 */

import { create } from 'zustand';
import type { Question, StudySession, AnswerAttempt } from '@/types/question';
import {
  getQuestionsByDeck,
  getDueQuestions,
  getAllQuestions,
  upsertQuestion,
  upsertQuestions,
  deleteQuestion as deleteFromIDB,
} from '@/lib/storage';
import { updateSRS, createInitialSRS, isDueToday } from '@/engine/srs/sm2';
import { scoreAnswer } from '@/engine/scoring/scoreEngine';
import { updateStreak } from '@/engine/scoring/streakTracker';
import { useDeckStore } from './deckStore';
import { useSourceStore } from './sourceStore';
import { useSettingsStore } from './settingsStore';
import { serializeQuestionToMarkdown } from '@/lib/markdownParser';
import { getFileHandleSync, requestWritePermissionInGesture, preloadAllFileHandles } from '@/lib/fileHandleStore';
import { createLogger } from '@/lib/logger';
import { recordStudyActivity } from '@/lib/activityTracker';

if (typeof window !== 'undefined') {
  void preloadAllFileHandles();
}

const log = createLogger('study');

// =============================================================================
// Store State Type
// =============================================================================

interface QuestionState {
  // Per-deck question cache: deck_id → Question[]
  questionsByDeck: Record<string, Question[]>;

  // Currently active study session
  activeSession: StudySession | null;

  // Index into the current session's question queue
  currentCardIndex: number;

  // Whether questions are loading for a deck
  loadingDeckId: string | null;

  error: string | null;

  // Actions
  loadQuestionsForDeck: (deckId: string) => Promise<void>;
  upsertQuestion: (question: Question) => Promise<void>;
  upsertQuestions: (questions: Question[]) => Promise<void>;
  deleteQuestion: (id: string, deckId: string) => Promise<void>;
  startSession: (deckId?: string | null, mode?: StudySession['mode'], limit?: number, filterType?: import('@/types/question').QuestionType) => Promise<void>;
  answerCurrentCard: (userAnswer: string | string[], timeTakenMs: number) => Promise<boolean>;
  rateCurrentCard: (rating: 'again' | 'hard' | 'good' | 'easy') => Promise<void>;
  nextCard: () => void;
  previousCard: () => void;
  endSession: () => void;
  clearSession: () => void;
  getCurrentQuestion: () => Question | null;
}

// =============================================================================
// Session ID Generator
// =============================================================================
function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * syncDeckToFile — synchronizes in-memory and IndexedDB questions directly to the disk .md file.
 * Rewrites the file with the complete current question set so additions, edits, and deletions
 * remain 100% losslessly in sync with the source file on disk.
 */
async function syncDeckToFile(deckId: string) {
  try {
    const rawStored = await getQuestionsByDeck(deckId);
    void useDeckStore.getState().updateDeck(deckId, { question_count: rawStored.length });

    const deck = useDeckStore.getState().decks[deckId];
    if (!deck) return;

    const { serializeDeckToJson, reindexDeckQuestions } = await import('@/lib/markdownParser');
    const reindexed = reindexDeckQuestions(rawStored, deck.name);

    // Sync IndexedDB IDs if any changed during re-indexing
    for (let i = 0; i < rawStored.length; i++) {
      const oldQ = rawStored[i];
      const newQ = reindexed[i];
      if (oldQ.id !== newQ.id) {
        await deleteFromIDB(oldQ.id);
        await upsertQuestion(newQ);
      }
    }

    useQuestionStore.setState((state) => ({
      questionsByDeck: {
        ...state.questionsByDeck,
        [deckId]: reindexed,
      },
    }));

    const stored = reindexed;
    const fullDeckJson = serializeDeckToJson(stored);
    const sources = useSourceStore.getState().sources;
    let synced = false;

    for (const s of sources) {
      const sName = ((s as any).vault_name || '').toLowerCase().replace(/\.(json|md|markdown)$/i, '').trim();
      const deckNameClean = deck.name.toLowerCase().trim();
      const labelLower = s.label.toLowerCase();
      const isNameMatch = sName
        ? (sName === deckNameClean || deckNameClean.includes(sName) || sName.includes(deckNameClean))
        : labelLower.includes(deckNameClean);

      if (!isNameMatch) continue;
      synced = true;

      // Update source label count
      const updatedLabel = s.label.replace(/\(\d+\s+questions[^)]*\)/, `(${stored.length} questions)`);
      useSourceStore.getState().updateSource(s.id, { label: updatedLabel });

      // Case 1: GitHub → commit only this specific file via API
      if (s.kind === 'github' && (s as any).owner && (s as any).repo) {
        const ghOwner = (s as any).owner;
        const ghRepo = (s as any).repo;
        const ghBranch = (s as any).branch || 'main';

        const ghPath = stored.find((q) => q.source_file)?.source_file
          || (s as any).path
          || (s as any).filePath
          || `${deck.name}.json`;

        const tokenKey = (s as any).token || `noledge:gh:token:${ghOwner}/${ghRepo}`;
        const encryptedToken = typeof window !== 'undefined' ? localStorage.getItem(tokenKey) : '';
        await fetch('/api/github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save', owner: ghOwner, repo: ghRepo, branch: ghBranch, path: ghPath, token: encryptedToken || undefined, fullDeckMarkdown: fullDeckJson, fullDeckJson }),
        }).catch((err) => log.error('github_sync_failed', `Failed to save to GitHub for deck ${deckId}`, err));
        continue;
      }

      // Case 2: Local file → dual write:
      if (typeof window !== 'undefined') {
        const { getFileHandle: getHandle } = await import('@/lib/fileHandleStore');
        const vaultName = (s as any).vault_name || '';
        const fileHandle = (await getHandle(s.id))
          || (await getHandle(`file_${vaultName}`))
          || (window as any)[`file_handle_${s.id}`]
          || (window as any)[`file_handle_${vaultName}`];

        if (fileHandle && typeof (fileHandle as any).createWritable === 'function') {
          try {
            let perm = await (fileHandle as any).queryPermission({ mode: 'readwrite' });
            if (perm === 'prompt') {
              try {
                perm = await (fileHandle as any).requestPermission({ mode: 'readwrite' });
              } catch (_) {
                // Ignore gesture restriction
              }
            }
            if (perm === 'granted') {
              const writable = await (fileHandle as any).createWritable();
              await writable.write(fullDeckJson + '\n');
              await writable.close();
              log.info('file_synced_handle', `Wrote ${stored.length} questions to FileSystemFileHandle for "${deck.name}"`);
            }
          } catch (writeErr) {
            log.error('file_handle_write_failed', `FileSystemFileHandle write failed for ${deck.name}`, writeErr);
          }
        }
      }

      // (b) Server-side Node disk save via /api/files/save
      let targetFilePath = stored.find((q) => q.source_file && q.source_file !== 'manual' && q.source_file !== 'unknown')?.source_file
        || (s as any).vault_path
        || (s as any).filePath
        || (s as any).relPath
        || '';
      if (!targetFilePath || targetFilePath === 'manual' || targetFilePath === 'unknown') {
        const filePathMatch = s.label.match(/^(?:Obsidian File|Local File|Obsidian Vault|File):\s*([^(]+)/i);
        if (filePathMatch) targetFilePath = filePathMatch[1].trim();
      }
      if ((!targetFilePath || targetFilePath === 'manual' || targetFilePath === 'unknown') && deck.description?.includes('File:')) {
        targetFilePath = deck.description.replace(/^File:\s*/i, '').replace(/\s*\([^)]*\)$/, '').trim();
      }
      if (!targetFilePath || targetFilePath === 'manual' || targetFilePath === 'unknown') {
        targetFilePath = `noledge/questions/${deck.name.toLowerCase().replace(/\s+/g, '-')}-deck.json`;
      }

      // Normalize stored question source_file before serializing
      const normalizedStored = stored.map((q) => ({
        ...q,
        source_file: (!q.source_file || q.source_file === 'manual' || q.source_file === 'unknown') ? targetFilePath : q.source_file,
      }));
      const updatedDeckJson = serializeDeckToJson(normalizedStored);

      await fetch('/api/files/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: targetFilePath, fullDeckMarkdown: updatedDeckJson, fullDeckJson: updatedDeckJson }),
      }).catch((err) => {
        log.error('files_save_failed', `Failed fetch to /api/files/save for deck ${deckId}`, err);
      });
    }

    if (!synced) {
      let targetFilePath = stored.find((q) => q.source_file && q.source_file !== 'manual' && q.source_file !== 'unknown')?.source_file || '';
      if ((!targetFilePath || targetFilePath === 'manual' || targetFilePath === 'unknown') && deck.description?.includes('File:')) {
        targetFilePath = deck.description.replace(/^File:\s*/i, '').replace(/\s*\([^)]*\)$/, '').trim();
      }
      if (!targetFilePath || targetFilePath === 'manual' || targetFilePath === 'unknown') {
        targetFilePath = `noledge/questions/${deck.name.toLowerCase().replace(/\s+/g, '-')}-deck.json`;
      }

      const normalizedStored = stored.map((q) => ({
        ...q,
        source_file: (!q.source_file || q.source_file === 'manual' || q.source_file === 'unknown') ? targetFilePath : q.source_file,
      }));
      const updatedDeckJson = serializeDeckToJson(normalizedStored);

      await fetch('/api/files/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: targetFilePath, fullDeckMarkdown: updatedDeckJson, fullDeckJson: updatedDeckJson }),
      }).catch((err) => {
        log.error('files_save_fallback_failed', `Failed fallback fetch to /api/files/save for deck ${deckId}`, err);
      });
    }
  } catch (err) {
    log.error('sync_deck_file_failed', `Failed to sync deck file for deck ${deckId}`, err);
  }
}

function prepareFileHandlePermission(deckId: string) {
  if (typeof window === 'undefined') return;
  const deck = useDeckStore.getState().decks[deckId];
  const sources = useSourceStore.getState().sources;
  for (const s of sources) {
    const sName = ((s as any).vault_name || '').toLowerCase().replace(/\.(md|markdown)$/i, '').trim();
    const deckNameClean = deck ? deck.name.toLowerCase().trim() : '';
    const labelLower = s.label.toLowerCase();
    const isNameMatch = deckNameClean && (sName
      ? (sName === deckNameClean || deckNameClean.includes(sName) || sName.includes(deckNameClean))
      : labelLower.includes(deckNameClean));

    if (isNameMatch || s.id === (deck as any)?.source_id) {
      const handle = getFileHandleSync(s.id) || getFileHandleSync(`file_${(s as any).vault_name}`);
      if (handle) {
        requestWritePermissionInGesture(handle);
      }
    }
  }
}

// =============================================================================
// Store
// =============================================================================

export const useQuestionStore = create<QuestionState>((set, get) => ({
  questionsByDeck: {},
  activeSession: null,
  currentCardIndex: 0,
  loadingDeckId: null,
  error: null,

  /**
   * loadQuestionsForDeck — fetch all questions for a deck from IndexedDB.
   *
   * Caches in memory so subsequent reads are instant.
   */
  loadQuestionsForDeck: async (deckId: string) => {
    set({ loadingDeckId: deckId, error: null });
    try {
      const questions = await getQuestionsByDeck(deckId);
      set((state) => ({
        questionsByDeck: { ...state.questionsByDeck, [deckId]: questions },
        loadingDeckId: null,
      }));
    } catch (error) {
      log.error('load_questions_failed', `Failed to load questions for deck ${deckId}`, error);
      set({ loadingDeckId: null, error: 'Failed to load questions' });
    }
  },

  /**
   * upsertQuestion — add or update a single question.
   */
  upsertQuestion: async (question: Question) => {
    // 0. Immediately request write permission synchronously within user click gesture frame
    prepareFileHandlePermission(question.deck_id);

    try {
      await upsertQuestion(question);
      // Update in-memory cache
      set((state) => {
        const existing = state.questionsByDeck[question.deck_id] ?? [];
        const idx = existing.findIndex((q) => q.id === question.id);
        const updated = idx >= 0
          ? existing.map((q) => q.id === question.id ? question : q)
          : [...existing, question];
        return {
          questionsByDeck: {
            ...state.questionsByDeck,
            [question.deck_id]: updated,
          },
        };
      });

      // Sync deck question count, source labels, and disk file
      await syncDeckToFile(question.deck_id);

      if (typeof window !== 'undefined') {
        const { useSettingsStore } = await import('@/stores/settingsStore');
        if (useSettingsStore.getState().auto_sync) {
          import('@/lib/syncEngine').then(({ triggerManualPickerSync }) => {
            void triggerManualPickerSync();
          });
        }
      }
    } catch (error) {
      log.error('upsert_question_failed', `Failed to upsert question ${question.id}`, error);
      set({ error: 'Failed to save question' });
    }
  },

  /**
   * upsertQuestions — bulk upsert (used during sync from GitHub/Obsidian).
   */
  upsertQuestions: async (questions: Question[]) => {
    if (questions.length === 0) return;
    try {
      await upsertQuestions(questions);
      // Update in-memory caches and deck question counts directly from IndexedDB
      const affectedDeckIds = Array.from(new Set(questions.map((q) => q.deck_id)));
      const updatedCacheEntries: Record<string, Question[]> = {};

      for (const deckId of affectedDeckIds) {
        const stored = await getQuestionsByDeck(deckId);
        updatedCacheEntries[deckId] = stored;
        void useDeckStore.getState().updateDeck(deckId, {
          question_count: stored.length,
        });
      }

      set((state) => ({
        questionsByDeck: {
          ...state.questionsByDeck,
          ...updatedCacheEntries,
        },
      }));
    } catch (error) {
      log.error('bulk_upsert_failed', 'Failed to bulk upsert questions', error);
    }
  },

  /**
   * deleteQuestion — remove a question from store, IndexedDB, and disk file.
   */
  deleteQuestion: async (id: string, deckId: string) => {
    // 0. Immediately request write permission synchronously within user click gesture frame
    prepareFileHandlePermission(deckId);

    try {
      // 1. Delete from IndexedDB
      await deleteFromIDB(id);

      // 2. Remove from in-memory cache
      set((state) => ({
        questionsByDeck: {
          ...state.questionsByDeck,
          [deckId]: (state.questionsByDeck[deckId] ?? []).filter((q) => q.id !== id),
        },
      }));

      // 4. Sync deck question count, source labels in Import section, and disk file
      await syncDeckToFile(deckId);

      if (typeof window !== 'undefined') {
        const { useSettingsStore } = await import('@/stores/settingsStore');
        if (useSettingsStore.getState().auto_sync) {
          import('@/lib/syncEngine').then(({ triggerManualPickerSync }) => {
            void triggerManualPickerSync();
          });
        }
      }
    } catch (error) {
      log.error('delete_question_failed', `Failed to delete question ${id}`, error);
    }
  },

  /**
   * startSession — build and start a study session for a deck or global pool.
   *
   * Mode behavior:
   *   - Individual deck (`deckId` specified): plays ALL questions in series (1..N).
   *     Replaying the deck always retains all original questions.
   *   - Global pool (`deckId` null/'all'): plays questions across ALL decks, leveraging
   *     the 4 SRS recall rating options (Forgot, Hard, Good, Easy) for random retention test.
   */
  startSession: async (deckId?: string | null, mode: StudySession['mode'] = 'srs', limit?: number, filterType?: import('@/types/question').QuestionType) => {
    log.info('session_start', `Starting ${mode} session for deck ${deckId ?? 'global'}`);

    try {
      const isTypeFilter = Boolean(deckId?.startsWith('type:') || filterType);
      const targetType = isTypeFilter ? (deckId?.startsWith('type:') ? deckId.replace('type:', '') : filterType) : undefined;
      const isGlobal = !deckId || deckId === 'all' || deckId === 'global' || isTypeFilter;

      let questions: Question[] = [];

      if (isGlobal) {
        // Global Random Test / Type Filter mode:
        // PULLS ALL CARDS ACROSS ALL DECKS IN THE WORKSPACE.
        const idbQuestions = await getAllQuestions();
        const storeQuestions = Object.values(get().questionsByDeck).flat();

        const questionMap = new Map<string, Question>();
        idbQuestions.forEach((q) => questionMap.set(q.id, q));
        storeQuestions.forEach((q) => {
          if (!questionMap.has(q.id)) questionMap.set(q.id, q);
        });

        let allQuestions = Array.from(questionMap.values());

        if (targetType) {
          allQuestions = allQuestions.filter((q) => q.type === targetType);
        }

        questions = [...allQuestions].sort(() => Math.random() - 0.5);
      } else {
        // Individual Deck Mode: ALWAYS play ALL questions in series (1 to N)
        const deckQuestions = await getQuestionsByDeck(deckId!);
        questions = [...deckQuestions].sort(() => Math.random() - 0.5);
      }

      // Apply limit if specified
      if (limit && limit > 0 && limit < 999999) {
        questions = questions.slice(0, limit);
      }

      if (questions.length === 0) {
        log.info('session_empty', 'No questions found for this session');
        set({ activeSession: null, currentCardIndex: 0 });
        return;
      }

      const now = new Date().toISOString();
      const sessionDeckId = isTypeFilter ? (deckId ?? `type:${targetType}`) : (isGlobal ? 'all' : deckId!);
      const session: StudySession = {
        id: generateSessionId(),
        deck_id: sessionDeckId,
        deck_ids: isGlobal ? Array.from(new Set(questions.map((q) => q.deck_id))) : [deckId!],
        mode,
        question_ids: questions.map((q) => q.id),
        attempts: [],
        started_at: now,
        finished_at: null,
        score: 0,
        total_cards: questions.length,
        correct_count: 0,
      };

      // Pre-load the questions into the cache
      set((state) => {
        const questionsByDeckMap = { ...state.questionsByDeck };
        if (isGlobal) {
          for (const q of questions) {
            if (!questionsByDeckMap[q.deck_id]) {
              questionsByDeckMap[q.deck_id] = [];
            }
            if (!questionsByDeckMap[q.deck_id].some((x) => x.id === q.id)) {
              questionsByDeckMap[q.deck_id].push(q);
            }
          }
          questionsByDeckMap[sessionDeckId] = questions;
          if (sessionDeckId !== 'all') {
            questionsByDeckMap['all'] = questions;
          }
        } else {
          questionsByDeckMap[deckId!] = questions;
        }

        return {
          questionsByDeck: questionsByDeckMap,
          activeSession: session,
          currentCardIndex: 0,
        };
      });
    } catch (error) {
      log.error('session_start_failed', 'Failed to start study session', error);
      set({ error: 'Failed to start session' });
    }
  },

  /**
   * answerCurrentCard — score the user's answer and update SRS.
   *
   * @param userAnswer   What the user submitted
   * @param timeTakenMs  Time from question shown to answer submitted
   * @returns            true if correct, false if wrong
   */
  answerCurrentCard: async (userAnswer: string | string[], timeTakenMs: number): Promise<boolean> => {
    const { activeSession, currentCardIndex } = get();
    if (!activeSession) return false;

    const questionId = activeSession.question_ids[currentCardIndex];
    if (!questionId) return false;

    // Find the question
    let question: Question | undefined;
    for (const questions of Object.values(get().questionsByDeck)) {
      question = questions.find((q) => q.id === questionId);
      if (question) break;
    }
    if (!question) return false;

    // Score the answer using the per-type engine
    const scoreResult = scoreAnswer(question, userAnswer, timeTakenMs);
    const isCorrect = scoreResult.is_correct;

    // Build the attempt record
    const attempt: AnswerAttempt = {
      question_id: questionId,
      session_id: activeSession.id,
      user_answer: userAnswer,
      is_correct: isCorrect,
      time_taken_ms: timeTakenMs,
      answered_at: new Date().toISOString(),
    };

    // Update SRS data for the question
    const newSRS = updateSRS(question.srs, isCorrect, timeTakenMs);
    const updatedQuestion: Question = {
      ...question,
      srs: newSRS,
      updated_at: new Date().toISOString(),
    };

    // Persist updated question SRS directly to IndexedDB without triggering disk file syncs during study
    await upsertQuestion(updatedQuestion);

    // Update the session
    set((state) => {
      if (!state.activeSession) return {};
      const attempts = [...state.activeSession.attempts, attempt];

      const sessionQuestionIds = state.activeSession.question_ids;
      const latestAttemptMap = new Map<string, boolean>();
      attempts.forEach((att) => {
        latestAttemptMap.set(att.question_id, att.is_correct);
      });

      let uniqueCorrect = 0;
      sessionQuestionIds.forEach((qId) => {
        if (latestAttemptMap.get(qId) === true) uniqueCorrect++;
      });

      const newSession: StudySession = {
        ...state.activeSession,
        attempts,
        correct_count: uniqueCorrect,
        score: Math.round((uniqueCorrect / Math.max(1, sessionQuestionIds.length)) * 100),
      };

      // Also update the deck stats due_today count in deck store
      const deckStore = useDeckStore.getState();
      const deck = deckStore.decks[newSession.deck_id ?? ''];
      if (deck) {
        const currentDue = deck.stats?.due_today ?? 0;
        const newDue = Math.max(0, currentDue - 1);

        void deckStore.upsertDeck({
          ...deck,
          stats: {
            ...deck.stats,
            due_today: newDue,
            total_reviews: (deck.stats?.total_reviews ?? 0) + 1,
            correct_count: (deck.stats?.correct_count ?? 0) + (isCorrect ? 1 : 0),
            accuracy_percent: Math.round(
              (((deck.stats?.correct_count ?? 0) + (isCorrect ? 1 : 0)) /
              ((deck.stats?.total_reviews ?? 0) + 1)) * 100
            ),
          },
        });
      }

      return { activeSession: newSession };
    });

    recordStudyActivity(1);
    return isCorrect;
  },

  /**
   * rateCurrentCard — process SRS recall rating (Forgot, Hard, Good, Easy).
   * Re-inserts 'again' (Forgot) and 'hard' cards into the session queue so they reappear
   * during the current test session for review.
   */
  rateCurrentCard: async (rating: 'again' | 'hard' | 'good' | 'easy') => {
    const { activeSession, currentCardIndex } = get();
    if (!activeSession) return;

    const questionId = activeSession.question_ids[currentCardIndex];
    if (!questionId) return;

    let question: Question | undefined;
    for (const questions of Object.values(get().questionsByDeck)) {
      question = questions.find((q) => q.id === questionId);
      if (question) break;
    }
    if (!question) return;

    const isGlobal = !activeSession.deck_id || activeSession.deck_id === 'all' || activeSession.deck_id === 'global';
    const isCorrect = rating !== 'again';
    const now = new Date().toISOString();
    let { interval, ease_factor, repetitions } = question.srs;

    // Time-based session delay limit in milliseconds:
    // Forgot (< 1m): randomized 40s to 55s delay
    // Hard (10m): 10 minutes (600,000 ms) delay
    let sessionDelayMs: number | null = null;

    if (rating === 'again') {
      repetitions = 0;
      interval = 1;
      ease_factor = Math.max(1.3, Math.round((ease_factor - 0.2) * 100) / 100);
      const randomSec = Math.floor(Math.random() * 16) + 40; // 40s - 55s
      sessionDelayMs = randomSec * 1000;
    } else if (rating === 'hard') {
      interval = Math.max(1, Math.round(interval * 1.2));
      ease_factor = Math.max(1.3, Math.round((ease_factor - 0.15) * 100) / 100);
      repetitions += 1;
      sessionDelayMs = 10 * 60 * 1000;
    } else if (rating === 'good') {
      if (repetitions === 0) interval = 1;
      else if (repetitions === 1) interval = 6;
      else interval = Math.round(interval * ease_factor);
      repetitions += 1;
    } else if (rating === 'easy') {
      if (repetitions === 0) interval = 4;
      else if (repetitions === 1) interval = 7;
      else interval = Math.round(interval * ease_factor * 1.3);
      ease_factor = Math.round((ease_factor + 0.15) * 100) / 100;
      repetitions += 1;
    }

    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + interval);
    nextReview.setHours(0, 0, 0, 0);

    const newSRS = {
      interval,
      ease_factor,
      repetitions,
      next_review: nextReview.toISOString(),
      last_reviewed: now,
      review_count: (question.srs.review_count ?? 0) + 1,
    };

    const updatedQuestion: Question = {
      ...question,
      srs: newSRS,
      updated_at: now,
    };

    // ALWAYS persist updated question SRS data directly to IndexedDB
    await upsertQuestion(updatedQuestion);

    // In Individual Deck Mode (!isGlobal), the 4 SRS options only route the card for future Random Tests
    // and MUST NOT overwrite the individual session's intrinsic answer correctness or parameters.
    set((state) => {
      if (!state.activeSession) return {};

      const { currentCardIndex } = state;
      const pastIds = state.activeSession.question_ids.slice(0, currentCardIndex + 1);
      let remainingIds = state.activeSession.question_ids.slice(currentCardIndex + 1);
      const scheduledTimers = { ...(state.activeSession.scheduled_timers ?? {}) };

      // Check if an attempt for this question was already recorded by answerCurrentCard
      const existingAttemptIndex = state.activeSession.attempts.findIndex((a) => a.question_id === questionId);
      let attempts = [...state.activeSession.attempts];

      if (isGlobal || existingAttemptIndex === -1) {
        const attempt: AnswerAttempt = {
          question_id: questionId,
          session_id: state.activeSession.id,
          user_answer: rating,
          is_correct: isCorrect,
          time_taken_ms: 3000,
          answered_at: now,
        };

        if (existingAttemptIndex >= 0) {
          attempts[existingAttemptIndex] = attempt;
        } else {
          attempts.push(attempt);
        }
      }

      // Check if this card is the LAST card in the session queue
      const isLastCard = remainingIds.length === 0 && Object.keys(scheduledTimers).length <= 1;

      if (isGlobal && sessionDelayMs !== null && !isLastCard) {
        scheduledTimers[questionId] = Date.now() + sessionDelayMs;
        remainingIds = remainingIds.filter((id) => id !== questionId);
      } else {
        delete scheduledTimers[questionId];
        if (isGlobal) {
          remainingIds = remainingIds.filter((id) => id !== questionId);
        }
      }

      const newQuestionIds = [...pastIds, ...remainingIds];

      const latestAttemptMap = new Map<string, boolean>();
      attempts.forEach((att) => {
        latestAttemptMap.set(att.question_id, att.is_correct);
      });

      let uniqueCorrect = 0;
      latestAttemptMap.forEach((isCorr) => {
        if (isCorr) uniqueCorrect++;
      });

      const newSession: StudySession = {
        ...state.activeSession,
        question_ids: newQuestionIds,
        scheduled_timers: scheduledTimers,
        attempts,
        correct_count: uniqueCorrect,
        total_cards: newQuestionIds.length,
        score: Math.round((uniqueCorrect / Math.max(1, newQuestionIds.length)) * 100),
      };

      const deckStore = useDeckStore.getState();
      const targetDeckId = question.deck_id || newSession.deck_id;
      const deck = deckStore.decks[targetDeckId ?? ''];
      if (deck) {
        void deckStore.upsertDeck({
          ...deck,
          stats: {
            ...deck.stats,
            total_reviews: (deck.stats?.total_reviews ?? 0) + 1,
            correct_count: (deck.stats?.correct_count ?? 0) + (isCorrect ? 1 : 0),
            accuracy_percent: Math.round(
              (((deck.stats?.correct_count ?? 0) + (isCorrect ? 1 : 0)) /
              ((deck.stats?.total_reviews ?? 0) + 1)) * 100
            ),
          },
        });
      }

      return { activeSession: newSession };
    });

    // Advance to next card or loop back
    get().nextCard();
    recordStudyActivity(1);
  },

  /**
   * nextCard — advance to the next card in the session queue.
   * Dynamically checks scheduled_timers to insert expired cards right after current card.
   */
  nextCard: () => {
    const { activeSession, currentCardIndex } = get();
    if (!activeSession) return;

    const now = Date.now();
    const scheduledTimers = { ...(activeSession.scheduled_timers ?? {}) };
    let questionIds = [...activeSession.question_ids];
    let timersChanged = false;

    // Check if any scheduled card's time limit has expired
    const expiredCardIds = Object.entries(scheduledTimers)
      .filter(([_, dueTimestamp]) => dueTimestamp <= now)
      .sort((a, b) => a[1] - b[1]) // Earliest expired time limit first
      .map(([id]) => id);

    if (expiredCardIds.length > 0) {
      const nextIndex = currentCardIndex + 1;
      const past = questionIds.slice(0, nextIndex);
      let remaining = questionIds.slice(nextIndex);

      for (const cardId of expiredCardIds) {
        if (!remaining.includes(cardId)) {
          remaining.unshift(cardId); // Dynamically insert at very front of upcoming cards!
        }
        delete scheduledTimers[cardId];
        timersChanged = true;
      }

      questionIds = [...past, ...remaining];
    }

    let nextIndex = currentCardIndex + 1;

    // If main queue reached the end, check if any cards are still waiting on active timers
    if (nextIndex >= questionIds.length) {
      const pendingTimerIds = Object.keys(scheduledTimers);
      if (pendingTimerIds.length > 0) {
        const past = questionIds.slice(0, nextIndex);
        const remaining = pendingTimerIds.filter((id) => !past.slice(nextIndex).includes(id));
        questionIds = [...past, ...remaining];
      }
    }

    if (nextIndex >= questionIds.length) {
      // Session complete
      get().endSession();
    } else {
      set((state) => {
        if (!state.activeSession) return {};
        return {
          currentCardIndex: nextIndex,
          activeSession: {
            ...state.activeSession,
            question_ids: questionIds,
            scheduled_timers: timersChanged ? scheduledTimers : state.activeSession.scheduled_timers,
            total_cards: questionIds.length,
          },
        };
      });
    }
  },

  /**
   * previousCard — go back to the previous card.
   */
  previousCard: () => {
    const { currentCardIndex } = get();
    if (currentCardIndex > 0) {
      set({ currentCardIndex: currentCardIndex - 1 });
    }
  },

  /**
   * endSession — finalize and clear the active session.
   */
  endSession: () => {
    const session = get().activeSession;
    if (!session) return;

    const finishedSession: StudySession = {
      ...session,
      finished_at: new Date().toISOString(),
    };

    // Record today as a study day for streak tracking
    updateStreak();
    recordStudyActivity(session.correct_count || 1);

    // Record deck completion counter and best time
    if (typeof window !== 'undefined' && session.deck_id) {
      try {
        const deckId = session.deck_id;
        const compKey = `noledge_deck_completions_${deckId}`;
        const prevCompletions = parseInt(localStorage.getItem(compKey) || '0', 10);
        localStorage.setItem(compKey, String(prevCompletions + 1));

        const startTime = new Date(session.started_at).getTime();
        const finishTime = Date.now();
        const durationSec = Math.max(1, Math.round((finishTime - startTime) / 1000));

        const timeKey = `noledge_deck_best_time_${deckId}`;
        const prevBest = localStorage.getItem(timeKey);
        if (!prevBest || durationSec < parseInt(prevBest, 10)) {
          localStorage.setItem(timeKey, String(durationSec));
        }

        // Record best accuracy achieved in a session
        const sessionAccuracy = session.total_cards > 0
          ? Math.round((session.correct_count / session.total_cards) * 100)
          : 0;
        const accKey = `noledge_deck_best_acc_${deckId}`;
        const prevBestAcc = parseInt(localStorage.getItem(accKey) || '0', 10);
        if (sessionAccuracy > prevBestAcc) {
          localStorage.setItem(accKey, String(sessionAccuracy));
        }
      } catch (err) {
        log.error('record_deck_stats_failed', 'Failed saving deck completion stats', err);
      }
    }

    log.info('session_end', `Session ${session.id} ended`, {
      score: finishedSession.score,
      total: finishedSession.total_cards,
      correct: finishedSession.correct_count,
    });

    set({ activeSession: finishedSession, currentCardIndex: 0 });
  },

  clearSession: () => {
    set({ activeSession: null, currentCardIndex: 0 });
  },

  /**
   * getCurrentQuestion — get the question currently displayed in the session.
   *
   * Returns null if no session is active or the index is out of bounds.
   */
  getCurrentQuestion: (): Question | null => {
    const { activeSession, currentCardIndex, questionsByDeck } = get();
    if (!activeSession) return null;

    const questionId = activeSession.question_ids[currentCardIndex];
    if (!questionId) return null;

    for (const questions of Object.values(questionsByDeck)) {
      const found = questions.find((q) => q.id === questionId);
      if (found) return found;
    }
    return null;
  },
}));
