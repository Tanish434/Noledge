/**
 * @file app/study/page.tsx
 * @description The study session view — card stack + session management.
 *
 * Premium redesign: Timer, progress bar, keyboard hints, better visual design.
 *
 * Flow:
 *   1. If no deck selected → show deck picker
 *   2. If deck selected but no session → show session start screen
 *   3. If session active → show CardStack with premium header
 *   4. If session ended → show completion screen with stats
 */

'use client';

import React, { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { gsap } from 'gsap';
import { BookOpen, Layers, X, Keyboard, ChevronRight, HardDrive, Eye, EyeOff, AlertTriangle, Zap } from 'lucide-react';
import { useQuestionStore } from '@/stores/questionStore';
import { useDeckStore } from '@/stores/deckStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getReducedMotion } from '@/hooks/useGSAP';
import { updateStreak, getStreakEmoji } from '@/engine/scoring/streakTracker';
import CardStack from '@/components/cards/CardStack';
import DeckCard from '@/components/cards/DeckCard';
import CircularTimer from '@/components/study/CircularTimer';
import LiveStatsPanel from '@/components/study/LiveStatsPanel';
import PageTransition from '@/components/ui/PageTransition';
import { cn } from '@/utils/cn';
import { isInputOrEditable, hasModifierKey } from '@/utils/keyboard';
import { sounds } from '@/lib/sounds';
import styles from './study.module.css';


// =============================================================================
// Keyboard Hints Component
// =============================================================================

function KeyboardHints() {
  const [showHints, setShowHints] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-ai-drawer-open')) return;
      if (isInputOrEditable(e) || hasModifierKey(e)) return;

      if (e.key === '?') {
        e.preventDefault();
        setShowHints((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setShowHints(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handleToggleHints = () => setShowHints((prev) => !prev);
    window.addEventListener('toggle-keyboard-hints', handleToggleHints);
    return () => window.removeEventListener('toggle-keyboard-hints', handleToggleHints);
  }, []);

  useEffect(() => {
    if (showHints) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [showHints]);

  if (!showHints) return null;

  const hints = [
    { keys: ['Space'], action: 'Reveal answer' },
    { keys: ['Enter'], action: 'Confirm' },
    { keys: ['←', '→'], action: 'Navigate cards' },
    { keys: ['F'], action: 'Toggle Zen Mode' },
    { keys: ['Esc'], action: 'Exit session' },
    { keys: ['?'], action: 'Toggle this overlay' },
  ];

  return (
    <div className={styles.hintsOverlay} onClick={() => setShowHints(false)}>
      <div className={cn('card-shell', styles.hintsCard)} onClick={(e) => e.stopPropagation()}>
        <div className={styles.hintsHeader}>
          <Keyboard size={20} strokeWidth={1.75} className="text-accent" />
          <h2 className="text-card-title">Keyboard Shortcuts</h2>
        </div>
        <div className={styles.hintsList}>
          {hints.map(({ keys, action }) => (
            <div key={action} className={styles.hintRow}>
              <span className="text-sm text-secondary">{action}</span>
              <div className={styles.hintKeys}>
                {keys.map((k) => (
                  <kbd key={k} className={styles.hintKey}>{k}</kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Score Reveal (GSAP Animation)
// =============================================================================

function ScoreReveal({ accuracy, streakEmoji, streakCount }: { accuracy: number, streakEmoji: string, streakCount: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const streakRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const { sound_enabled } = useSettingsStore();

  useEffect(() => {
    if (sound_enabled) {
      sounds.playComplete();
    }

    if (!containerRef.current || getReducedMotion()) return;
    const tl = gsap.timeline();

    tl.fromTo(
      iconRef.current,
      { scale: 0, rotation: -45, opacity: 0 },
      { scale: 1, rotation: 0, opacity: 1, duration: 0.6, ease: 'back.out(1.7)' }
    );

    if (streakRef.current) {
      tl.fromTo(
        streakRef.current,
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4, ease: 'power2.out' },
        '-=0.3'
      );
    }

    if (statsRef.current) {
      tl.fromTo(
        statsRef.current.children,
        { y: 30, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4, stagger: 0.1, ease: 'power2.out' },
        '-=0.2'
      );
    }
  }, []);

  return (
    <div ref={containerRef} className={styles.scoreRevealContainer}>
      <div ref={iconRef} className={styles.completeIcon}>
        {accuracy >= 80 ? '🏆' : accuracy >= 50 ? '👍' : '💪'}
      </div>
      {streakCount > 0 && (
        <div ref={streakRef} className={styles.streakBadge}>
          {streakEmoji} {streakCount} {streakCount === 1 ? 'Deck Completion' : 'Deck Completions'}!
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Question Type Configuration Registry (10 Supported Types)
// =============================================================================

const QUESTION_TYPES_CONFIG: Array<{
  type: import('@/types/question').QuestionType;
  title: string;
  description: string;
  icon: string;
}> = [
    { type: 'mcq', title: 'Multiple Choice', description: 'Single-answer selection from options', icon: '🔘' },
    { type: 'tf', title: 'True / False', description: 'Binary true or false evaluation', icon: '☯️' },
    { type: 'fill', title: 'Fill-in-the-Blank', description: 'Complete missing words in text', icon: '📝' },
    { type: 'code', title: 'Code & Commands', description: 'Technical snippets, commands & scripts', icon: '💻' },
    { type: 'match', title: 'Drag & Match', description: 'Connect left pairs to right terms', icon: '🔀' },
    { type: 'order', title: 'Sequence Ordering', description: 'Arrange shuffled steps in sequence', icon: '🔢' },
    { type: 'multi', title: 'Multiple Select', description: 'Select all correct answers that apply', icon: '☑️' },
    { type: 'typing', title: 'Short Answer', description: 'Type free-form answer with fuzzy match', icon: '⌨️' },
    { type: 'image-select', title: 'Image Selection', description: 'Identify visual diagrams & images', icon: '🖼️' },
    { type: 'voice', title: 'Voice & Speech', description: 'Speak answer with voice recognition', icon: '🎙️' },
  ];

// =============================================================================
// Study Page Content
// =============================================================================

function StudyPageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const deckId = params.get('deck') ?? undefined;
  const rawMode = params.get('mode') as 'srs' | 'review-all' | 'random' | null;
  const typeParam = params.get('type') as import('@/types/question').QuestionType | null;
  const limitParam = params.get('limit');
  const customLimit = limitParam ? parseInt(limitParam, 10) : undefined;
  const isGlobalMode = !deckId && (rawMode !== null || params.has('mode') || typeParam !== null);
  const mode = rawMode ?? (deckId ? 'review-all' : 'srs');

  const [isZenMode, setIsZenMode] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [isGlitching, setIsGlitching] = useState(false);
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const { getAllQuestions } = await import('@/lib/storage');
      const allQs = await getAllQuestions();
      const counts: Record<string, number> = {};
      allQs.forEach((q) => {
        if (q?.type) {
          counts[q.type] = (counts[q.type] || 0) + 1;
        }
      });
      setTypeCounts(counts);
    })();
  }, []);

  useEffect(() => {
    const handleZenEvent = () => setIsZenMode((prev) => !prev);
    window.addEventListener('toggle-zen-mode', handleZenEvent);
    return () => window.removeEventListener('toggle-zen-mode', handleZenEvent);
  }, []);

  // Listen for Escape key to show Exit Confirmation modal during ANY test
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (isInputOrEditable(e)) return;
      if (e.key === 'Escape' || e.code === 'Escape') {
        const currentSession = useQuestionStore.getState().activeSession;
        if (currentSession && !currentSession.finished_at) {
          e.preventDefault();
          setShowExitConfirm((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  const isExitingRef = useRef(false);

  const handleExitConfirm = () => {
    isExitingRef.current = true;
    setShowExitConfirm(false);
    clearSession();
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/study');
    }
    router.replace('/study');
  };

  const { activeSession, startSession, endSession, clearSession, currentCardIndex } = useQuestionStore();
  const { decks, loadDecks } = useDeckStore();
  const { default_session_limit, show_session_timer, show_progress_bar } = useSettingsStore();

  // 60-Minute Forced Timeout Glitch Effect for Individual Deck Sessions
  useEffect(() => {
    const isGlobal = activeSession?.deck_id === 'all' || activeSession?.deck_id?.startsWith('type:');
    if (!activeSession || activeSession.finished_at || isGlobal) return;

    const checkInterval = setInterval(() => {
      const startedMs = new Date(activeSession.started_at).getTime();
      const elapsedSec = Math.floor((Date.now() - startedMs) / 1000);

      // 60 minutes exact = 3600 seconds
      if (elapsedSec >= 3600 && !isGlitching) {
        setIsGlitching(true);
        const { sound_enabled } = useSettingsStore.getState();
        if (sound_enabled) sounds.playIncorrect();

        setTimeout(() => {
          setIsGlitching(false);
          endSession();
        }, 1800);
      }
    }, 1000);

    return () => clearInterval(checkInterval);
  }, [activeSession, isGlitching, endSession]);

  useEffect(() => {
    if (Object.keys(decks).length === 0) {
      void loadDecks();
    }
  }, [decks, loadDecks]);

  const targetDeckId = typeParam ? `type:${typeParam}` : (deckId ?? (isGlobalMode ? 'all' : undefined));
  const sessionLimit = customLimit ?? default_session_limit;

  useEffect(() => {
    if (targetDeckId) {
      isExitingRef.current = false;
    }
  }, [targetDeckId]);

  useEffect(() => {
    if (!targetDeckId) {
      return;
    }

    if (isExitingRef.current) return;

    const needsNewSession =
      !activeSession ||
      activeSession.deck_id !== targetDeckId;

    if (needsNewSession) {
      void startSession(targetDeckId, mode, sessionLimit, typeParam ?? undefined);
    }
  }, [targetDeckId, mode, sessionLimit, typeParam, activeSession?.deck_id, startSession]);

  const rawDeck = deckId
    ? (decks[deckId] || Object.values(decks).find((d) => d.id === deckId || d.name === deckId || d.name.toLowerCase() === deckId.toLowerCase()))
    : null;
  const deck = rawDeck || (activeSession?.deck_id ? decks[activeSession.deck_id] : null);

  const activeTypeConfig = (activeSession?.deck_id && activeSession.deck_id.startsWith('type:'))
    ? QUESTION_TYPES_CONFIG.find((t) => t.type === activeSession.deck_id?.replace('type:', ''))
    : null;

  const displayDeckName = activeTypeConfig
    ? `${activeTypeConfig.icon} ${activeTypeConfig.title} Practice`
    : (deck?.name ?? 'Study Session');

  // ─── Session Complete ─────────────────────────────────────────────────
  if (activeSession?.finished_at) {
    const total = activeSession.total_cards;
    const correct = activeSession.correct_count;
    const attempted = activeSession.attempts.length;
    const wrong = Math.max(0, attempted - correct);
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

    // Time calculations
    const startTime = new Date(activeSession.started_at).getTime();
    const finishTime = new Date(activeSession.finished_at).getTime();
    const durationSec = Math.max(1, Math.round((finishTime - startTime) / 1000));
    const formatDur = (s: number) => {
      if (s < 60) return `${s}s`;
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
    };

    // Deck completions & best time from localStorage
    let deckCompletions = 1;
    let bestTimeSec: number | null = null;
    if (typeof window !== 'undefined' && deckId) {
      try {
        const cVal = localStorage.getItem(`noledge_deck_completions_${deckId}`);
        if (cVal) deckCompletions = parseInt(cVal, 10);
        const tVal = localStorage.getItem(`noledge_deck_best_time_${deckId}`);
        if (tVal) bestTimeSec = parseInt(tVal, 10);
      } catch {
        // Fallback
      }
    }

    return (
      <PageTransition>
        <main className={styles.center}>
          <div className={styles.completeCard}>
            <ScoreReveal accuracy={accuracy} streakEmoji="🔥" streakCount={deckCompletions} />
            <h1 className={styles.completeTitle}>Session Complete</h1>

            <div className={styles.completeStatsGrid}>
              <div className={styles.completeStatItem}>
                <span className={styles.completeStatVal} style={{ color: 'var(--color-accent)' }}>{accuracy}%</span>
                <span className={styles.completeStatLbl}>Accuracy</span>
              </div>
              <div className={styles.completeStatItem}>
                <span className={styles.completeStatVal} style={{ color: 'var(--color-correct)' }}>✓ {correct}</span>
                <span className={styles.completeStatLbl}>Correct</span>
              </div>
              <div className={styles.completeStatItem}>
                <span className={styles.completeStatVal} style={{ color: 'var(--color-wrong)' }}>✕ {wrong}</span>
                <span className={styles.completeStatLbl}>Wrong</span>
              </div>

              <div className={styles.completeStatItem}>
                <span className={styles.completeStatVal} style={{ color: 'var(--color-text-primary)' }}>{total}</span>
                <span className={styles.completeStatLbl}>Total Cards</span>
              </div>
              <div className={styles.completeStatItem}>
                <span className={styles.completeStatVal} style={{ color: 'var(--color-text-primary)' }}>{formatDur(durationSec)}</span>
                <span className={styles.completeStatLbl}>Session Time</span>
              </div>
              <div className={styles.completeStatItem}>
                <span className={styles.completeStatVal} style={{ color: 'var(--color-text-primary)' }}>{bestTimeSec ? formatDur(bestTimeSec) : '0 min'}</span>
                <span className={styles.completeStatLbl}>Best Time</span>
              </div>
            </div>

            <div className={styles.completeActions}>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const currentTargetId = typeParam ? `type:${typeParam}` : (deckId ?? activeSession?.deck_id ?? 'all');
                  await startSession(currentTargetId, mode, default_session_limit, typeParam ?? undefined);
                }}
              >
                Study Again
              </button>
              <Link href="/" prefetch={true} className="btn btn-ghost" onClick={() => clearSession()}>
                Back Home
              </Link>
            </div>
          </div>
        </main>
      </PageTransition>
    );
  }

  // ─── Active Session ───────────────────────────────────────────────────
  if (activeSession && !activeSession.finished_at && targetDeckId) {
    const progress = ((currentCardIndex + 1) / activeSession.total_cards) * 100;
    const isGlobalTest = activeSession.deck_id === 'all' || activeSession.deck_id?.startsWith('type:');

    if (isGlobalTest) {
      return (
        <>
          <div className={styles.studioContainer} style={{ justifyContent: 'center', alignItems: 'center' }}>
            <div className={styles.ambientAura} aria-hidden="true" />

            {/* Top-Left Corner Floating Cross Exit Button */}
            <button
              type="button"
              className={styles.globalCrossBtn}
              onClick={() => setShowExitConfirm(true)}
              aria-label="Exit session"
              title="Exit session (Esc)"
            >
              <X size={18} strokeWidth={2} />
            </button>

            {/* Prominent Centered Timer */}
            <div className={styles.globalTopTimerWrap}>
              <CircularTimer />
            </div>

            {/* Main Center Card */}
            <main className={styles.studioBody} style={{ width: '100%', justifyContent: 'center' }}>
              <div className={styles.studyCenterArea}>
                <CardStack isGlobalTest={true} />
              </div>
            </main>
          </div>

          {/* Exit Confirmation Modal (Triggered via Cross button or Escape key) */}
          {showExitConfirm && (
            <div className={styles.exitModalBackdrop} onClick={() => setShowExitConfirm(false)}>
              <div className={styles.exitModalCard} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalIconRing}>
                  <AlertTriangle size={22} />
                </div>

                <div className={styles.modalTextGroup}>
                  <h3 className={styles.exitModalTitle}>Exit Session?</h3>
                  <p className={styles.exitModalText}>
                    Your session progress and recall ratings will be saved automatically.
                  </p>
                </div>

                <div className={styles.modalStatsBadge}>
                  <span className={styles.modalStatsDot} />
                  <span>Card {currentCardIndex + 1} of {activeSession.total_cards}</span>
                </div>

                <div className={styles.exitModalActionsGrid}>
                  <button
                    type="button"
                    className={styles.modalCancelBtn}
                    onClick={() => setShowExitConfirm(false)}
                  >
                    Keep Studying
                  </button>
                  <button
                    type="button"
                    className={styles.modalConfirmBtn}
                    onClick={handleExitConfirm}
                  >
                    Exit Test
                  </button>
                </div>
              </div>
            </div>
          )}

          <KeyboardHints />
        </>
      );
    }

    return (
      <div className={styles.studioContainer}>
        <div className={styles.ambientAura} aria-hidden="true" />

        {/* Top-Left Corner Floating Cross Exit Button (visible on mobile for ALL test modes) */}
        <button
          type="button"
          className={cn(styles.globalCrossBtn, !isGlobalTest && styles.mobileOnlyControl)}
          onClick={() => setShowExitConfirm(true)}
          aria-label="Exit session"
          title="Exit session (Esc)"
        >
          <X size={18} strokeWidth={2} />
        </button>

        {/* Prominent Centered Timer (visible on mobile for ALL test modes) */}
        <div className={cn(styles.globalTopTimerWrap, !isGlobalTest && styles.mobileOnlyControl)}>
          <CircularTimer />
        </div>

        {/* Permanent Floating Toggle Button for Zen Mode (desktop only) */}
        <button
          className={cn(styles.exitZenBtn, styles.desktopOnlyControl)}
          onClick={() => setIsZenMode((prev) => !prev)}
          aria-label={isZenMode ? 'Show panels' : 'Hide panels'}
          title={isZenMode ? 'Show panels (Press F)' : 'Hide panels (Press F)'}
        >
          {isZenMode ? <Eye size={15} /> : <EyeOff size={15} />}
          {isZenMode ? 'Show Panels (F)' : 'Hide Panels (F)'}
        </button>

        {/* Premium Session Header (desktop only) */}
        {!isZenMode && (
          <header className={cn(styles.headerCard, styles.desktopOnlyControl)}>
            <div className={styles.headerTop}>
              <div className={styles.headerLeft}>
                <button
                  type="button"
                  className={styles.exitBtn}
                  onClick={() => setShowExitConfirm(true)}
                  aria-label="Exit session"
                  title="Exit session"
                >
                  <X size={16} strokeWidth={2} />
                </button>
                <div className={styles.headerTitleGroup}>
                  <span className={styles.deckName}>
                    📚 {displayDeckName}
                  </span>
                  <span className={styles.cardProgressBadge}>
                    {currentCardIndex + 1} / {activeSession.total_cards}
                  </span>
                </div>
              </div>

              <div className={styles.headerRight}>
                {show_session_timer && <CircularTimer />}
                <button
                  className={styles.iconBtn}
                  onClick={() => window.dispatchEvent(new CustomEvent('toggle-keyboard-hints'))}
                  aria-label="Keyboard shortcuts"
                  title="Press ? for shortcuts"
                >
                  <Keyboard size={16} strokeWidth={1.75} />
                </button>
              </div>
            </div>

            {show_progress_bar && (
              <div className={styles.headerProgressTrack}>
                <div
                  className={styles.headerProgressBar}
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </header>
        )}

        {/* Main Studio Body: Sidebar | CardStack | AI Tutor */}
        <main className={cn(styles.studioBody, isZenMode && styles.zenMode)}>
          {/* Left Stats Sidebar */}
          {!isZenMode && (
            <aside className={styles.desktopSidebar}>
              <LiveStatsPanel />
            </aside>
          )}

          {/* Card Stack Container */}
          <div className={styles.studyCenterArea}>
            <CardStack />
          </div>
        </main>

        {/* Keyboard Hints */}
        <div className={styles.desktopOnlyControl}>
          <KeyboardHints />
        </div>

        {/* Exit Confirmation Modal */}
        {showExitConfirm && (
          <div className={styles.exitModalBackdrop} onClick={() => setShowExitConfirm(false)}>
            <div className={styles.exitModalCard} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalIconRing}>
                <AlertTriangle size={22} />
              </div>

              <div className={styles.modalTextGroup}>
                <h3 className={styles.exitModalTitle}>Exit Session?</h3>
                <p className={styles.exitModalText}>
                  Your session progress and recall ratings will be saved automatically.
                </p>
              </div>

              <div className={styles.modalStatsBadge}>
                <span className={styles.modalStatsDot} />
                <span>Card {currentCardIndex + 1} of {activeSession.total_cards}</span>
              </div>

              <div className={styles.exitModalActionsGrid}>
                <button
                  type="button"
                  className={styles.modalCancelBtn}
                  onClick={() => setShowExitConfirm(false)}
                >
                  Keep Studying
                </button>
                <button
                  type="button"
                  className={styles.modalConfirmBtn}
                  onClick={handleExitConfirm}
                >
                  Exit Test
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 60-Minute Force Timeout Cyberpunk Glitch Overlay */}
        {isGlitching && (
          <div className={styles.glitchOverlay}>
            <div className={styles.glitchScanlines} />
            <div className={styles.glitchBox}>
              <div className={styles.glitchText}>SYSTEM OVERLOAD // 60:00</div>
              <div className={styles.glitchSubtext}>SESSION TIME LIMIT EXCEEDED • FORCE TERMINATING</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Deck Picker (no deck selected) ──────────────────────────────────
  const deckList = Object.values(decks);

  if (deckList.length === 0) {
    return (
      <PageTransition>
        <main className={styles.center}>
          <div className={cn('card-shell', styles.emptyState)}>
            <Layers size={48} strokeWidth={1.5} className="text-tertiary" />
            <h1 className="text-card-title">No Decks Yet</h1>
            <p className="text-secondary text-center text-sm">
              Connect GitHub or Obsidian to import your questions.
            </p>
            <Link href="/settings?tab=import" prefetch={true} className="btn btn-primary">
              Connect a Source
            </Link>
          </div>
        </main>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <main className={styles.picker}>
        {/* Hero Header */}
        <section className={styles.pickerHeaderCard}>
          <div className={styles.pickerHeaderGlow} />
          <div className={styles.pickerHeaderLeft}>
            <div className={styles.pickerEyebrowRow}>
              <span className={styles.pickerEyebrowBadge}>
                <BookOpen size={12} strokeWidth={2} /> Study Center
              </span>
            </div>
            <h1 className={styles.pickerHeaderTitle}>Choose a Deck</h1>
            <p className={styles.pickerHeaderSubtitle}>Select a deck to start studying and track your retention</p>
          </div>

          <div className={styles.pickerHeaderActions}>
            <Link
              href="/settings?tab=import"
              prefetch={true}
              className="btn btn-primary btn-sm"
              style={{ gap: 6 }}
            >
              <HardDrive size={14} strokeWidth={2} /> Sources
            </Link>
          </div>
        </section>

        {/* Quick Practice Modes */}
        <section className={styles.quickModesSection}>
          <h2 className={styles.sectionTitle}>Quick Practice Modes</h2>
          <div className={styles.quickModesGrid}>
            <div className={styles.quickModeCard}>
              <div className={styles.quickModeHeader}>
                <div className={styles.quickModeTitleGroup}>
                  <span className="eyebrow">Full Library Practice</span>
                  <h3 className={styles.quickModeTitle}>All Decks Pool</h3>
                  <span className={styles.quickModeSubtitle}>{deckList.reduce((sum, d) => sum + (d.question_count ?? 0), 0)} total cards across {deckList.length} decks</span>
                </div>
                <div className={styles.quickModeIcon}>
                  <BookOpen size={20} strokeWidth={1.75} />
                </div>
              </div>
              <div className={styles.quickModeActions}>
                <span className="text-xs text-tertiary font-mono">SRS Spaced Repetition</span>
                <Link href="/study?mode=srs" prefetch={true} className="btn btn-primary btn-sm">
                  Start Full Practice <ChevronRight size={14} />
                </Link>
              </div>
            </div>

            <div className={styles.quickModeCard}>
              <div className={styles.quickModeHeader}>
                <div className={styles.quickModeTitleGroup}>
                  <span className="eyebrow">Speed Challenge</span>
                  <h3 className={styles.quickModeTitle}>10-Card Sprint</h3>
                  <span className={styles.quickModeSubtitle}>Fast 10-card recall test across library</span>
                </div>
                <div className={styles.quickModeIcon} style={{ color: 'var(--color-warning)' }}>
                  <Zap size={20} strokeWidth={1.75} />
                </div>
              </div>
              <div className={styles.quickModeActions}>
                <span className="text-xs text-tertiary font-mono">10 Questions Only</span>
                <Link href="/study?mode=srs&limit=10" prefetch={true} className="btn btn-secondary btn-sm">
                  Start 10-Card Sprint <ChevronRight size={14} />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Study by Question Type (10 Question Formats) */}
        <section className={styles.quickModesSection}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <h2 className={styles.sectionTitle} style={{ marginBottom: 2 }}>Study by Question Type</h2>
              <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>Filter and practice specific question formats from all connected decks in a temporary session</p>
            </div>
          </div>

          <div className={styles.typeGrid}>
            {QUESTION_TYPES_CONFIG.map((t) => {
              const count = typeCounts[t.type] ?? 0;
              return (
                <Link
                  key={t.type}
                  href={`/study?mode=srs&type=${t.type}`}
                  prefetch={true}
                  className={styles.typeCard}
                >
                  <div>
                    <div className={styles.typeCardHeader}>
                      <span className={styles.typeCardIcon}>{t.icon}</span>
                      <span className={styles.typeCardBadge}>{count} cards</span>
                    </div>
                    <div className={styles.typeCardTitle}>{t.title}</div>
                    <div className={styles.typeCardDesc}>{t.description}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Individual Decks Grid */}
        <section className={styles.quickModesSection}>
          <h2 className={styles.sectionTitle}>Your Decks</h2>
          <div className={styles.pickerDeckGrid}>
            {deckList.map((d) => (
              <DeckCard
                key={d.id}
                deck={d}
                href={`/study?deck=${d.id}`}
              />
            ))}
          </div>
        </section>
      </main>
    </PageTransition>
  );
}

export default function StudyPage() {
  return (
    <Suspense>
      <StudyPageContent />
    </Suspense>
  );
}