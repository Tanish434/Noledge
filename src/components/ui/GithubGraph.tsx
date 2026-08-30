'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/utils/cn';
import { getStudyActivityHistory } from '@/lib/activityTracker';

export type GithubGraphVariant = 'github' | 'graphite' | 'ocean' | 'violet';
export type GithubGraphAnimation = 'wave' | 'scan' | 'cascade';
export type GithubGraphAmbientEffect = 'none' | 'tide' | 'drift' | 'twinkle';

export type GithubContribution = {
  date: string;
  count: number;
  level?: number;
};

export type GithubContributionCell = GithubContribution & {
  level: number;
};

export type GithubContributionWeek = GithubContributionCell[];

export interface GithubGraphProps {
  /** User account ID linked to study records. */
  userId?: string;
  /** Number of recent calendar months to display in pool. @default 9 */
  months?: number;
  /** Color treatment for contribution levels. @default "github" */
  variant?: GithubGraphVariant;
  /** Entrance choreography for graph cells. @default "wave" */
  animation?: GithubGraphAnimation;
  /** Animation multiplier; higher values reveal the graph faster. @default 1 */
  animationSpeed?: number;
  /** Optional custom base cell size (will be clamped safely to viewport limits). */
  cellSize?: number;
  /** Optional custom cell gap. */
  cellGap?: number;
  /** Optional custom corner radius. */
  cellRadius?: number;
  /** Shows the contribution-level legend. @default true */
  showLegend?: boolean;
  /** Persistent, subtle motion pattern applied to graph cells. @default "twinkle" */
  ambientEffect?: GithubGraphAmbientEffect;
  /** Strength of the persistent cell motion. @default 0.65 */
  ambientIntensity?: number;
  /** Optional preloaded contributions. */
  data?: GithubContribution[];
  className?: string;
}

const VARIANTS: Record<
  GithubGraphVariant,
  [string, string, string, string, string]
> = {
  github: [
    'var(--gh-level-0, var(--color-bg-tertiary))',
    'var(--gh-level-1, #9be9a8)',
    'var(--gh-level-2, #40c463)',
    'var(--gh-level-3, #30a14e)',
    'var(--gh-level-4, #216e39)',
  ],
  graphite: ['var(--gh-level-0, var(--color-bg-tertiary))', '#cccccc', '#969696', '#5f5f5f', '#171717'],
  ocean: ['var(--gh-level-0, var(--color-bg-tertiary))', '#b4e2ff', '#62bdf5', '#2585d8', '#124e93'],
  violet: ['var(--gh-level-0, var(--color-bg-tertiary))', '#dcc5ff', '#b486ff', '#8355df', '#52269c'],
};

function dateFromISO(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function buildContributionWeeks(
  contributions: GithubContribution[],
): GithubContributionWeek[] {
  const valid = contributions
    .map((item) => ({ ...item, parsedDate: dateFromISO(item.date) }))
    .filter(
      (item): item is GithubContribution & { parsedDate: Date } =>
        item.parsedDate !== null && Number.isFinite(item.count),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  if (valid.length === 0) return [];

  const byDate = new Map(valid.map((item) => [item.date, item]));
  const firstDate = valid[0]!.parsedDate;
  const lastDate = valid[valid.length - 1]!.parsedDate;
  const startDate = addDays(firstDate, -firstDate.getUTCDay());
  const endDate = addDays(lastDate, 6 - lastDate.getUTCDay());
  const cells: GithubContributionCell[] = [];

  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const key = isoDate(date);
    const contribution = byDate.get(key);
    const count = Math.max(0, contribution?.count ?? 0);
    const level = contribution?.level ?? (count >= 20 ? 4 : count >= 10 ? 3 : count >= 5 ? 2 : count >= 1 ? 1 : 0);

    cells.push({ date: key, count, level });
  }

  return Array.from({ length: Math.ceil(cells.length / 7) }, (_, index) =>
    cells.slice(index * 7, index * 7 + 7),
  );
}

function formatContributionLabel(contribution: GithubContributionCell): string {
  const date = new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
  }).format(dateFromISO(contribution.date) ?? new Date());

  if (contribution.count === 0) {
    return `No study activity · ${date}`;
  }
  const label = contribution.count === 1 ? 'review completed' : 'reviews completed';
  return `${contribution.count} ${label} · ${date}`;
}

function getCellDelay(
  animation: GithubGraphAnimation,
  weekIndex: number,
  dayIndex: number,
  speed: number,
): number {
  const step =
    animation === 'wave'
      ? weekIndex * 0.022 + dayIndex * 0.014
      : animation === 'scan'
        ? weekIndex * 0.025
        : (weekIndex + dayIndex * 2) * 0.015;
  return step / Math.max(speed, 0.1);
}

function getAmbientCellStyle(
  effect: GithubGraphAmbientEffect,
  intensity: number,
  weekIndex: number,
  dayIndex: number,
  entranceDelay: number,
  reducedMotion: boolean | null,
): React.CSSProperties {
  if (reducedMotion || effect === 'none') {
    return {};
  }

  const strength = Math.min(1, Math.max(0, intensity));
  const seed = ((weekIndex * 17 + dayIndex * 31) % 11) / 10;
  const isTide = effect === 'tide';
  const isDrift = effect === 'drift';
  const duration = isTide ? 4.8 : isDrift ? 5.2 + seed * 1.2 : 3.8 + seed * 1.5;
  const delay =
    entranceDelay +
    (isTide ? (weekIndex + dayIndex * 1.8) * 0.08 : seed * 1.2);
  const lowOpacity = 1 - (isTide ? 0.22 : isDrift ? 0.15 : 0.30) * strength;
  const animName = isTide ? 'gh-tide' : isDrift ? 'gh-drift' : 'gh-twinkle';

  return {
    animation: `${animName} ${duration.toFixed(2)}s ease-in-out ${delay.toFixed(2)}s infinite`,
    '--gh-low-op': lowOpacity,
  } as React.CSSProperties;
}

export function GithubGraph({
  userId,
  months = 9,
  variant = 'github',
  animation = 'wave',
  animationSpeed = 1,
  cellSize,
  cellGap,
  cellRadius,
  showLegend = true,
  ambientEffect = 'twinkle',
  ambientIntensity = 0.65,
  data,
  className,
}: GithubGraphProps) {
  const reducedMotion = useReducedMotion();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState<number | null>(null);

  const [contributions, setContributions] = React.useState<GithubContribution[]>(() => {
    return data || [];
  });

  const [hoveredContribution, setHoveredContribution] = React.useState<{
    contribution: GithubContributionCell;
    left: number;
    top: number;
    placement: 'above' | 'below';
    weekIndex: number;
    dayIndex: number;
  } | null>(null);

  const [portalElement, setPortalElement] = React.useState<HTMLElement | null>(null);
  const colors = VARIANTS[variant];

  // Dynamic box sizing and gap limits calibrated to screen & container division
  const { effectiveCellSize, effectiveCellGap, effectiveCellRadius } = React.useMemo(() => {
    const w = containerWidth ?? 600;
    let baseSize = 12;
    let baseGap = 3.5;
    let baseRadius = 2.5;

    if (w < 380) {
      // Mobile compact (e.g. iPhone 13 mini)
      baseSize = 10.5;
      baseGap = 2.5;
      baseRadius = 2;
    } else if (w < 600) {
      // Standard mobile / narrow view
      baseSize = 11.5;
      baseGap = 3;
      baseRadius = 2;
    } else if (w < 1080) {
      // Tablet / medium viewport
      baseSize = 12.5;
      baseGap = 3.5;
      baseRadius = 2.5;
    } else {
      // Desktop / large screen
      baseSize = 13;
      baseGap = 4;
      baseRadius = 3;
    }

    const resolvedSize = cellSize !== undefined ? Math.min(14, Math.max(9, cellSize)) : baseSize;
    const resolvedGap = cellGap !== undefined ? Math.min(6, Math.max(2, cellGap)) : baseGap;
    const resolvedRadius = cellRadius !== undefined ? Math.min(resolvedSize / 2, cellRadius) : baseRadius;

    return {
      effectiveCellSize: resolvedSize,
      effectiveCellGap: resolvedGap,
      effectiveCellRadius: resolvedRadius,
    };
  }, [containerWidth, cellSize, cellGap, cellRadius]);

  React.useEffect(() => {
    const el = document.createElement('div');
    el.setAttribute('data-github-tooltip-portal', 'true');
    document.body.appendChild(el);
    setPortalElement(el);

    return () => {
      setHoveredContribution(null);
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    };
  }, []);

  // Measure container width to render ONLY visible weeks with ZERO horizontal scroll
  React.useEffect(() => {
    if (!containerRef.current) return;
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    updateWidth();
    const ro = new ResizeObserver(() => {
      updateWidth();
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Fetch actual study and test activity for this user ID
  const loadUserActivity = React.useCallback(async () => {
    if (data) {
      setContributions(data);
      return;
    }
    const history = await getStudyActivityHistory(months, userId);
    setContributions(history);
  }, [data, months, userId]);

  React.useEffect(() => {
    void loadUserActivity();

    const handleUpdate = () => {
      void loadUserActivity();
    };

    window.addEventListener('noledge_activity_updated', handleUpdate);
    return () => {
      window.removeEventListener('noledge_activity_updated', handleUpdate);
    };
  }, [loadUserActivity]);

  // Compute ONLY visible weeks that fit cleanly without scrolling or border merging
  const visibleWeeks = React.useMemo(() => {
    const allWeeks = buildContributionWeeks(contributions);
    if (!containerWidth || containerWidth <= 0) {
      return allWeeks.slice(-18);
    }
    const maxFittingWeeks = Math.max(
      4,
      Math.floor((containerWidth + effectiveCellGap) / (effectiveCellSize + effectiveCellGap))
    );
    return allWeeks.slice(-maxFittingWeeks);
  }, [contributions, containerWidth, effectiveCellSize, effectiveCellGap]);

  const animationKey = `${userId ?? 'guest'}-${visibleWeeks.length}-${variant}-${animation}`;

  const showTooltip = React.useCallback(
    (
      element: HTMLElement,
      contribution: GithubContributionCell,
      weekIndex: number,
      dayIndex: number,
    ) => {
      const cellRect = element.getBoundingClientRect();
      const placement = cellRect.top > 56 ? 'above' : 'below';
      const left = Math.min(
        Math.max(cellRect.left + cellRect.width / 2, 96),
        window.innerWidth - 96,
      );
      setHoveredContribution({
        contribution,
        left,
        top: placement === 'above' ? cellRect.top - 8 : cellRect.bottom + 8,
        placement,
        weekIndex,
        dayIndex,
      });
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className={cn(className)}
      style={{ width: '100%', overflow: 'hidden' }}
    >
      {visibleWeeks.length > 0 && (
        <div
          style={{
            overflow: 'hidden',
            padding: '0.25rem 0',
            width: '100%',
          }}
        >
          <div
            style={{
              position: 'relative',
              display: 'flex',
              gap: effectiveCellGap,
              justifyContent: 'flex-start',
              width: '100%',
              overflow: 'hidden',
            }}
            role="grid"
            aria-label="User study activity history"
            onMouseLeave={() => setHoveredContribution(null)}
          >
            {visibleWeeks.map((week, weekIndex) => (
              <div
                key={`${animationKey}-${weekIndex}`}
                style={{
                  display: 'grid',
                  gridTemplateRows: 'repeat(7, minmax(0, 1fr))',
                  gap: effectiveCellGap,
                  flexShrink: 0,
                }}
                role="row"
              >
                {week.map((contribution, dayIndex) => {
                  const label = formatContributionLabel(contribution);
                  const entranceDelay = reducedMotion
                    ? 0
                    : getCellDelay(
                        animation,
                        weekIndex,
                        dayIndex,
                        animationSpeed,
                      );
                  const ambientStyle = getAmbientCellStyle(
                    ambientEffect,
                    ambientIntensity,
                    weekIndex,
                    dayIndex,
                    entranceDelay,
                    reducedMotion,
                  );
                  const distance = hoveredContribution
                    ? Math.hypot(
                        weekIndex - hoveredContribution.weekIndex,
                        dayIndex - hoveredContribution.dayIndex,
                      )
                    : Infinity;
                  const waveStrength = Math.max(0, 1 - distance / 2.5);
                  const filter = `brightness(${1 + waveStrength * 0.35}) saturate(${1 + waveStrength * 0.15})`;

                  return (
                    <motion.button
                      key={`${animationKey}-${contribution.date}`}
                      data-week={weekIndex}
                      data-day={dayIndex}
                      type="button"
                      role="gridcell"
                      aria-label={label}
                      style={{
                        width: effectiveCellSize,
                        height: effectiveCellSize,
                        minWidth: effectiveCellSize,
                        minHeight: effectiveCellSize,
                        maxWidth: effectiveCellSize,
                        maxHeight: effectiveCellSize,
                        borderRadius: effectiveCellRadius,
                        position: 'relative',
                        outline: 'none',
                        border: 'none',
                        background: 'transparent',
                        padding: 0,
                        cursor: 'pointer',
                        boxSizing: 'border-box',
                        flexShrink: 0,
                        transformOrigin: 'center center',
                      }}
                      initial={
                        reducedMotion
                          ? false
                          : { opacity: 0, scale: 0.35, y: 4 }
                      }
                      animate={{ opacity: 1, scale: 1, y: 0, filter }}
                      whileHover={{ scale: 1.25, zIndex: 20 }}
                      whileTap={{ scale: 0.92 }}
                      transition={{
                        opacity: { duration: 0.14, delay: entranceDelay },
                        y: {
                          type: 'spring',
                          stiffness: 520,
                          damping: 28,
                          delay: entranceDelay,
                        },
                        scale: { type: 'spring', stiffness: 750, damping: 28 },
                        filter: { duration: 0.08, ease: 'easeOut' },
                      }}
                      onMouseEnter={(event) =>
                        showTooltip(
                          event.currentTarget,
                          contribution,
                          weekIndex,
                          dayIndex,
                        )
                      }
                      onFocus={(event) =>
                        showTooltip(
                          event.currentTarget,
                          contribution,
                          weekIndex,
                          dayIndex,
                        )
                      }
                      onBlur={() => setHoveredContribution(null)}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          pointerEvents: 'none',
                          position: 'absolute',
                          inset: 0,
                          backgroundColor: colors[contribution.level],
                          borderRadius: effectiveCellRadius,
                          boxShadow: contribution.level === 0 ? 'inset 0 0 0 1px var(--color-border-subtle, rgba(255, 255, 255, 0.06))' : undefined,
                          ...ambientStyle,
                        }}
                      />
                    </motion.button>
                  );
                })}
              </div>
            ))}

            {hoveredContribution && portalElement && createPortal(
              <div
                role="tooltip"
                style={{
                  pointerEvents: 'none',
                  position: 'fixed',
                  zIndex: 2147483647,
                  left: `${hoveredContribution.left}px`,
                  top: `${hoveredContribution.top}px`,
                  transform: hoveredContribution.placement === 'above' ? 'translate(-50%, -100%)' : 'translate(-50%, 0%)',
                  backgroundColor: 'var(--gh-tooltip-bg, #09090b)',
                  color: 'var(--gh-tooltip-text, #ffffff)',
                  padding: '6px 12px',
                  borderRadius: '9999px',
                  fontSize: '12px',
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                  boxShadow: 'var(--shadow-md), 0 0 0 1px var(--color-border-strong)',
                  whiteSpace: 'nowrap',
                  lineHeight: '1.2',
                }}
              >
                {formatContributionLabel(hoveredContribution.contribution)}
              </div>,
              portalElement
            )}
          </div>
        </div>
      )}

      {showLegend && (
        <div
          style={{ marginTop: '0.75rem', display: 'flex', gap: '0.375rem', alignItems: 'center', justifyContent: 'flex-end' }}
          aria-label="Study activity legend"
        >
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginRight: '0.25rem' }}>Less</span>
          {colors.map((color, level) => (
            <span
              key={color}
              style={{
                width: effectiveCellSize,
                height: effectiveCellSize,
                backgroundColor: color,
                borderRadius: effectiveCellRadius,
                boxShadow: level === 0 ? 'inset 0 0 0 1px var(--color-border-subtle, rgba(255, 255, 255, 0.06))' : undefined,
              }}
              aria-label={`Level ${level}`}
            />
          ))}
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginLeft: '0.25rem' }}>More</span>
        </div>
      )}
    </div>
  );
}
