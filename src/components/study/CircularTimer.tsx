/**
 * @file components/study/CircularTimer.tsx
 * @description Circular SVG animated timer with dynamic color shifting & 4-digit motion digits.
 */

'use client';

import React, { useEffect, useState, useRef } from 'react';
import { AnimateCount } from '@/components/ui/AnimateCount';
import styles from './CircularTimer.module.css';

interface CircularTimerProps {
  /** Maximum target time in seconds for full ring (default 60s) */
  maxSeconds?: number;
  className?: string;
}

import { useQuestionStore } from '@/stores/questionStore';

export default function CircularTimer({ maxSeconds = 60, className }: CircularTimerProps) {
  const activeSession = useQuestionStore((state) => state.activeSession);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!activeSession?.started_at) return;

    const startMs = new Date(activeSession.started_at).getTime();
    setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));

    const interval = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    }, 1000);

    return () => clearInterval(interval);
  }, [activeSession?.started_at]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  const minTens = Math.floor(minutes / 10);
  const minOnes = minutes % 10;
  const secTens = Math.floor(seconds / 10);
  const secOnes = seconds % 10;

  // Progress percentage (0 to 1) for SVG stroke-dashoffset
  const progress = Math.min(1, elapsed / maxSeconds);
  const radius = 12;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - progress * circumference;

  // Determine state color (Green → Yellow → Orange → Red)
  let timerState = 'normal'; // green
  if (elapsed > 45) timerState = 'danger'; // red
  else if (elapsed > 30) timerState = 'warning'; // orange
  else if (elapsed > 15) timerState = 'caution'; // yellow

  return (
    <div className={`${styles.timerContainer} ${styles[timerState]} ${className ?? ''}`} title="Session Timer">
      <span className={styles.timeText}>
        <AnimateCount>{minTens}</AnimateCount>
        <AnimateCount>{minOnes}</AnimateCount>
        <span className={styles.colon}>:</span>
        <AnimateCount>{secTens}</AnimateCount>
        <AnimateCount>{secOnes}</AnimateCount>
      </span>
    </div>
  );
}
