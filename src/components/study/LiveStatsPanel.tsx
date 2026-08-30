/**
 * @file components/study/LiveStatsPanel.tsx
 * @description Desktop live study analytics sidebar panel.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Flame, Target, Layers, Clock, Award, Zap } from 'lucide-react';
import { useQuestionStore } from '@/stores/questionStore';
import styles from './LiveStatsPanel.module.css';

function formatBestTime(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '0 min';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m} min`;
}

export default function LiveStatsPanel() {
  const { activeSession, currentCardIndex } = useQuestionStore();
  const [deckCompletions, setDeckCompletions] = useState<number>(0);
  const [bestTimeSec, setBestTimeSec] = useState<number | null>(null);

  useEffect(() => {
    if (!activeSession?.deck_id) return;
    try {
      const deckId = activeSession.deck_id;
      const compVal = localStorage.getItem(`noledge_deck_completions_${deckId}`);
      setDeckCompletions(compVal ? parseInt(compVal, 10) : 0);

      const timeVal = localStorage.getItem(`noledge_deck_best_time_${deckId}`);
      setBestTimeSec(timeVal ? parseInt(timeVal, 10) : null);
    } catch {
      // Storage fallback
    }
  }, [activeSession?.deck_id]);

  if (!activeSession) return null;

  const total = activeSession.total_cards;
  const answered = currentCardIndex;
  const attempts = activeSession.attempts;

  const latestAttemptMap = new Map<string, boolean>();
  attempts.forEach((att) => {
    latestAttemptMap.set(att.question_id, att.is_correct);
  });

  const uniqueAttemptedCount = latestAttemptMap.size;
  let correct = 0;
  latestAttemptMap.forEach((isCorrect) => {
    if (isCorrect) correct++;
  });

  const wrong = uniqueAttemptedCount - correct;
  const unanswered = Math.max(0, total - uniqueAttemptedCount);

  // Total-based accuracy formula factoring in Correct, Wrong, and Unanswered out of Total Deck Size
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  const xpEarned = answered * 10 + correct * 15;

  return (
    <aside className={styles.statsPanel} aria-label="Live Session Analytics">
      <div className={styles.panelHeader}>
        <Award size={16} className="text-accent" />
        <span className={styles.panelTitle}>Live Session Stats</span>
      </div>

      <div className={styles.statsGrid}>
        {/* 1. Deck Completion Count */}
        <div className={styles.statCard}>
          <div className={styles.statIconWrapper} style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>
            <Flame size={16} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Completed</span>
            <span className={styles.statValue}>{deckCompletions}</span>
          </div>
        </div>

        {/* 2. Best Completion Time */}
        <div className={styles.statCard}>
          <div className={styles.statIconWrapper} style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}>
            <Clock size={16} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Best Time</span>
            <span className={styles.statValue}>{formatBestTime(bestTimeSec)}</span>
          </div>
        </div>

        {/* 3. Questions Answered Progress */}
        <div className={styles.statCard}>
          <div className={styles.statIconWrapper} style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}>
            <Layers size={16} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Progress</span>
            <span className={styles.statValue}>{answered} / {total}</span>
          </div>
        </div>

        {/* 4. Accuracy Percentage (Total-based formula) */}
        <div className={styles.statCard} title={`Correct: ${correct} • Wrong: ${wrong} • Unanswered: ${unanswered}`}>
          <div className={styles.statIconWrapper} style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
            <Target size={16} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Accuracy</span>
            <span className={styles.statValue}>{accuracy}%</span>
          </div>
        </div>

        {/* Session XP */}
        <div className={styles.statCard} style={{ gridColumn: 'span 2' }}>
          <div className={styles.statIconWrapper} style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>
            <Zap size={16} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Session XP</span>
            <span className={styles.statValue}>+{xpEarned} XP</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
