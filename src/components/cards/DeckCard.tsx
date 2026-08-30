'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, Target, Trophy, ArrowRight, Sparkles } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { Deck } from '@/types/deck';
import styles from './DeckCard.module.css';

interface DeckCardProps {
  deck: Deck;
  href?: string;
  onClick?: () => void;
  isActive?: boolean;
  showActionButton?: boolean;
  className?: string;
}

export function DeckCard({
  deck,
  href,
  onClick,
  isActive = false,
  showActionButton = false,
  className,
}: DeckCardProps) {
  const router = useRouter();
  const accuracy = deck.stats?.accuracy_percent ?? 0;
  const total = deck.question_count ?? 0;
  const mastered = deck.stats?.mastered ?? 0;
  const dueToday = deck.stats?.due_today ?? 0;

  const deckColor = deck.color || 'var(--color-accent)';

  const content = (
    <>
      {/* Top Ambient Glow Strip */}
      <div
        className={styles.ambientTopStrip}
        style={{ background: `linear-gradient(90deg, ${deckColor}, ${deckColor}40, transparent)` }}
      />

      <div className={styles.cardInner}>
        {/* Top Header Row */}
        <div className={styles.headerRow}>
          <div className={styles.eyebrowBadge} style={{ color: deckColor, borderColor: `${deckColor}35`, backgroundColor: `${deckColor}12` }}>
            <span className={styles.colorDot} style={{ background: deckColor }} />
            <span>FLASHCARD DECK</span>
          </div>

          {isActive && (
            <span className={styles.activeBadge}>
              <span className={styles.pulseDot} />
              Active
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className={styles.deckTitle} title={deck.name}>{deck.name}</h3>

        {/* Description */}
        {deck.description && (
          <p className={styles.deckDesc}>{deck.description}</p>
        )}

        {/* Rich Metadata Pills Grid */}
        <div className={styles.metaGrid}>
          <div className={styles.metaPill}>
            <BookOpen size={12} strokeWidth={2} style={{ color: deckColor }} />
            <span>{total} {total === 1 ? 'card' : 'cards'}</span>
          </div>

          <div className={styles.metaPill}>
            <Target size={12} strokeWidth={2} style={{ color: accuracy >= 70 ? 'var(--color-correct)' : 'var(--color-accent)' }} />
            <span>{accuracy}% accuracy</span>
          </div>

          {mastered > 0 && (
            <div className={styles.metaPill}>
              <Trophy size={12} strokeWidth={2} style={{ color: 'var(--color-warning)' }} />
              <span>{mastered}/{total} mastered</span>
            </div>
          )}

        </div>

        {/* Card Footer: Progress Bar or Interactive Action Button */}
        {showActionButton ? (
          <div className={styles.cardFooterAction}>
            <span className={styles.footerTag}>SRS Spaced Practice</span>
            <button
              type="button"
              className={styles.actionBtn}
              style={{ backgroundColor: deckColor, borderColor: deckColor }}
              onClick={(e) => {
                e.stopPropagation();
                if (onClick) onClick();
                if (href) router.push(href);
              }}
            >
              <span>Study Deck</span>
              <ArrowRight size={14} strokeWidth={2.2} className={styles.actionArrow} />
            </button>
          </div>
        ) : (
          <div className={styles.progressContainer}>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{
                  transform: `scaleX(${accuracy / 100})`,
                  background: `linear-gradient(90deg, ${deckColor}, ${deckColor}dd)`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );

  const styleProps = {
    '--deck-color': deckColor,
    '--deck-color-alpha': `${deckColor}25`,
  } as React.CSSProperties;

  if (href) {
    return (
      <Link
        href={href}
        prefetch={true}
        className={cn(styles.deckCard, isActive && styles.deckCardActive, className)}
        style={styleProps}
        onClick={onClick}
      >
        {content}
      </Link>
    );
  }

  return (
    <div
      className={cn(styles.deckCard, isActive && styles.deckCardActive, className)}
      style={styleProps}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`Deck: ${deck.name}`}
    >
      {content}
    </div>
  );
}

export default DeckCard;
