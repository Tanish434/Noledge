/**
 * @file app/manage/page.tsx
 * @description Deck management — adaptive grid with progress rings, retention stats.
 *
 * Premium redesign: No boring lists. Adaptive grid with gradient strips,
 * progress rings, retention stats, hover effects.
 */

'use client';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import {
  Plus,
  Trash2,
  Pencil,
  BookOpen,
  Clock,
  Target,
  ChevronRight,
  HardDrive,
  Layers,
} from 'lucide-react';
import { gsap } from 'gsap';
import { useDeckStore } from '@/stores/deckStore';
import { useQuestionStore } from '@/stores/questionStore';
import { useToast } from '@/components/ui/Toast';
import { useGSAP, getReducedMotion } from '@/hooks/useGSAP';
import PageTransition from '@/components/ui/PageTransition';
import UnifiedDeckCard from '@/components/cards/DeckCard';
import { cn } from '@/utils/cn';
import styles from './manage.module.css';

// =============================================================================
// Progress Ring Component
// =============================================================================

function ProgressRing({ percent, size = 48, color = 'var(--color-accent)' }: { percent: number; size?: number; color?: string }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={styles.ringSvg}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-bg-active)"
        strokeWidth="3"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.8s var(--ease-spring)' }}
      />
    </svg>
  );
}

// =============================================================================
// Deck Card Component
// =============================================================================

interface DeckCardProps {
  deck: import('@/types/deck').Deck;
  onActivate: () => void;
  isActive: boolean;
}

function DeckCard({ deck, onActivate, isActive }: DeckCardProps) {
  return (
    <UnifiedDeckCard
      deck={deck}
      isActive={isActive}
      href={`/study?deck=${deck.id}`}
      onClick={onActivate}
      showActionButton={true}
    />
  );
}

// =============================================================================
// Hold-To-Delete Button Component
// =============================================================================

function HoldToDeleteButton({ onDelete, title = "Hold to delete" }: { onDelete: () => void; title?: string }) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const startTimeRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  const HOLD_DURATION = 800;

  const cancelHold = () => {
    setHolding(false);
    setProgress(0);
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  };

  const startHold = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setHolding(true);
    startTimeRef.current = Date.now();

    const updateProgress = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const currentProg = Math.min(100, (elapsed / HOLD_DURATION) * 100);
      setProgress(currentProg);

      if (elapsed >= HOLD_DURATION) {
        onDelete();
        cancelHold();
      } else {
        animFrameRef.current = requestAnimationFrame(updateProgress);
      }
    };

    animFrameRef.current = requestAnimationFrame(updateProgress);
  };

  return (
    <button
      type="button"
      className={cn(styles.actionBtn, styles.deleteBtn, holding && styles.holdActive)}
      onMouseDown={startHold}
      onMouseUp={cancelHold}
      onMouseLeave={cancelHold}
      onTouchStart={startHold}
      onTouchEnd={cancelHold}
      aria-label={title}
      title={holding ? 'Hold to confirm deletion…' : title}
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--color-danger)',
          opacity: 0.25,
          transform: `scaleX(${progress / 100})`,
          transformOrigin: 'left center',
          transition: holding ? 'none' : 'transform 0.15s ease, opacity 0.15s ease',
          pointerEvents: 'none',
        }}
      />
      <Trash2
        size={15}
        strokeWidth={1.75}
        style={{
          position: 'relative',
          zIndex: 1,
          color: holding ? 'var(--color-danger)' : undefined,
          transform: holding ? `scale(${1 + (progress / 100) * 0.2})` : 'scale(1)',
          transition: 'transform 0.05s linear, color 0.1s ease',
        }}
      />
      {holding && (
        <svg
          width="36"
          height="36"
          viewBox="0 0 36 36"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            transform: 'rotate(-90deg)',
            zIndex: 2,
          }}
        >
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            stroke="var(--color-danger)"
            strokeWidth="2.5"
            strokeDasharray={2 * Math.PI * 16}
            strokeDashoffset={2 * Math.PI * 16 * (1 - progress / 100)}
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}

// =============================================================================
// Manage Page
// =============================================================================

export default function ManagePage() {
  const { decks, loadDecks, deleteDeck, selectDeck, selectedDeckId } = useDeckStore();
  const { questionsByDeck, loadQuestionsForDeck, deleteQuestion } = useQuestionStore();
  const { addToast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const deckList = Object.values(decks);
  const selectedDeck = selectedDeckId ? decks[selectedDeckId] : null;
  const questionsInDeck = selectedDeckId ? (questionsByDeck[selectedDeckId] ?? []) : [];

  useEffect(() => { void loadDecks(); }, [loadDecks]);

  useEffect(() => {
    if (selectedDeckId) void loadQuestionsForDeck(selectedDeckId);
  }, [selectedDeckId, loadQuestionsForDeck]);

  // ─── GSAP entrance animations ───────────────────────────────────────────────
  useGSAP(
    () => {
      if (!rootRef.current || getReducedMotion()) return;
      const items = rootRef.current.querySelectorAll('.pt-item');
      if (!items.length) return;
      gsap.fromTo(
        items,
        { y: 20, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.35,
          stagger: 0.06,
          ease: 'power3.out',
          clearProps: 'transform,opacity',
        }
      );
    },
    rootRef,
    [deckList.length]
  );

  return (
    <PageTransition>
      <div ref={rootRef}>
        <main className={styles.manage}>
          {/* ── Header ─────────────────────────────────────────────────── */}
          <header className={cn(styles.headerCard, 'pt-item')}>
            <div className={styles.headerGlow} />
            <div className={styles.headerLeft}>
              <div className={styles.eyebrowRow}>
                <span className={styles.eyebrowBadge}>
                  <Layers size={12} strokeWidth={2} /> Library Overview
                </span>
              </div>
              <h1 className={styles.headerTitle}>Your Decks</h1>
              <div className={styles.headerMetaRow}>
                <span className={styles.headerStatPill}>
                  <strong>{deckList.length}</strong> {deckList.length === 1 ? 'deck' : 'decks'}
                </span>
                <span className={styles.headerMetaDot}>•</span>
                <span className={styles.headerStatPill}>
                  <strong>{deckList.reduce((s, d) => s + d.question_count, 0)}</strong> total cards
                </span>
              </div>
            </div>

            <div className={styles.headerActions}>
              <Link href="/settings?tab=import" className="btn btn-primary btn-sm" style={{ gap: 6 }}>
                <HardDrive size={15} strokeWidth={2} /> Sources
              </Link>
            </div>
          </header>

          {/* ── Deck Grid ──────────────────────────────────────────────── */}
          {deckList.length === 0 ? (
            <div className={cn('card-shell', styles.emptyState, 'pt-item')}>
              <BookOpen size={48} strokeWidth={1.5} className="text-tertiary" />
              <h2 className="text-card-title">No Decks Yet</h2>
              <p className="text-secondary text-sm">
                Connect GitHub or Obsidian to import your questions.
              </p>
              <Link href="/settings?tab=import" className="btn btn-primary">
                Connect a Source
              </Link>
            </div>
          ) : (
            <div className={cn(styles.deckGrid, 'pt-item')}>
              {deckList.map((deck) => (
                <DeckCard
                  key={deck.id}
                  deck={deck}
                  onActivate={() => selectDeck(deck.id)}
                  isActive={selectedDeckId === deck.id}
                />
              ))}
            </div>
          )}

          {/* ── Question Panel ─────────────────────────────────────────── */}
          {selectedDeck && (
            <section className={cn(styles.questionPanel, 'pt-item')}>
              <div className={styles.panelHeader}>
                <div className={styles.panelHeaderTitle}>
                  <div
                    className={styles.deckColorDot}
                    style={{ backgroundColor: selectedDeck.color, boxShadow: `0 0 12px ${selectedDeck.color}60` }}
                  />
                  <div>
                    <div className={styles.panelHeaderMeta}>
                      <h2 className={styles.panelTitle}>{selectedDeck.name}</h2>
                      <span className={styles.countBadge}>{questionsInDeck.length} {questionsInDeck.length === 1 ? 'question' : 'questions'}</span>
                    </div>
                    <p className={styles.panelSubtitle}>Manage and review questions in this deck</p>
                  </div>
                </div>
                <Link href={`/create?deck=${selectedDeck.id}`} className={cn('btn btn-primary btn-sm', styles.addQuestionBtn)}>
                  <Plus size={16} strokeWidth={2} /> Add Question
                </Link>
              </div>

              <div className={styles.questionList}>
                {questionsInDeck.map((q, i) => (
                  <div key={q.id} className={styles.questionRow}>
                    <div className={styles.questionIndex}>
                      {String(i + 1).padStart(2, '0')}
                    </div>
                    <div className={styles.questionInfo}>
                      <div className={styles.questionMetaRow}>
                        <span className={cn('badge', 'badge-accent')}>
                          {q.type.toUpperCase()}
                        </span>
                        <span className={styles.repsBadge}>
                          <Clock size={11} strokeWidth={1.75} /> {q.srs.repetitions} {q.srs.repetitions === 1 ? 'rep' : 'reps'}
                        </span>
                      </div>
                      <p className={styles.questionPreview}>
                        {q.content.slice(0, 120)}{q.content.length > 120 ? '…' : ''}
                      </p>
                    </div>
                    <div className={styles.questionActions}>
                      <Link
                        href={`/create?id=${q.id}&deck=${selectedDeck.id}`}
                        className={styles.actionBtn}
                        aria-label="Edit question"
                        title="Edit question — pre-fills all fields"
                      >
                        <Pencil size={15} strokeWidth={1.75} />
                      </Link>
                      <HoldToDeleteButton
                        onDelete={() => void deleteQuestion(q.id, selectedDeck.id)}
                        title="Hold to delete question"
                      />
                    </div>
                  </div>
                ))}
                {questionsInDeck.length === 0 && (
                  <div className={styles.emptyQuestionsState}>
                    <p className="text-secondary text-sm">
                      No questions in this deck yet. Click <strong>Add Question</strong> to create one.
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}
        </main>
      </div>
    </PageTransition>
  );
}