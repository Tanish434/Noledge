/**
 * @file lib/activityTracker.ts
 * @description Tracks and aggregates user study session and test review activity by date and user ID.
 */

import { getAllQuestions } from './storage';
import { useAuthStore } from '@/stores/authStore';

export interface ActivityDay {
  date: string; // YYYY-MM-DD
  count: number;
  level: number; // 0..4
}

function isoDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getActivityKey(userId?: string): string {
  const effectiveId = userId || useAuthStore.getState().user?.id || 'guest';
  return `noledge_study_activity_${effectiveId}`;
}

/**
 * Record study activity (reviews, tests taken) for today.
 */
export function recordStudyActivity(increment = 1, userId?: string): void {
  if (typeof window === 'undefined') return;

  try {
    const key = getActivityKey(userId);
    const today = isoDateString(new Date());
    const raw = localStorage.getItem(key);
    const activityMap: Record<string, number> = raw ? JSON.parse(raw) : {};

    activityMap[today] = (activityMap[today] || 0) + increment;
    localStorage.setItem(key, JSON.stringify(activityMap));

    // Dispatch update event for live UI reactivity
    window.dispatchEvent(new CustomEvent('noledge_activity_updated', {
      detail: { date: today, count: activityMap[today] },
    }));
  } catch (err) {
    console.error('Failed to record study activity:', err);
  }
}

/**
 * Get aggregated activity history across the past N months.
 */
export async function getStudyActivityHistory(months = 9, userId?: string): Promise<ActivityDay[]> {
  const days = Math.ceil(months * 30.5);
  const today = new Date();
  const activityMap: Record<string, number> = {};

  // 1. Read from localStorage for recorded sessions
  if (typeof window !== 'undefined') {
    try {
      const key = getActivityKey(userId);
      const raw = localStorage.getItem(key);
      if (raw) {
        Object.assign(activityMap, JSON.parse(raw));
      }
    } catch {
      // Non-fatal
    }
  }

  // 2. Also aggregate question SRS last_reviewed timestamps from IndexedDB
  try {
    const allQuestions = await getAllQuestions();
    for (const q of allQuestions) {
      if (q?.srs?.last_reviewed) {
        const revDate = isoDateString(new Date(q.srs.last_reviewed));
        if (revDate) {
          // If not already counted in daily session logs, seed baseline
          if (!activityMap[revDate]) {
            activityMap[revDate] = (activityMap[revDate] || 0) + 1;
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // 3. Build continuous date series for the last N months
  const result: ActivityDay[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = isoDateString(d);
    const count = activityMap[dateStr] || 0;

    let level = 0;
    if (count >= 20) level = 4;
    else if (count >= 10) level = 3;
    else if (count >= 5) level = 2;
    else if (count >= 1) level = 1;

    result.push({
      date: dateStr,
      count,
      level,
    });
  }

  return result;
}
