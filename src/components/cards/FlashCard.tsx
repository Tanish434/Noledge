/**
 * @file components/cards/FlashCard.tsx
 * @description Individual flashcard with flip animation, answer reveal, particle effects.
 *
 * States: question → answered-correct / answered-wrong
 * Flip: GSAP 3D rotateY
 * Correct: scale pulse + green glow + particle burst
 * Wrong: horizontal shake + red border
 */

'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { gsap } from 'gsap';
import type { Question } from '@/types/question';
import { useGSAP } from '@/hooks/useGSAP';
import { useHaptics } from '@/hooks/useHaptics';
import { useSettingsStore } from '@/stores/settingsStore';
import { useQuestionStore } from '@/stores/questionStore';
import { sounds } from '@/lib/sounds';
import { ANIMATION } from '@/lib/constants';
import { Sparkles } from 'lucide-react';
import { cn } from '@/utils/cn';
import { renderMarkdownToHtml } from '@/utils/sanitize';
import QuestionRenderer from '../questions/QuestionRenderer';
import styles from './FlashCard.module.css';

interface FlashCardProps {
  question: Question;
  isActive: boolean;
  onAnswer?: (userAnswer: string | string[], timeTakenMs: number) => Promise<boolean>;
  onRateRecall?: (rating: 'again' | 'hard' | 'good' | 'easy') => void;
  className?: string;
}

type CardState = 'question' | 'answered-correct' | 'answered-wrong';

export interface FlashCardRef {
  flipToAnswer: () => void;
  toggleFlip: () => void;
}

function formatCorrectAnswer(question: Question): string {
  if (!question) return '';

  // 1. Fill-in-the-blank question
  if (question.type === 'fill' || (question.blanks && question.blanks.length > 0)) {
    let list: Array<{ id: string; accepted_answers: string[] }> = [];

    if (question.blanks && question.blanks.length > 0) {
      list = question.blanks;
    }

    const inlineMatches = Array.from(question.content.matchAll(/\{\{(.*?)\}\}/g));
    if (inlineMatches.length > 1 && inlineMatches.length > list.length) {
      list = inlineMatches.map((m, idx) => {
        const val = m[1].trim();
        const accs = val ? val.split(/[/|,]/).map((s) => s.trim()).filter(Boolean) : [];
        return {
          id: `blank-${idx + 1}`,
          accepted_answers: accs.length > 0 ? accs : [val || `Blank ${idx + 1}`],
        };
      });
    }

    if (list.length <= 1) {
      const raw = Array.isArray(question.answer)
        ? question.answer
        : typeof question.answer === 'string'
          ? question.answer.split(/[/|,\n]/).map((s) => s.trim()).filter(Boolean)
          : [];

      if (raw.length > 1) {
        list = raw.map((ans, idx) => ({
          id: `blank-${idx + 1}`,
          accepted_answers: [ans],
        }));
      }
    }

    if (list.length > 0) {
      return list
        .map((b, i) => {
          const accs = Array.isArray(b.accepted_answers) ? b.accepted_answers.join(' / ') : String(b.accepted_answers ?? '');
          return `[Blank ${i + 1}]: ${accs}`;
        })
        .join('  •  ');
    }
  }

  // 2. Match Pairs question
  if (question.type === 'match' || (question.pairs && question.pairs.length > 0)) {
    const pairList = (question.pairs && question.pairs.length > 0)
      ? question.pairs
      : (typeof question.answer === 'string' && question.answer
          ? question.answer.split(',').map((p, idx) => {
              const [left, right] = p.split(':');
              return { id: `p-${idx + 1}`, left: left || `Item ${idx + 1}`, right: right || '' };
            })
          : []);

    if (pairList.length > 0) {
      return pairList
        .map((pair) => `${pair.left} ➔ ${pair.right}`)
        .join('  •  ');
    }
  }

  // 3. Ordering / Sequence question
  if (question.type === 'order' || (question.order_items && question.order_items.length > 0)) {
    const orderItems = (question.order_items && question.order_items.length > 0)
      ? question.order_items
      : (typeof question.answer === 'string' && question.answer ? question.answer.split(',') : []);

    if (orderItems.length > 0) {
      return orderItems
        .map((item, idx) => `${idx + 1}. ${item.trim()}`)
        .join('  ➔  ');
    }
  }

  // 4. Code question
  if (question.type === 'code' || question.code_language) {
    const raw = Array.isArray(question.answer) ? question.answer.join('\n') : String(question.answer ?? '');
    return raw;
  }

  // 5. Options-based question (MCQ, multi-select, image-select)
  if (question.options && question.options.length > 0) {
    const correctOptions = question.options.filter((o) => o.is_correct);
    if (correctOptions.length > 0) {
      return correctOptions
        .map((o) => {
          if (o.content && o.content.trim()) return o.content.trim();
          if (o.image_url) {
            const fileName = o.image_url.split('/').pop() ?? 'image';
            return `Option Image (${fileName})`;
          }
          return o.id;
        })
        .join(', ');
    }

    const rawAnswerStr = Array.isArray(question.answer) ? question.answer.join(',') : String(question.answer ?? '');
    const ansIds = rawAnswerStr.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
    const resolved = ansIds.map((ansId) => {
      const opt = question.options?.find((o) => o.id === ansId || o.content === ansId);
      if (opt && opt.content && opt.content.trim()) return opt.content.trim();
      return ansId;
    });

    if (resolved.length > 0) return resolved.join(', ');
  }

  // 4. Default array or string answer with aliases
  let baseAnswer = Array.isArray(question.answer) ? question.answer.join(', ') : String(question.answer ?? '');

  const aliasesList = question.accepted_answers || question.aliases;
  if (aliasesList && aliasesList.length > 0) {
    const extraAliases = aliasesList.filter((a) => a.toLowerCase().trim() !== baseAnswer.toLowerCase().trim());
    if (extraAliases.length > 0) {
      baseAnswer += `  •  Also accepted: ${extraAliases.join(', ')}`;
    }
  }

  return baseAnswer;
}

const FlashCard = React.forwardRef<FlashCardRef, FlashCardProps>(function FlashCard(
  { question, isActive, onAnswer, onRateRecall, className }: FlashCardProps,
  ref
) {
  const cardRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const particleRef = useRef<HTMLDivElement>(null);

  const [cardState, setCardState] = useState<CardState>('question');
  const [isFlipped, setIsFlipped] = useState(false);
  const [startTime] = useState(() => Date.now());
  const autoAdvanceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
  }, [question.id]);

  const { haptics_enabled, sound_enabled, reduce_motion, font_size, font_family, compact_mode, high_contrast, card_glow, auto_advance, auto_advance_delay_ms } = useSettingsStore();
  const lastScoreResult = useQuestionStore((s) => s.lastScoreResult);
  const { trigger: haptic } = useHaptics(haptics_enabled);
  const reducedMotion = reduce_motion;

  // ─── Initial entrance animation ───────────────────────────────────────
  useGSAP(
    () => {
      if (!cardRef.current || reducedMotion) return;
      gsap.from(cardRef.current, {
        scale: 0.94,
        opacity: 0,
        duration: 0.4,
        ease: 'power3.out',
      });
    },
    cardRef,
    [question.id]
  );

  // ─── Particle burst on correct answer ──────────────────────────────────
  const createParticleBurst = useCallback(() => {
    if (!particleRef.current || reducedMotion) return;
    const container = particleRef.current;
    const particleCount = 12;
    const colors = ['var(--color-success)', 'var(--color-accent)', 'var(--color-success)'];

    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement('div');
      particle.style.cssText = `position:absolute;width:6px;height:6px;border-radius:50%;background:${colors[i % colors.length]};top:50%;left:50%;pointer-events:none;`;
      container.appendChild(particle);

      const angle = (i / particleCount) * Math.PI * 2;
      const distance = 60 + Math.random() * 40;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;

      gsap.to(particle, {
        x, y, opacity: 0, scale: 0,
        duration: 0.6, ease: 'power2.out',
        onComplete: () => {
          if (particle && particle.parentNode) {
            particle.parentNode.removeChild(particle);
          }
        },
      });
    }
  }, [reducedMotion]);

  // ─── Flip animation ───────────────────────────────────────────────────
  const flipToAnswer = useCallback(() => {
    if (isFlipped || !cardRef.current) return;
    setIsFlipped(true);

    if (reducedMotion) {
      if (frontRef.current) frontRef.current.style.display = 'none';
      if (backRef.current) backRef.current.style.display = 'flex';
      return;
    }

    const tl = gsap.timeline();

    tl.to(frontRef.current, {
      rotateY: 90,
      duration: ANIMATION.CARD_FLIP / 2,
      ease: 'power2.in',
      onComplete: () => {
        if (frontRef.current) frontRef.current.style.display = 'none';
        if (backRef.current) backRef.current.style.display = 'flex';
        gsap.set(backRef.current, { rotateY: -90 });
      },
    });

    tl.to(backRef.current, {
      rotateY: 0,
      duration: ANIMATION.CARD_FLIP / 2,
      ease: 'power2.out',
    });
  }, [isFlipped, reducedMotion]);

  const toggleFlip = useCallback(() => {
    if (isFlipped) {
      // Animate back to question side (mirror of flipToAnswer)
      setIsFlipped(false);
      if (reducedMotion) {
        if (backRef.current) backRef.current.style.display = 'none';
        if (frontRef.current) frontRef.current.style.display = 'flex';
        gsap.set(frontRef.current, { rotateY: 0 });
        return;
      }
      const tl = gsap.timeline();
      tl.to(backRef.current, {
        rotateY: 90,
        duration: ANIMATION.CARD_FLIP / 2,
        ease: 'power2.in',
        onComplete: () => {
          if (backRef.current) backRef.current.style.display = 'none';
          if (frontRef.current) frontRef.current.style.display = 'flex';
          gsap.set(frontRef.current, { rotateY: -90 });
        },
      });
      tl.to(frontRef.current, {
        rotateY: 0,
        duration: ANIMATION.CARD_FLIP / 2,
        ease: 'power2.out',
      });
    } else {
      flipToAnswer();
    }
  }, [isFlipped, reducedMotion, flipToAnswer]);

  React.useImperativeHandle(ref, () => ({
    flipToAnswer,
    toggleFlip,
  }), [flipToAnswer, toggleFlip]);

  // ─── Answer handler ───────────────────────────────────────────────────
  const handleAnswer = useCallback(async (userAnswer: string | string[]) => {
    if (!onAnswer || cardState !== 'question') return;

    const timeTakenMs = Date.now() - startTime;
    const isCorrect = await onAnswer(userAnswer, timeTakenMs);

    if (sound_enabled) {
      if (isCorrect) sounds.playCorrect();
      else sounds.playIncorrect();
    }

    setCardState(isCorrect ? 'answered-correct' : 'answered-wrong');
    haptic(isCorrect ? 'correct' : 'wrong');

    const triggerAutoAdvance = () => {
      if (auto_advance && isCorrect) {
        if (autoAdvanceTimerRef.current) {
          clearTimeout(autoAdvanceTimerRef.current);
        }
        autoAdvanceTimerRef.current = setTimeout(() => {
          autoAdvanceTimerRef.current = null;
          void useQuestionStore.getState().rateCurrentCard('good');
        }, auto_advance_delay_ms || 1200);
      }
    };

    if (!reducedMotion && cardRef.current) {
      if (isCorrect) {
        // Correct: scale pulse + green glow + particle burst
        createParticleBurst();
        gsap.to(cardRef.current, {
          scale: 1.02,
          duration: 0.15,
          ease: 'power2.out',
          yoyo: true,
          repeat: 1,
          onComplete: () => {
            flipToAnswer();
            triggerAutoAdvance();
          },
        });
      } else {
        // Wrong: horizontal shake
        gsap.to(cardRef.current, {
          keyframes: { x: [0, -10, 10, -8, 8, -4, 4, 0] },
          duration: ANIMATION.ANSWER_SHAKE,
          ease: 'none',
          onComplete: () => flipToAnswer(),
        });
      }
    } else {
      flipToAnswer();
      triggerAutoAdvance();
    }
  }, [onAnswer, cardState, startTime, haptic, reducedMotion, flipToAnswer, createParticleBurst, auto_advance, auto_advance_delay_ms]);

  // ─── 3D Mouse Tilt Handlers ───────────────────────────────────────────
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current || reducedMotion) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -5;
    const rotateY = ((x - centerX) / centerX) * 5;

    gsap.to(cardRef.current, {
      rotateX,
      rotateY,
      duration: 0.2,
      ease: 'power1.out',
      transformPerspective: 1000,
    });
  };

  const handleMouseLeave = () => {
    if (!cardRef.current || reducedMotion) return;
    gsap.to(cardRef.current, {
      rotateX: 0,
      rotateY: 0,
      duration: 0.4,
      ease: 'power2.out',
    });
  };

  // ─── Double Tap to Flip Card Gesture Handler ───────────────────────────
  const lastTapRef = useRef<number>(0);
  const isTouchRef = useRef<boolean>(false);

  const handleCardDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // If the gesture was already handled by touch start, consume and ignore the synthetic mouse dblclick
    if (isTouchRef.current) {
      isTouchRef.current = false;
      return;
    }
    const target = e.target as HTMLElement;
    // Allow double-click anywhere except interactive form controls and SRS rating buttons
    if (target.closest('input, textarea, select, a, [data-srs-btn]')) {
      return;
    }
    // If flipped, any double-click on the card should flip back
    // If not flipped, only flip forward if NOT on a button
    if (!isFlipped && target.closest('button, [role="button"]')) {
      return;
    }
    toggleFlip();
  }, [isFlipped, toggleFlip]);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // If flipped, allow double-tap anywhere on the card to flip back
    // except on SRS rating buttons themselves
    if (isFlipped) {
      if (target.closest('[data-srs-btn]')) return;
    } else {
      // When not flipped, don't intercept taps on buttons/inputs
      if (target.closest('button, input, textarea, select, a, [role="button"], code, pre')) return;
    }

    const now = Date.now();
    const DOUBLE_TAP_GAP = 300;
    if (now - lastTapRef.current < DOUBLE_TAP_GAP) {
      isTouchRef.current = true;
      toggleFlip();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }, [isFlipped, toggleFlip]);

  // ─── Difficulty colors ─────────────────────────────────────────────────
  const difficultyColors: Record<string, string> = {
    easy: 'var(--color-success)',
    medium: 'var(--color-warning)',
    hard: 'var(--color-danger)',
  };

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handleCardDoubleClick}
      onTouchStart={handleTouchStart}
      className={cn(
        'card-shell',
        styles.flashCard,
        cardState === 'answered-correct' && styles.stateCorrect,
        cardState === 'answered-wrong' && styles.stateWrong,
        styles[`font-${font_size}` as keyof typeof styles],
        font_family === 'mono' && 'font-mono',
        font_family === 'serif' && 'font-serif',
        font_family === 'rounded' && 'font-rounded',
        font_family === 'slab' && 'font-slab',
        font_family === 'dyslexic' && 'font-dyslexic',
        compact_mode && 'compact-card',
        high_contrast && 'high-contrast-card',
        !card_glow && 'no-card-glow',
        className
      )}
      role="region"
      aria-label={`Study card: ${question.content.slice(0, 60)}`}
    >
      {/* Particle container for correct answer burst */}
      <div ref={particleRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible', zIndex: 10 }} aria-hidden="true" />

      {/* Header bar */}
      <div className={styles.cardHeader}>
        <div className={styles.headerBadges}>
          <span className={cn('badge', 'badge-accent')}>
            ⌨ {question.type.toUpperCase()}
          </span>
          <span
            className="badge"
            style={{
              background: `${difficultyColors[question.difficulty]}20`,
              color: difficultyColors[question.difficulty],
              border: `1px solid ${difficultyColors[question.difficulty]}40`,
            }}
          >
            {question.difficulty === 'easy' ? '🟢 Easy' : question.difficulty === 'medium' ? '🟡 Medium' : '🔴 Hard'}
          </span>
        </div>

        <button
          type="button"
          className={styles.askAiCardBtn}
          onClick={(e) => {
            e.stopPropagation();
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('noledge_open_ai_tutor'));
            }
          }}
          aria-label="Ask AI Tutor about this question"
          title="Ask AI Tutor about this question"
        >
          <Sparkles size={13} />
          <span>Ask AI</span>
        </button>
      </div>

      {/* Card inner core */}
      <div className="card-core">
        {/* FRONT FACE */}
        <div ref={frontRef} className={styles.cardFace}>
          <QuestionRenderer
            question={question}
            isActive={isActive && cardState === 'question'}
            onAnswer={handleAnswer}
          />
        </div>

        {/* BACK FACE */}
        <div ref={backRef} className={cn(styles.cardFace, styles.cardBack)}>
          <div className={styles.answerReveal}>
            <div className={cn('eyebrow', styles.answerLabel)}>
              {cardState === 'answered-correct' ? '✓ Correct!' : '✗ Answer Revealed'}
            </div>

            {lastScoreResult?.feedback && (question.type === 'code' || question.type === 'voice') && (
              <div
                style={{
                  background: lastScoreResult.is_correct ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                  border: `1px solid ${lastScoreResult.is_correct ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                  color: lastScoreResult.is_correct ? 'var(--color-success)' : 'var(--color-danger)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '14px',
                  fontSize: '13px',
                  lineHeight: '1.5',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>{lastScoreResult.is_correct ? '✓ AI Evaluation Passed' : '✗ AI Evaluation Feedback'}</span>
                  <span style={{ fontSize: '11px', opacity: 0.85, padding: '1px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.1)' }}>
                    Score: {Math.round(lastScoreResult.score * 100)}%
                  </span>
                </div>
                <p style={{ margin: 0, color: 'var(--color-text-primary)', fontSize: '13px', whiteSpace: 'pre-wrap' }}>
                  {lastScoreResult.feedback}
                </p>
              </div>
            )}

            <div className={styles.correctAnswer}>
              <span className="text-secondary text-sm">Correct answer:</span>
              {question.type === 'code' || question.code_language ? (
                <pre
                  style={{
                    background: 'var(--color-bg-tertiary)',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    overflowX: 'auto',
                    maxWidth: '100%',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    overflowWrap: 'anywhere',
                    marginTop: '6px',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <code style={{ wordBreak: 'break-all', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{formatCorrectAnswer(question)}</code>
                </pre>
              ) : (
                <p className="text-primary font-semibold text-lg" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', maxWidth: '100%' }}>
                  {formatCorrectAnswer(question)}
                </p>
              )}
            </div>

            {question.explanation && (
              <div className={styles.explanation}>
                <span className="eyebrow">Explanation</span>
                <div
                  className="text-secondary leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(question.explanation) }}
                />
              </div>
            )}

            {/* Recall Confidence Rating */}
            <div className={styles.srsRatingSection}>
              <div className={styles.srsHeader}>
                <span className={styles.srsLabel}>How well did you know this?</span>
                <span className={styles.srsSubLabel}>Select rating to continue →</span>
              </div>
              <div className={styles.srsBtnGrid} data-srs-btn="true">
                <button
                  type="button"
                  className={cn(styles.srsBtn, styles.srsAgain)}
                  onClick={() => {
                    if (autoAdvanceTimerRef.current) {
                      clearTimeout(autoAdvanceTimerRef.current);
                      autoAdvanceTimerRef.current = null;
                    }
                    onRateRecall?.('again');
                  }}
                >
                  <span className={styles.srsBtnIcon}>🔴</span>
                  <span className={styles.srsBtnTitle}>Forgot</span>
                  <span className={styles.srsBtnTime}>Repeat &lt; 1m</span>
                </button>

                <button
                  type="button"
                  className={cn(styles.srsBtn, styles.srsHard)}
                  onClick={() => {
                    if (autoAdvanceTimerRef.current) {
                      clearTimeout(autoAdvanceTimerRef.current);
                      autoAdvanceTimerRef.current = null;
                    }
                    onRateRecall?.('hard');
                  }}
                >
                  <span className={styles.srsBtnIcon}>🟠</span>
                  <span className={styles.srsBtnTitle}>Hard</span>
                  <span className={styles.srsBtnTime}>Review 10m</span>
                </button>

                <button
                  type="button"
                  className={cn(styles.srsBtn, styles.srsGood)}
                  onClick={() => {
                    if (autoAdvanceTimerRef.current) {
                      clearTimeout(autoAdvanceTimerRef.current);
                      autoAdvanceTimerRef.current = null;
                    }
                    onRateRecall?.('good');
                  }}
                >
                  <span className={styles.srsBtnIcon}>🟢</span>
                  <span className={styles.srsBtnTitle}>Good</span>
                  <span className={styles.srsBtnTime}>Review 1d</span>
                </button>

                <button
                  type="button"
                  className={cn(styles.srsBtn, styles.srsEasy)}
                  onClick={() => {
                    if (autoAdvanceTimerRef.current) {
                      clearTimeout(autoAdvanceTimerRef.current);
                      autoAdvanceTimerRef.current = null;
                    }
                    onRateRecall?.('easy');
                  }}
                >
                  <span className={styles.srsBtnIcon}>⚡</span>
                  <span className={styles.srsBtnTitle}>Easy</span>
                  <span className={styles.srsBtnTime}>Review 4d</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default FlashCard;