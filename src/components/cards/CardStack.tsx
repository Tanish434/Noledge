'use client';

import React, { useRef, useCallback, useEffect } from 'react';
import { gsap } from 'gsap';
import { Draggable } from 'gsap/Draggable';
import { ChevronLeft, ChevronRight, Eye, RefreshCw } from 'lucide-react';
import { useGSAP, getReducedMotion } from '@/hooks/useGSAP';
import { useQuestionStore } from '@/stores/questionStore';
import { useHaptics } from '@/hooks/useHaptics';
import { useSettingsStore } from '@/stores/settingsStore';
import { useKeyboard } from '@/hooks/useKeyboard';
import { sounds } from '@/lib/sounds';
import { ANIMATION, UI } from '@/lib/constants';
import { cn } from '@/utils/cn';
import { isInputOrEditable, hasModifierKey } from '@/utils/keyboard';
import FlashCard, { type FlashCardRef } from './FlashCard';
import { AnimateCount } from '@/components/ui/AnimateCount';
import styles from './CardStack.module.css';

// =============================================================================
// Types
// =============================================================================

interface CardStackProps {
  /** Additional CSS class */
  className?: string;
  /** Whether studying in global test mode */
  isGlobalTest?: boolean;
}

// Only show 1 card at a time (no background cards stacked underneath)
const VISIBLE_STACK_DEPTH = 1;

// =============================================================================
// Component
// =============================================================================

export default function CardStack({ className, isGlobalTest }: CardStackProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const flashCardRef = useRef<FlashCardRef | null>(null);
  const draggableRef = useRef<Draggable | null>(null);

  const {
    activeSession,
    currentCardIndex,
    questionsByDeck,
    nextCard,
    previousCard,
    answerCurrentCard,
    rateCurrentCard,
  } = useQuestionStore();

  const { haptics_enabled, reduce_motion, sound_enabled } = useSettingsStore();
  const { trigger: haptic } = useHaptics(haptics_enabled);

  const reducedMotion = getReducedMotion() || reduce_motion;

  // ─── Callbacks ────────────────────────────────────────────────────────
  const handleNext = useCallback(() => {
    haptic('swipe');
    nextCard();
  }, [haptic, nextCard]);

  const handlePrev = useCallback(() => {
    haptic('swipe');
    previousCard();
  }, [haptic, previousCard]);

  const handleReveal = useCallback(() => {
    flashCardRef.current?.toggleFlip();
  }, []);

  const handleRateRecall = useCallback(
    (rating: 'again' | 'hard' | 'good' | 'easy') => {
      haptic('swipe');
      if (sound_enabled) {
        if (rating === 'again') sounds.playIncorrect();
        else sounds.playCorrect();
      }
      void rateCurrentCard(rating);
    },
    [rateCurrentCard, haptic, sound_enabled]
  );

  // ─── Keyboard shortcuts ────────────────────────────────────────────────
  useKeyboard({
    enabled: !!activeSession && !activeSession.finished_at,
    onNext: handleNext,
    onPrev: handlePrev,
    onReveal: handleReveal,
    onRate: handleRateRecall,
  });

  // ─── 33-Card Sliding Window Buffer Architecture ───────────────────────
  const [windowCache, setWindowCache] = React.useState<Record<string, import('@/types/question').Question>>({});
  const [isBuffering, setIsBuffering] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (!activeSession || activeSession.question_ids.length === 0) return;

    const total = activeSession.question_ids.length;
    // For small decks (< 33 cards), window includes all cards; for medium/large decks, window is 33 cards max surrounding current card
    const startIdx = total <= 33 ? 0 : Math.max(0, currentCardIndex - 16);
    const endIdx = total <= 33 ? total : Math.min(total, currentCardIndex + 17);
    const windowIds = activeSession.question_ids.slice(startIdx, endIdx);

    const allStoreQs = Object.values(questionsByDeck).flat().filter(Boolean);
    const storeMap = new Map<string, import('@/types/question').Question>();
    allStoreQs.forEach((q) => { if (q?.id) storeMap.set(q.id, q); });

    const targetId = activeSession.question_ids[currentCardIndex];
    const hasCurrentInStore = Boolean(targetId && (storeMap.has(targetId) || windowCache[targetId]));
    const missingIds = windowIds.filter((id) => !storeMap.has(id) && !windowCache[id]);

    if (missingIds.length > 0) {
      if (!hasCurrentInStore) {
        setIsBuffering(true);
      }
      let cancelled = false;

      (async () => {
        const { getQuestion } = await import('@/lib/storage');
        const fetched = await Promise.all(missingIds.map((id) => getQuestion(id)));

        if (!cancelled) {
          const newCache: Record<string, import('@/types/question').Question> = {};
          fetched.forEach((q) => {
            if (q && q.id) newCache[q.id] = q;
          });

          if (Object.keys(newCache).length > 0) {
            setWindowCache((prev) => ({ ...prev, ...newCache }));
          }
          setIsBuffering(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    } else {
      setIsBuffering(false);
    }
  }, [activeSession, currentCardIndex, questionsByDeck, windowCache]);

  const questions = React.useMemo(() => {
    if (!activeSession || activeSession.question_ids.length === 0) return [];
    const targetId = activeSession.question_ids[currentCardIndex];
    if (!targetId) return [];

    const allStoreQs = Object.values(questionsByDeck).flat().filter(Boolean);
    let found = allStoreQs.find((q) => q?.id === targetId);

    if (!found) {
      found = windowCache[targetId];
    }

    return found ? [found] : [];
  }, [activeSession, currentCardIndex, questionsByDeck, windowCache]);

  // ─── Reset / Entrance Animation on Card Change ─────────────────────────
  useGSAP(
    () => {
      const topCard = cardRefs.current[0];
      if (!topCard) return;

      if (reducedMotion) {
        gsap.set(topCard, { x: 0, y: 0, scale: 1, opacity: 1, rotation: 0 });
        return;
      }

      gsap.fromTo(
        topCard,
        { x: 0, y: 0, rotation: 0, scale: 0.95, opacity: 0 },
        {
          scale: 1,
          opacity: 1,
          duration: 0.25,
          ease: 'power3.out',
          clearProps: 'transform',
        }
      );
    },
    containerRef,
    [currentCardIndex]
  );

  // ─── GSAP Draggable Setup ─────────────────────────────────────────────
  const attachDraggable = useCallback(() => {
    const topCard = cardRefs.current[0] || (containerRef.current?.querySelector(`.${styles.cardLayer}`) as HTMLElement);
    if (!topCard || reducedMotion) return;

    try {
      if (draggableRef.current) {
        const instances = Array.isArray(draggableRef.current) ? draggableRef.current : [draggableRef.current];
        instances.forEach((inst: any) => inst?.kill?.());
        draggableRef.current = null;
      }
    } catch {
      // Safe fallback if element already unmounted
    }

    draggableRef.current = Draggable.create(topCard, {
      type: 'x',
      edgeResistance: 0.65,
      throwProps: true,

      onDrag() {
        const ratio = this.x / (containerRef.current?.offsetWidth ?? 400);
        const rotation = ratio * 15;
        gsap.set(topCard, { rotation });

        const leftIndicator = topCard.querySelector('[data-swipe-left]') as HTMLElement;
        const rightIndicator = topCard.querySelector('[data-swipe-right]') as HTMLElement;
        if (leftIndicator && rightIndicator) {
          gsap.set(leftIndicator, { opacity: Math.max(0, -ratio * 2) });
          gsap.set(rightIndicator, { opacity: Math.max(0, ratio * 2) });
        }
      },

      onDragEnd() {
        const velocity = typeof (this as any).getVelocity === 'function'
          ? (this as any).getVelocity('x')
          : (this.x - (this.startX ?? 0));
        const distance = Math.abs(this.x);
        const direction = this.x > 0 ? 'right' : 'left';

        const isSwipe =
          distance >= UI.SWIPE_THRESHOLD_PX ||
          Math.abs(velocity) >= UI.SWIPE_VELOCITY_THRESHOLD * 1000;

        if (isSwipe) {
          // If swiping left on the FIRST card, play unique elastic rebound wobble
          if (direction === 'left' && currentCardIndex === 0) {
            haptic('wrong');
            const indicators = topCard.querySelectorAll('[data-swipe-left],[data-swipe-right]');
            gsap.to(indicators, { opacity: 0, duration: 0.2 });

            gsap.timeline()
              .to(topCard, {
                x: -90,
                rotation: -14,
                scale: 0.98,
                duration: 0.18,
                ease: 'power2.out',
              })
              .to(topCard, {
                x: 0,
                rotation: 0,
                scale: 1,
                duration: 0.65,
                ease: 'elastic.out(1.2, 0.35)',
              });
            return;
          }

          const exitX = direction === 'right' ? window.innerWidth * 1.5 : -window.innerWidth * 1.5;
          gsap.to(topCard, {
            x: exitX,
            rotation: direction === 'right' ? 25 : -25,
            opacity: 0,
            duration: ANIMATION.CARD_SWIPE,
            ease: 'power2.in',
            onComplete: () => {
              haptic('swipe');
              if (direction === 'left') {
                previousCard();
              } else {
                nextCard();
              }
            },
          });
        } else {
          gsap.to(topCard, {
            x: 0,
            rotation: 0,
            duration: 0.4,
            ease: 'elastic.out(1, 0.5)',
          });
          const indicators = topCard.querySelectorAll('[data-swipe-left],[data-swipe-right]');
          gsap.to(indicators, { opacity: 0, duration: 0.2 });
        }
      },
    })[0];
  }, [reducedMotion, haptic, nextCard, previousCard, currentCardIndex]);

  useEffect(() => {
    attachDraggable();
    const timer = setTimeout(() => {
      attachDraggable();
    }, 50);

    return () => {
      clearTimeout(timer);
      try {
        if (draggableRef.current) {
          const instances = Array.isArray(draggableRef.current) ? draggableRef.current : [draggableRef.current];
          instances.forEach((inst: any) => inst?.kill?.());
          draggableRef.current = null;
        }
      } catch {
        // Safe fallback if DOM element was removed by React during navigation
      }
    };
  }, [currentCardIndex, questions, attachDraggable]);

  // Listen for standalone F key for Zen Focus Mode
  useEffect(() => {
    const handleZenKey = (e: KeyboardEvent) => {
      if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-ai-drawer-open')) return;
      if (isInputOrEditable(e) || hasModifierKey(e)) return;

      if (e.code === 'KeyF' || e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('toggle-zen-mode'));
      }
    };
    window.addEventListener('keydown', handleZenKey);
    return () => window.removeEventListener('keydown', handleZenKey);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────

  if (!activeSession) return null;

  // Session has 0 total cards
  if (activeSession.question_ids.length === 0) {
    return (
      <div className={cn(styles.emptyState, className)}>
        <p className="text-secondary">No cards to study right now.</p>
      </div>
    );
  }

  // Active session with cards, but target card object is loading into memory
  if (questions.length === 0) {
    if (!activeSession.finished_at && currentCardIndex >= activeSession.question_ids.length) {
      void useQuestionStore.getState().endSession();
    }
    return (
      <div className={cn(styles.cardStack, className)}>
        <div className={styles.stackContainer}>
          <div className={styles.cardLayer} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, padding: 32 }}>
            <RefreshCw size={24} style={{ color: 'var(--color-accent)', animation: 'spin 1s linear infinite', marginBottom: 12 }} />
            <p style={{ fontSize: 14, fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
              Loading card {currentCardIndex + 1} of {activeSession.total_cards}…
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn(styles.cardStack, className)}>
      {/* Card container */}
      <div className={styles.stackContainer}>
        {questions.map((question, index) => (
          <div
            key={question.id}
            ref={(el) => {
              cardRefs.current[index] = el;
              if (index === 0 && el) {
                requestAnimationFrame(() => attachDraggable());
              }
            }}
            className={styles.cardLayer}
            style={{
              zIndex: 1,
              pointerEvents: 'auto',
            }}
          >
            {/* Swipe direction indicators */}
            <div
              data-swipe-left
              className={cn('swipe-indicator', 'swipe-indicator--left')}
              aria-hidden="true"
            >
              ← Prev
            </div>
            <div
              data-swipe-right
              className={cn('swipe-indicator', 'swipe-indicator--right')}
              aria-hidden="true"
            >
              Next →
            </div>

            <FlashCard
              ref={flashCardRef}
              question={question}
              isActive={true}
              onAnswer={answerCurrentCard}
              onRateRecall={handleRateRecall}
            />
          </div>
        ))}
      </div>

      {/* Unified Action & Progress Control Panel (Hidden during Global Test mode) */}
      {!isGlobalTest && (
        <div className={styles.unifiedControlPanel}>
        <div className={styles.controlsRow}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { previousCard(); haptic('swipe'); }}
            disabled={currentCardIndex === 0}
            aria-label="Previous card"
          >
            <ChevronLeft size={16} strokeWidth={2} /> Back
          </button>

          <button
            className="btn btn-accent-ghost btn-sm"
            onClick={() => flashCardRef.current?.toggleFlip()}
            aria-label="Reveal answer"
          >
            <Eye size={15} strokeWidth={2} /> Flip / Answer (Space)
          </button>

          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { nextCard(); haptic('swipe'); }}
            disabled={currentCardIndex >= activeSession.total_cards - 1}
            aria-label="Next card"
          >
            Next <ChevronRight size={16} strokeWidth={2} />
          </button>
        </div>

        <div className={styles.metaRow}>
          <span className={styles.cardCounterText}>
            Card <strong className="text-primary"><AnimateCount>{currentCardIndex + 1}</AnimateCount></strong> of <AnimateCount>{activeSession.total_cards}</AnimateCount>
          </span>

          <div className={styles.shortcutDockInline}>
            <span className={styles.shortcutPill}><kbd>Space</kbd> Flip</span>
            <span className={styles.shortcutPill}><kbd>←</kbd><kbd>→</kbd> Nav</span>
            <button
              className={styles.zenShortcutBtn}
              onClick={() => window.dispatchEvent(new CustomEvent('toggle-zen-mode'))}
              title="Toggle Zen Focus Mode (F)"
            >
              <kbd>F</kbd> Zen
            </button>
          </div>

          {(() => {
            const sessionQuestionIds = activeSession.question_ids;
            const attempts = activeSession.attempts;
            const latestAttemptMap = new Map<string, boolean>();
            attempts.forEach((att) => {
              latestAttemptMap.set(att.question_id, att.is_correct);
            });

            let correctCount = 0;
            let wrongCount = 0;
            let unansweredCount = 0;

            sessionQuestionIds.forEach((qId) => {
              if (!latestAttemptMap.has(qId)) {
                unansweredCount++;
              } else if (latestAttemptMap.get(qId) === true) {
                correctCount++;
              } else {
                wrongCount++;
              }
            });

            return (
              <div className={styles.chipsGroup}>
                <span className={cn(styles.statChip, styles.correctChip)} title={`Correct: ${correctCount} cards`}>
                  <span className={styles.chipIcon}>✓ </span><AnimateCount>{correctCount}</AnimateCount>
                </span>
                <span className={cn(styles.statChip, styles.wrongChip)} title={`Wrong: ${wrongCount} cards`}>
                  <span className={styles.chipIcon}>✕ </span><AnimateCount>{wrongCount}</AnimateCount>
                </span>
                <span className={cn(styles.statChip, styles.remainingChip)} title={`Unanswered: ${unansweredCount} cards`}>
                  <span className={styles.chipIcon}>○ </span><AnimateCount>{unansweredCount}</AnimateCount>
                </span>
              </div>
            );
          })()}
        </div>
      </div>
      )}
    </div>
  );
}
