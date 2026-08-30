/**
 * @file engine/scoring/streakTracker.ts
 * @description Daily study streak tracking using localStorage.
 *
 * A "streak" is the number of consecutive calendar days the user has studied
 * at least one card. This is a motivational mechanism — the same pattern used
 * by Duolingo, Anki, and Habitica. Research shows streaks increase retention
 * rates for spaced repetition systems by keeping users consistent.
 *
 * STORAGE:
 * Streak data is stored in localStorage under the key 'noledge:streak'.
 * It is NOT stored in IndexedDB (too heavyweight for a 3-field record) and
 * NOT in Supabase (we want instant reads with no network round-trip).
 *
 * FORMAT (JSON in localStorage):
 *   {
 *     current_streak: 7,
 *     longest_streak: 23,
 *     last_study_date: "2026-08-01"  // ISO date string, no time component
 *   }
 *
 * RULES:
 *   - Studying on two different calendar days (regardless of time) = two days
 *   - If the user studies today and yesterday = streak continues
 *   - If the user last studied 2+ days ago = streak resets to 1 (today)
 *   - If the user studies multiple times today = streak stays at current value
 *     (only one study session per day counts toward the streak)
 *
 * TIMEZONE NOTE:
 * Dates are compared using the LOCAL calendar date (not UTC). This means the
 * streak rolls over at local midnight, which matches user expectation.
 * We use Date().toLocaleDateString('en-CA') which returns "YYYY-MM-DD" format
 * in the local timezone on all platforms.
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('streak');

// =============================================================================
// Constants
// =============================================================================

/**
 * STREAK_STORAGE_KEY — localStorage key for the streak data JSON.
 */
const STREAK_STORAGE_KEY = 'noledge:streak';

// =============================================================================
// Types
// =============================================================================

/**
 * StreakData — the complete streak record stored in localStorage.
 *
 * Fields:
 *   current_streak   — How many consecutive days the user has studied.
 *                      Resets to 1 (not 0) when broken — the current day
 *                      always counts if updateStreak() was called today.
 *   longest_streak   — Historical maximum of current_streak. Never resets.
 *   last_study_date  — The last date the user studied, in "YYYY-MM-DD" format.
 *                      Null means the user has never studied.
 */
export interface StreakData {
  current_streak: number;
  longest_streak: number;
  last_study_date: string | null;
}

// =============================================================================
// Date Helpers
// =============================================================================

/**
 * getTodayString — returns today's date as "YYYY-MM-DD" in local timezone.
 *
 * Uses 'en-CA' locale because Canadian English locale returns ISO format
 * "YYYY-MM-DD" consistently across all platforms, which is what we need for
 * string comparison. This is a well-known trick for cross-platform ISO dates.
 *
 * @returns  Today's date as "YYYY-MM-DD"
 */
function getTodayString(): string {
  return new Date().toLocaleDateString('en-CA');
}

/**
 * daysBetween — compute the number of calendar days between two date strings.
 *
 * This is NOT 24-hour distance. "2026-08-01" to "2026-08-02" = 1 day,
 * regardless of what time it is. We use UTC midnight to avoid DST issues
 * in the day-difference calculation.
 *
 * @param dateA  Earlier date in "YYYY-MM-DD" format
 * @param dateB  Later date in "YYYY-MM-DD" format
 * @returns      Number of calendar days from dateA to dateB (always >= 0)
 */
function daysBetween(dateA: string, dateB: string): number {
  const msPerDay = 86_400_000; // 24 * 60 * 60 * 1000
  const a = new Date(dateA + 'T00:00:00Z').getTime();
  const b = new Date(dateB + 'T00:00:00Z').getTime();
  return Math.round((b - a) / msPerDay);
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * loadStreak — read the current streak data from localStorage.
 *
 * Returns a default zero-state if localStorage is empty or the data
 * cannot be parsed (corrupted / first launch).
 *
 * Safe to call server-side (returns default if localStorage is unavailable,
 * which is the case during Next.js SSR).
 *
 * @returns  The current StreakData, or zero-state if not found
 */
export function loadStreak(): StreakData {
  if (typeof localStorage === 'undefined') {
    // Server-side rendering — localStorage not available
    return { current_streak: 0, longest_streak: 0, last_study_date: null };
  }

  try {
    const raw = localStorage.getItem(STREAK_STORAGE_KEY);
    if (!raw) return { current_streak: 0, longest_streak: 0, last_study_date: null };
    return JSON.parse(raw) as StreakData;
  } catch {
    log.warn('streak_load_failed', 'Failed to parse streak data from localStorage — resetting');
    return { current_streak: 0, longest_streak: 0, last_study_date: null };
  }
}

/**
 * updateStreak — record that the user studied today and update the streak.
 *
 * This function is IDEMPOTENT for a given calendar day: calling it multiple
 * times today will not increment the streak multiple times. Only the first
 * call per day has an effect.
 *
 * Should be called once per study session, at session end.
 *
 * Algorithm:
 *   1. Load current streak from localStorage
 *   2. Compute days since last study
 *   3. If 0 days (already studied today): no change
 *   4. If 1 day (yesterday): increment current_streak
 *   5. If 2+ days (streak broken): reset to 1
 *   6. Update longest_streak if current_streak exceeds it
 *   7. Save and return the new data
 *
 * @returns  The updated StreakData after recording today's study
 */
export function updateStreak(): StreakData {
  const current = loadStreak();
  const today = getTodayString();

  let newCurrent = current.current_streak;

  if (current.last_study_date === null) {
    // First ever study session
    newCurrent = 1;
    log.info('streak_start', 'First study session — streak begins at 1');
  } else if (current.last_study_date === today) {
    // Already studied today — no change to streak
    log.debug('streak_already_today', `Already studied today (${today}), streak unchanged`);
    return current;
  } else {
    const gap = daysBetween(current.last_study_date, today);
    if (gap === 1) {
      // Consecutive day — increment
      newCurrent = current.current_streak + 1;
      log.info('streak_continued', `Streak continued: ${current.current_streak} → ${newCurrent}`);
    } else {
      // Missed at least one day — reset
      newCurrent = 1;
      log.info(
        'streak_broken',
        `Streak broken after ${gap - 1} missed day(s). Was ${current.current_streak}, reset to 1`
      );
    }
  }

  const newLongest = Math.max(current.longest_streak, newCurrent);

  const updated: StreakData = {
    current_streak: newCurrent,
    longest_streak: newLongest,
    last_study_date: today,
  };

  try {
    localStorage.setItem(STREAK_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    log.warn('streak_save_failed', 'Failed to save streak data to localStorage');
  }

  return updated;
}

/**
 * getStreakEmoji — returns a motivational emoji based on the current streak.
 *
 * Used in the home screen and session-complete screen to give users
 * instant visual feedback on their consistency.
 *
 * Thresholds:
 *   30+  → 💎 Diamond (exceptional commitment)
 *   14+  → 🔥 Fire (two weeks strong)
 *   7+   → ⚡ Lightning (one week streak)
 *   3+   → ✨ Sparkles (building momentum)
 *   1+   → 📚 Books (just started)
 *   0    → ''  (no emoji — user hasn't started yet)
 *
 * @param streak  The current_streak value
 * @returns       An emoji string, or empty string if streak is 0
 */
export function getStreakEmoji(streak: number): string {
  if (streak >= 30) return '💎';
  if (streak >= 14) return '🔥';
  if (streak >= 7)  return '⚡';
  if (streak >= 3)  return '✨';
  if (streak >= 1)  return '📚';
  return '';
}
