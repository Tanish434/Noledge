/**
 * @file app/page.tsx  (Home — Dashboard)
 * @description Premium dashboard with greeting, progress, heatmap, deck distribution,
 * upcoming reviews, recent activity, study time, quick actions.
 *
 * GSAP animations on mount:
 *   - Header fades in from top
 *   - Stat cards stagger up
 *   - Deck cards stagger in with scale
 *   - Numbers animate (count up)
 *   - Charts animate
 */

'use client';

import React, { useEffect, useRef, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Layers,
  Flame,
  CheckCircle2,
  RefreshCw,
  Clock,
  TrendingUp,
  Calendar,
  ArrowRight,
  Activity,
  type LucideIcon,
} from 'lucide-react';
import { gsap } from 'gsap';
import { useDeckStore } from '@/stores/deckStore';
import { useSyncStore } from '@/stores/syncStore';
import { useSourceStore } from '@/stores/sourceStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/components/ui/Toast';
import { useGSAP, getReducedMotion } from '@/hooks/useGSAP';
import { syncAll, triggerManualPickerSync } from '@/lib/syncEngine';
import { sounds } from '@/lib/sounds';
import { GithubGraph } from '@/components/ui/GithubGraph';
import PageTransition from '@/components/ui/PageTransition';
import DeckCard from '@/components/cards/DeckCard';
import { cn } from '@/utils/cn';
import styles from './page.module.css';

// =============================================================================
// Progress Ring Component
// =============================================================================

function ProgressRing({ percent, size = 46, color = 'var(--color-accent)' }: { percent: number; size?: number; color?: string }) {
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
// Animated Counter Component
// =============================================================================

function AnimatedCounter({ value, suffix = '', duration = 1.2 }: { value: number; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      if (!ref.current || getReducedMotion()) return;
      const obj = { val: 0 };
      gsap.to(obj, {
        val: value,
        duration,
        ease: 'power2.out',
        onUpdate: () => {
          if (ref.current) {
            ref.current.textContent = Math.round(obj.val).toString() + suffix;
          }
        },
      });
    },
    undefined,
    [value]
  );

  return <span ref={ref} className="font-mono">{value}{suffix}</span>;
}

// =============================================================================
// Stat Card Component
// =============================================================================

interface StatCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  color: string;
  animate?: boolean;
}

function StatCard({ label, value, icon: Icon, color, animate = true }: StatCardProps) {
  return (
    <div className={cn('card-shell', styles.statCard)}>
      <div className={styles.statIconWrap} style={{ color }}>
        <Icon size={20} strokeWidth={1.75} />
      </div>
      <div className={styles.statContent}>
        <span className={styles.statValue}>
          {animate && typeof value === 'number' ? <AnimatedCounter value={value} /> : value}
        </span>
        <span className={styles.statLabel}>{label}</span>
      </div>
    </div>
  );
}

// =============================================================================
// Home Page
// =============================================================================

export default function HomePage() {
  const { decks, loadDecks } = useDeckStore();
  const { syncState, isOnline } = useSyncStore();
  const { user } = useAuthStore();
  const { addToast } = useToast();

  const deckList = Object.values(decks);
  const totalDue = deckList.reduce((sum, d) => sum + (d.stats.due_today ?? 0), 0);
  const totalMastered = deckList.reduce((sum, d) => sum + (d.stats?.mastered ?? 0), 0);
  const bestStreak = deckList.reduce((max, d) => Math.max(max, d.stats?.streak ?? 0), 0);
  const totalCards = deckList.reduce((sum, d) => sum + (d.question_count ?? 0), 0);
  const avgAccuracy = deckList.length > 0
    ? Math.round(deckList.reduce((sum, d) => sum + (d.stats?.accuracy_percent ?? 0), 0) / deckList.length)
    : 0;
  const totalReviews = deckList.reduce((sum, d) => sum + (d.stats?.total_reviews ?? 0), 0);

  // Decks with due cards (upcoming reviews)
  const dueDecks = deckList.filter((d) => (d.stats?.due_today ?? 0) > 0).sort((a, b) => (b.stats?.due_today ?? 0) - (a.stats?.due_today ?? 0));

  useEffect(() => {
    void loadDecks();
  }, [loadDecks]);

  // ─── Time-based greeting ─────────────────────────────────────────────
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const handleSync = async () => {
    const { sound_enabled } = useSettingsStore.getState();
    if (sound_enabled) sounds.playToggle();

    addToast('Syncing with GitHub, Obsidian, and local decks...', 'info');

    try {
      const { synced, failed } = await triggerManualPickerSync();
      await loadDecks();
      if (failed > 0 && synced === 0) {
        addToast(`Sync completed with ${failed} warning(s)`, 'warning');
      } else {
        addToast(`Sync complete! ${synced} card(s) synced with GitHub, Obsidian & Local.`, 'success');
      }
    } catch {
      addToast('Sync failed — check connection or file permissions', 'error');
    }
  };

  return (
    <PageTransition>
      <div>
        <main className={styles.home}>
          {/* ── Hero / Header ─────────────────────────────────────────── */}
          <section className={cn(styles.headerCard, 'pt-item')}>
            <div className={styles.headerGlow} />
            <div className={styles.headerLeft}>
              <div className={styles.eyebrowRow}>
                <span className={styles.eyebrowBadge}>
                  <Flame size={12} strokeWidth={2} /> {greeting}
                </span>
              </div>
              <h1 className={styles.headerTitle}>
                <span className="font-mono">{totalCards}</span> Total Cards
              </h1>
              <div className={styles.headerMetaRow}>
                <span className={styles.headerStatPill}>
                  <strong>{deckList.length}</strong> active decks
                </span>
                <span className={styles.headerMetaDot}>•</span>
                <span className={styles.headerStatPill}>
                  <strong>{totalMastered}</strong> mastered
                </span>
                {bestStreak > 0 && (
                  <>
                    <span className={styles.headerMetaDot}>•</span>
                    <span className={cn(styles.headerStatPill, styles.duePill)}>
                      <Flame size={12} strokeWidth={2} />
                      <strong>{bestStreak}</strong> day streak
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className={styles.headerActions}>
              <button
                className={cn('btn btn-sm', styles.headerBtn)}
                onClick={handleSync}
                disabled={syncState === 'syncing' || !isOnline}
              >
                <RefreshCw
                  size={14}
                  className={cn(syncState === 'syncing' && styles.spin)}
                />
                {syncState === 'syncing' ? 'Syncing…' : 'Sync'}
              </button>
              {deckList.length > 0 && (
                <Link href={`/study?deck=${deckList[0].id}`} className="btn btn-primary btn-sm">
                  Start Study <ArrowRight size={14} />
                </Link>
              )}
            </div>
          </section>

          {/* ── Stats Row ────────────────────────────────────────────────── */}
          <section className={cn(styles.statsRow, 'pt-item')} aria-label="Study statistics">
            <StatCard label="Total Decks" value={deckList.length} icon={BookOpen} color="var(--color-accent)" />
            <StatCard label="Streak" value={`${bestStreak}d`} icon={Flame} color="var(--color-warning)" animate={false} />
            <StatCard label="Mastered" value={totalMastered} icon={CheckCircle2} color="var(--color-success)" />
            <StatCard label="Total Reviews" value={totalReviews} icon={Activity} color="var(--color-info)" />
          </section>

          {/* ── Progress & Retention Row ─────────────────────────────────── */}
          <section className={cn(styles.progressRow, 'pt-item')}>
            <div className={cn('card-shell', styles.retentionTestCard)}>
              <div className={styles.retentionHeader}>
                <div className={styles.retentionTitleGroup}>
                  <span className="eyebrow">Retention Test</span>
                  <h3 className={styles.retentionTitle}>Random Practice (All Decks)</h3>
                  <span className={styles.retentionSubtitle}>{totalCards} cards across {deckList.length} decks</span>
                </div>
                <div className={styles.progressRing}>
                  <svg viewBox="0 0 100 100" className={styles.ringSvg}>
                    <circle cx="50" cy="50" r="42" fill="none" stroke="var(--color-bg-active)" strokeWidth="8" />
                    <circle
                      cx="50" cy="50" r="42" fill="none"
                      stroke="var(--color-accent)" strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={`${avgAccuracy * 2.64} 999`}
                      transform="rotate(-90 50 50)"
                      style={{ transition: 'stroke-dasharray 1s var(--ease-spring)' }}
                    />
                  </svg>
                  <span className={styles.ringValue}>
                    <AnimatedCounter value={avgAccuracy} suffix="%" />
                  </span>
                </div>
              </div>

              <div className={styles.retentionMetaRow}>
                <span className={styles.retentionPill}>🎲 All Decks Pool</span>
                <span className={styles.retentionPill}>⚡ Random Queue</span>
              </div>

              <div className={styles.retentionActions}>
                <span className="text-xs text-tertiary font-mono">SRS Algorithm</span>
                <Link href="/study?mode=srs" prefetch={true} className="btn btn-primary btn-sm">
                  Start Random Test <ArrowRight size={14} />
                </Link>
              </div>
            </div>

            <div className={cn('card-shell', styles.progressCard)}>
              <div className={styles.progressHeader}>
                <span className="eyebrow">Study Activity</span>
                <div className={styles.progressHeaderMeta}>
                  <span>{totalReviews} total reviews</span>
                  <Calendar size={15} strokeWidth={1.75} />
                </div>
              </div>
              <GithubGraph
                userId={user?.id}
                months={9}
                cellSize={12}
                cellGap={3.5}
                cellRadius={2.5}
                ambientEffect="twinkle"
                animation="wave"
                showLegend={true}
              />
            </div>
          </section>






          {/* ── Recent Activity ───────────────────────────────────────────── */}
          <section className={cn(styles.deckSection, 'pt-item')} aria-labelledby="recent-heading">
            <div className={styles.sectionHeader}>
              <h2 id="recent-heading" className={styles.sectionTitle}>Recent Activity</h2>
            </div>
            <div className={cn('card-shell', styles.recentActivityCard)}>
              {deckList.length > 0 ? (
                <div className={styles.recentActivityList}>
                  {deckList.slice(0, 5).map((deck) => (
                    <Link
                      key={deck.id}
                      href={`/study?deck=${deck.id}`}
                      className={styles.recentActivityRow}
                    >
                      <div className={styles.recentRowLeft}>
                        <span className={styles.recentColorDot} style={{ background: deck.color }} />
                        <div className={styles.recentRowInfo}>
                          <span className={styles.recentRowName}>{deck.name}</span>
                          <span className={styles.recentRowMeta}>
                            {deck.stats?.total_reviews ?? 0} reviews · {deck.stats?.accuracy_percent ?? 0}% accuracy
                          </span>
                        </div>
                      </div>
                      <span className={styles.recentRowRight}>
                        {(deck.stats?.streak ?? 0) > 0 ? `${deck.stats?.streak}d streak` : '—'}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-secondary text-sm" style={{ padding: 'var(--space-5)' }}>
                  No recent activity. Start studying to see your progress here.
                </p>
              )}
            </div>
          </section>

          {/* ── Your Decks ────────────────────────────────────────────────── */}
          <section className={cn(styles.deckSection, 'pt-item')} aria-labelledby="decks-heading">
            <div className={styles.sectionHeader}>
              <h2 id="decks-heading" className={styles.sectionTitle}>Your Decks</h2>
              <Link href="/manage" className="btn btn-ghost btn-sm">
                Manage <ArrowRight size={14} strokeWidth={1.75} />
              </Link>
            </div>
            {deckList.length === 0 ? (
              <div className={cn('card-shell', styles.emptyDecks)}>
                <Layers size={40} strokeWidth={1.5} className="text-tertiary" />
                <p className="text-secondary">No decks yet.</p>
                <p className="text-sm text-tertiary">Connect a GitHub repo or Obsidian vault to import your questions.</p>
                <Link href="/settings?tab=import" className="btn btn-primary">
                  Connect a Source
                </Link>
              </div>
            ) : (
              <div className={styles.deckGrid}>
                {deckList.map((deck) => (
                  <DeckCard
                    key={deck.id}
                    deck={deck}
                    href={`/study?deck=${deck.id}`}
                  />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </PageTransition>
  );
}