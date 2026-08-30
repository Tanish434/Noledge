/**
 * @file engine/srs/sm2.ts
 * @description Implementation of the SM-2 Spaced Repetition algorithm.
 *
 * SM-2 (SuperMemo 2) is the algorithm that powers Anki and most modern
 * flashcard apps. It was developed by Piotr Wozniak at SuperMemo in 1987
 * and published in 1990. The algorithm optimizes WHEN to show each card
 * to achieve maximum long-term retention with minimum study time.
 *
 * HOW SM-2 WORKS:
 *
 * Each card has three key values:
 *   - interval: days until next review
 *   - ease_factor: multiplier applied to interval on correct answers (starts at 2.5)
 *   - repetitions: consecutive correct answers streak
 *
 * After each review, the algorithm is:
 *   1. Grade the response: 0-5 (0=blackout, 5=perfect instant recall)
 *      Noledge simplifies to quality grades (see calculateQuality() below)
 *   2. If grade >= 3 (correct):
 *      - If repetitions == 0: interval = 1 day
 *      - If repetitions == 1: interval = 6 days
 *      - If repetitions >= 2: interval = interval * ease_factor
 *      - ease_factor += 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)
 *      - Ensure ease_factor >= 1.3 (minimum)
 *      - repetitions += 1
 *   3. If grade < 3 (wrong):
 *      - repetitions = 0
 *      - interval = 1 (show again tomorrow)
 *      - ease_factor -= 0.2 (penalize)
 *
 * SOURCE: https://www.supermemo.com/en/archives1990-2015/english/ol/sm2
 *
 * NOLEDGE MODIFICATIONS TO STANDARD SM-2:
 *   1. We add a "fast correct" bonus: answering correctly in under 3 seconds
 *      sets quality=5 instead of quality=4, giving a small extra interval boost.
 *   2. We cap the maximum interval at 365 days. SM-2 intervals can grow to
 *      years for very well-known cards, but we don't want items disappearing
 *      from study completely — annual review keeps the knowledge fresh.
 *   3. We round intervals to integers (SM-2 can produce fractional days).
 */

import type { SRSData } from '@/types/question';
import {
  SM2_INITIAL_EASE_FACTOR,
  SM2_MIN_EASE_FACTOR,
  SM2_INITIAL_INTERVAL_DAYS,
  ANSWER_CORRECT_THRESHOLD_MS,
} from '@/lib/constants';

// =============================================================================
// Constants (SM-2 specific, not app-level)
// =============================================================================

/**
 * SM2_SECOND_INTERVAL — interval for the second successful review.
 *
 * Standard SM-2 specification value. After getting a card right twice
 * in a row (repetitions = 1 → 2), the next interval is 6 days.
 */
const SM2_SECOND_INTERVAL = 6;

/**
 * SM2_MAX_INTERVAL — maximum interval cap (Noledge modification).
 *
 * See module docstring for rationale.
 */
const SM2_MAX_INTERVAL = 365;

/**
 * SM2_QUALITY_CORRECT_FAST — quality grade for fast correct answer.
 *
 * Quality 5 = "perfect response" in SM-2 terminology.
 * Used when the user answers correctly under ANSWER_CORRECT_THRESHOLD_MS.
 */
const SM2_QUALITY_CORRECT_FAST = 5;

/**
 * SM2_QUALITY_CORRECT — quality grade for normal correct answer.
 *
 * Quality 4 = "correct response after hesitation" in SM-2 terminology.
 */
const SM2_QUALITY_CORRECT = 4;

/**
 * SM2_QUALITY_WRONG — quality grade for wrong answer.
 *
 * Quality 1 = "wrong response, but the correct one remembered" in SM-2.
 * We use 1 (not 0, which is "blackout") because the user at least saw
 * the correct answer in our reveal phase.
 */
const SM2_QUALITY_WRONG = 1;

// =============================================================================
// Quality Calculation
// =============================================================================

/**
 * calculateQuality — convert a boolean answer + timing into an SM-2 quality grade.
 *
 * SM-2 grades range from 0 to 5. Noledge maps to this scale based on:
 *   - Whether the answer was correct (isCorrect)
 *   - How quickly they answered (timeTakenMs) — fast correct = bonus grade
 *
 * @param isCorrect   Whether the answer was judged correct
 * @param timeTakenMs How long the user took to answer (milliseconds)
 * @returns           An SM-2 quality grade from 0-5
 */
function calculateQuality(isCorrect: boolean, timeTakenMs: number): number {
  if (!isCorrect) return SM2_QUALITY_WRONG;
  if (timeTakenMs < ANSWER_CORRECT_THRESHOLD_MS) return SM2_QUALITY_CORRECT_FAST;
  return SM2_QUALITY_CORRECT;
}

// =============================================================================
// Core SM-2 Update Function
// =============================================================================

/**
 * updateSRS — apply the SM-2 algorithm after a review, returning new SRS data.
 *
 * This is a pure function — it takes the current SRS state and returns a new
 * SRS state without mutating the input. Pure functions are:
 *   - Easier to test (no side effects)
 *   - Safer in concurrent React environments
 *   - Straightforward to audit/debug
 *
 * @param current     The card's current SRS state (before this review)
 * @param isCorrect   Whether the user answered correctly
 * @param timeTakenMs How long the user took (milliseconds), for quality grade
 * @returns           New SRS state to persist after this review
 */
export function updateSRS(
  current: SRSData,
  isCorrect: boolean,
  timeTakenMs: number
): SRSData {
  const quality = calculateQuality(isCorrect, timeTakenMs);
  const now = new Date().toISOString();

  let { interval, ease_factor, repetitions } = current;

  if (quality >= 3) {
    // ─── Correct answer branch ───────────────────────────────────────────

    // Determine the next interval based on how many consecutive correct
    // answers the user has had (the "repetitions" count).
    if (repetitions === 0) {
      // First time getting this card right (or after a reset)
      interval = SM2_INITIAL_INTERVAL_DAYS;
    } else if (repetitions === 1) {
      // Second correct answer in a row
      interval = SM2_SECOND_INTERVAL;
    } else {
      // Subsequent correct answers: grow exponentially by ease_factor
      interval = Math.round(interval * ease_factor);
    }

    // Apply the maximum interval cap (Noledge modification)
    interval = Math.min(interval, SM2_MAX_INTERVAL);

    // Update ease_factor using the SM-2 formula:
    //   EF_new = EF_old + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    // For q=5: EF += 0.1          → ease increases slightly on perfect answers
    // For q=4: EF += 0           → ease unchanged on normal correct
    // For q=3: EF -= 0.14        → ease decreases slightly on hesitant correct
    ease_factor = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));

    // Clamp ease_factor to minimum (card can't become "easier" than this floor)
    ease_factor = Math.max(ease_factor, SM2_MIN_EASE_FACTOR);

    // Round ease_factor to 2 decimal places to avoid float precision drift
    ease_factor = Math.round(ease_factor * 100) / 100;

    repetitions += 1;
  } else {
    // ─── Wrong answer branch ─────────────────────────────────────────────

    // Reset the repetitions streak
    repetitions = 0;

    // Reset interval to 1 — show the card again tomorrow
    interval = SM2_INITIAL_INTERVAL_DAYS;

    // Penalize ease_factor for wrong answers
    ease_factor = Math.max(ease_factor - 0.2, SM2_MIN_EASE_FACTOR);
    ease_factor = Math.round(ease_factor * 100) / 100;
  }

  // Calculate the next review date by adding `interval` days to today
  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);
  // Set to midnight of the target day (so "due today" = any time on that date)
  nextReview.setHours(0, 0, 0, 0);

  return {
    interval,
    ease_factor,
    repetitions,
    next_review: nextReview.toISOString(),
    last_reviewed: now,
    review_count: current.review_count + 1,
  };
}

// =============================================================================
// Initial SRS State
// =============================================================================

/**
 * createInitialSRS — create the starting SRS state for a brand-new card.
 *
 * All new cards start with:
 *   - interval = 1 day (will show tomorrow if answered correctly today)
 *   - ease_factor = 2.5 (SM-2 default)
 *   - repetitions = 0 (never been answered correctly)
 *   - next_review = today (show immediately — it's new, the user should see it)
 *   - review_count = 0
 *
 * @returns SRSData for a new card
 */
export function createInitialSRS(): SRSData {
  const now = new Date();
  now.setHours(0, 0, 0, 0); // Set to midnight for consistent "due today" checks

  return {
    interval: SM2_INITIAL_INTERVAL_DAYS,
    ease_factor: SM2_INITIAL_EASE_FACTOR,
    repetitions: 0,
    next_review: now.toISOString(),
    last_reviewed: null,
    review_count: 0,
  };
}

// =============================================================================
// Scheduling Queries
// =============================================================================

/**
 * isDueToday — whether a card's next_review date is today or in the past.
 *
 * "Due today" means the card's next_review is at or before the end of today
 * (not the current time — we consider the whole day as "today").
 *
 * @param srs   The card's SRS data
 * @returns     true if the card should appear in today's study session
 */
export function isDueToday(srs: SRSData): boolean {
  const today = new Date();
  today.setHours(23, 59, 59, 999); // End of today
  const nextReview = new Date(srs.next_review);
  return nextReview <= today;
}

/**
 * getDaysUntilDue — how many days until a card is next due.
 *
 * Returns 0 for cards due today, negative for overdue cards.
 *
 * @param srs   The card's SRS data
 * @returns     Days until the card is due (can be negative for overdue)
 */
export function getDaysUntilDue(srs: SRSData): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nextReview = new Date(srs.next_review);
  nextReview.setHours(0, 0, 0, 0);
  const diffMs = nextReview.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * isMastered — whether a card is considered "mastered" (well-learned).
 *
 * A card is mastered if it has been answered correctly at least 5 times
 * in a row (repetitions >= 5). This typically means an interval of several
 * months. Mastered cards are still reviewed — they don't leave the deck —
 * but they're shown less frequently and highlighted differently in the UI.
 *
 * The threshold of 5 repetitions is somewhat arbitrary but aligns with
 * common SRS app conventions. It corresponds to ~4-6 months of interval.
 *
 * @param srs   The card's SRS data
 * @returns     true if the card is considered mastered
 */
export function isMastered(srs: SRSData): boolean {
  return srs.repetitions >= 5;
}
