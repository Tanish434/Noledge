/**
 * @file components/ui/Sidebar.tsx
 * @description Desktop & Mobile Navigation adhering to sidebar-001 design system.
 */

'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useDeckStore } from '@/stores/deckStore';
import { useQuestionStore } from '@/stores/questionStore';
import { cn } from '@/utils/cn';
import { sounds } from '@/lib/sounds';
import {
  Palette,
  GraduationCap,
  RefreshCw,
  Download,
  Accessibility,
  SlidersHorizontal,
  Info,
  ChevronRight,
  Home,
  BookOpen,
  PlusCircle,
  Settings,
} from 'lucide-react';
import {
  Sidebar001,
  Sidebar001Header,
  Sidebar001Content,
  Sidebar001Section,
  Sidebar001Item,
  Sidebar001SubItem,
  Sidebar001Footer,
} from './sidebar-001';
import { SidebarToggleIcon } from './SidebarToggleIcon';
import Popover from './Popover';
import SyncStatus from './SyncStatus';
import styles from './Sidebar.module.css';

// Settings sub-nav items — mirrors the settings page sections
const SETTINGS_SUBNAV = [
  { tab: 'appearance',    label: 'Appearance',   icon: Palette           },
  { tab: 'study',         label: 'Study',         icon: GraduationCap     },
  { tab: 'sync',          label: 'Sync',          icon: RefreshCw         },
  { tab: 'import',        label: 'Import',        icon: Download          },
  { tab: 'accessibility', label: 'Accessibility', icon: Accessibility     },
  { tab: 'advanced',      label: 'Advanced',      icon: SlidersHorizontal },
  { tab: 'about',         label: 'About',         icon: Info              },
] as const;

// =============================================================================
// Sidebar Control Popover Menu (2 options: Expanded & Expand on hover)
// =============================================================================

function SidebarControlMenu() {
  const { sidebar_expand_on_hover, updateSetting } = useSettingsStore();

  const activeMode: 'expanded' | 'hover' = sidebar_expand_on_hover ? 'hover' : 'expanded';

  const selectMode = (mode: 'expanded' | 'hover') => {
    if (mode === 'expanded') {
      updateSetting('sidebar_collapsed', false);
      updateSetting('sidebar_expand_on_hover', false);
    } else if (mode === 'hover') {
      updateSetting('sidebar_collapsed', true);
      updateSetting('sidebar_expand_on_hover', true);
    }
  };

  return (
    <div className={styles.popoverContent}>
      <div className={styles.popoverHeader}>Sidebar control</div>
      <div className={styles.popoverDivider} role="separator" />

      <button
        className={cn(styles.popoverItem, activeMode === 'expanded' && styles.popoverItemActive)}
        onClick={() => selectMode('expanded')}
      >
        <span className={styles.popoverDotContainer}>
          {activeMode === 'expanded' && <span className={styles.popoverDot} />}
        </span>
        <span>Expanded</span>
      </button>

      <button
        className={cn(styles.popoverItem, activeMode === 'hover' && styles.popoverItemActive)}
        onClick={() => selectMode('hover')}
      >
        <span className={styles.popoverDotContainer}>
          {activeMode === 'hover' && <span className={styles.popoverDot} />}
        </span>
        <span>Expand on hover</span>
      </button>
    </div>
  );
}

// =============================================================================
// Sync Indicator Dot
// =============================================================================

function SyncDot() {
  const { syncState } = useSyncStore();
  const { auto_sync } = useSettingsStore();

  if (!auto_sync) {
    return (
      <span className={styles.statusDotWrapper}>
        <span
          className="sync-dot"
          style={{ background: 'var(--color-text-tertiary)', opacity: 0.45 }}
          aria-label="Auto-sync disabled"
          title="Auto-sync disabled"
        />
      </span>
    );
  }

  return (
    <span className={styles.statusDotWrapper}>
      <span
        className={cn(
          'sync-dot',
          syncState === 'syncing' && 'sync-dot--syncing',
          syncState === 'offline' && 'sync-dot--offline',
          syncState === 'error' && 'sync-dot--error',
          syncState === 'conflict' && 'sync-dot--conflict',
        )}
        aria-label={`Sync status: ${syncState}`}
        title={`Sync: ${syncState}`}
      />
    </span>
  );
}

// =============================================================================
// Desktop Sidebar (Original sidebar-001 Design)
// =============================================================================

function DesktopSidebar({ onOpenCommandPalette }: { onOpenCommandPalette: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { syncState } = useSyncStore();
  const { decks } = useDeckStore();
  const { sidebar_expand_on_hover, auto_sync } = useSettingsStore();
  const [isHoverRevealed, setIsHoverRevealed] = useState(false);
  // Settings sub-nav collapse — auto-opens when on /settings
  const [isSubNavOpen, setIsSubNavOpen] = useState(false);

  useEffect(() => {
    if (pathname.startsWith('/settings')) {
      setIsSubNavOpen(true);
    } else {
      setIsSubNavOpen(false);
    }
  }, [pathname]);

  const deckList = Object.values(decks);

  const isActive = (href: string, exact = false): boolean => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  useEffect(() => {
    if (sidebar_expand_on_hover) {
      document.documentElement.setAttribute('data-sidebar', 'hover');
    } else {
      document.documentElement.removeAttribute('data-sidebar');
    }
  }, [sidebar_expand_on_hover]);

  if (pathname === '/auth' || pathname.startsWith('/auth')) {
    return null;
  }

  return (
    <>
      {/* Invisible Hover Sensor for Expand on Hover mode */}
      {sidebar_expand_on_hover && (
        <div
          className={styles.hoverSensor}
          onMouseEnter={() => setIsHoverRevealed(true)}
          aria-hidden="true"
        />
      )}

      {/* Desktop Sidebar Wrapper */}
      <div
        className={cn(
          styles.desktopSidebarWrapper,
          sidebar_expand_on_hover && styles.hoverModeWrapper,
          sidebar_expand_on_hover && isHoverRevealed && styles.hoverModeWrapperVisible
        )}
        onMouseEnter={() => {
          if (sidebar_expand_on_hover) setIsHoverRevealed(true);
        }}
        onMouseLeave={() => {
          if (sidebar_expand_on_hover) setIsHoverRevealed(false);
        }}
      >
        <Sidebar001 className={styles.sidebarRoot}>
          {/* Header matching original sidebar-001 */}
          <Sidebar001Header>
            <div className="flex items-center justify-between pl-3 pr-1">
              <div className="flex items-center gap-2">
                <Popover
                  side="bottom-start"
                  openOnHover={false}
                  closeOnSelect
                  className={styles.sidebarControlPopover}
                  trigger={
                    <button
                      className="flex items-center text-foreground hover:opacity-80 transition-opacity cursor-pointer p-0.5"
                      aria-label="Toggle sidebar mode"
                      title="Sidebar mode"
                    >
                      <SidebarToggleIcon isOpen={!sidebar_expand_on_hover} strokeWidth={1.5} />
                    </button>
                  }
                >
                  <SidebarControlMenu />
                </Popover>
                <Link href="/" className="font-medium text-sm text-foreground" style={{ textDecoration: 'none' }}>
                  Noledge
                </Link>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onOpenCommandPalette}
                  className="text-xs text-foreground/40 hover:text-foreground/70 transition-colors px-1.5 py-0.5 rounded border border-border/50 cursor-pointer"
                  title="Search (⌘K)"
                >
                  ⌘K
                </button>
              </div>
            </div>
          </Sidebar001Header>

          {/* Navigation Options */}
          <Sidebar001Content>
            <Sidebar001Section label="Study">
              <Sidebar001Item
                href="/"
                label="Home"
                isActive={isActive('/', true)}
              />
              <Sidebar001Item
                href="/study"
                label="Study"
                isActive={isActive('/study')}
                onClick={() => useQuestionStore.getState().clearSession()}
              />
              <Sidebar001Item
                href="/manage"
                label="Library"
                isActive={isActive('/manage')}
              />
              <Sidebar001Item
                href="/create"
                label="Create"
                isActive={isActive('/create')}
              />
            </Sidebar001Section>

            <Sidebar001Section label="Preferences">
              {/* Settings item row + hover-activatable sub-panel container */}
              <div
                onMouseEnter={() => setIsSubNavOpen(true)}
                onMouseLeave={() => {
                  if (!isActive('/settings')) {
                    setIsSubNavOpen(false);
                  }
                }}
                style={{ display: 'flex', flexDirection: 'column' }}
              >
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => setIsSubNavOpen((v) => !v)}>
                  <Sidebar001Item
                    href="/settings"
                    label="Settings"
                    isActive={isActive('/settings')}
                  />
                </div>

                <AnimatePresence initial={false}>
                  {(isSubNavOpen || isActive('/settings')) && (
                    <motion.div
                      key="settings-subnav"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      style={{ overflow: 'hidden' }}
                    >
                      {SETTINGS_SUBNAV.map((item) => {
                        const activeTab = searchParams.get('tab') ?? 'appearance';
                        return (
                          <div
                            key={item.tab}
                            onClick={() => {
                              console.log(`[Settings SubPanel] Selected sub-panel item: ${item.label} (tab=${item.tab})`);
                            }}
                          >
                            <Sidebar001SubItem
                              href={`/settings?tab=${item.tab}`}
                              label={item.label}
                              icon={item.icon}
                              isActive={isActive('/settings') && activeTab === item.tab}
                            />
                          </div>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Sidebar001Section>
          </Sidebar001Content>

          {/* Footer with version tag, sync state, and Supabase Auth */}
          <Sidebar001Footer>
            <div className="flex flex-col w-full h-full justify-between gap-1">
              <div className="flex flex-col justify-center flex-1 py-1">
                <SyncStatus />
              </div>
              <div className="flex items-center justify-between text-xs text-foreground/40 w-full py-1.5 border-t border-border/40 shrink-0">
                <span className="text-[11px] text-foreground/35 select-none font-mono">v1.0.0</span>
                <span className="text-[11px]">
                  {!auto_sync
                    ? 'Sync Off'
                    : syncState === 'syncing'
                    ? 'Syncing…'
                    : syncState === 'offline'
                    ? 'Offline'
                    : 'GitHub Synced'}
                </span>
              </div>
            </div>
          </Sidebar001Footer>
        </Sidebar001>
      </div>
    </>
  );
}

// =============================================================================
// Mobile Floating Scale Dock — Horizontal ruler matching PC sidebar structure
// =============================================================================

// =============================================================================
// Mobile Floating Scale Dock — Horizontal ruler matching PC sidebar structure
// =============================================================================

// =============================================================================
// Mobile Floating Scale Dock — Compact Icon Dock with Slide-Only Scale Ruler
// =============================================================================

function MobileDock() {
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const router       = useRouter();

  // ── State ──────────────────────────────────────────────────────────────────
  const [pointerX,      setPointerX]      = useState<number | null>(null);
  const [showSubRuler,  setShowSubRuler]   = useState(false);
  const [subPointerX,   setSubPointerX]    = useState<number | null>(null);
  const [hoverLabel,    setHoverLabel]     = useState<string | null>(null);
  const [showBadge,     setShowBadge]      = useState(true);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const dockRef       = React.useRef<HTMLDivElement | null>(null);
  const subRulerRef   = React.useRef<HTMLDivElement | null>(null);
  const downXRef      = React.useRef<number | null>(null);
  const downYRef      = React.useRef<number | null>(null);
  const isDragRef     = React.useRef(false);
  const lastIdxRef    = React.useRef<number | null>(null);
  const subLastIdxRef = React.useRef<number | null>(null);
  const isSubDragRef  = React.useRef(false);
  const badgeTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  // ── Nav items ──────────────────────────────────────────────────────────────
  const navItems = [
    { href: '/',         label: 'Home',    icon: Home         },
    { href: '/study',    label: 'Study',   icon: GraduationCap},
    { href: '/manage',   label: 'Library', icon: BookOpen     },
    { href: '/create',   label: 'Create',  icon: PlusCircle   },
    { href: '/settings', label: 'Settings',icon: Settings     },
  ];

  // ── Helpers ────────────────────────────────────────────────────────────────
  const getIdx = (ref: React.RefObject<HTMLDivElement | null>, clientX: number, count: number) => {
    if (!ref.current) return -1;
    const rect = ref.current.getBoundingClientRect();
    const x    = clientX - rect.left;
    return Math.min(count - 1, Math.max(0, Math.floor(x / (rect.width / count))));
  };

  // Trigger 1-second badge auto-hide timer
  const scheduleBadgeHide = () => {
    if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
    setShowBadge(true);
    badgeTimerRef.current = setTimeout(() => {
      setShowBadge(false);
    }, 1000); // Hide after 1 second of inactivity
  };

  // On page change: show badge briefly for 1 second then hide
  useEffect(() => {
    scheduleBadgeHide();
    return () => {
      if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
    };
  }, [pathname, searchParams]);

  // iOS audio unlock: attach native touchstart on DOM node
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const handler = () => sounds.unlockSync();
    el.addEventListener('touchstart', handler, { passive: true, capture: true });
    return () => el.removeEventListener('touchstart', handler, { capture: true });
  }, []);

  // ── Main dock gesture handlers ─────────────────────────────────────────────
  const onDockDown = (e: React.PointerEvent) => {
    sounds.unlockSync();
    if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
    setShowBadge(true);
    downXRef.current  = e.clientX;
    downYRef.current  = e.clientY;
    isDragRef.current = false;
    if (!dockRef.current) return;
    const idx = getIdx(dockRef, e.clientX, navItems.length);
    lastIdxRef.current = idx;
    if (navItems[idx]) setHoverLabel(navItems[idx].label);
    void sounds.playTick();
    sounds.vibrate(6);
  };

  const onDockMove = (e: React.PointerEvent) => {
    if (downXRef.current === null) return;
    const dx = Math.abs(e.clientX - downXRef.current);
    const dy = downYRef.current !== null ? downYRef.current - e.clientY : 0;
    
    // Only activate drag sliding state when user moves finger > 6px
    if (!isDragRef.current && dx > 6) {
      isDragRef.current = true;
    }

    setShowBadge(true);

    // Upward gesture over Settings slot opens sub-ruler
    if (!showSubRuler && dy > 20) {
      const idx = getIdx(dockRef, e.clientX, navItems.length);
      if (navItems[idx]?.href === '/settings') {
        setShowSubRuler(true);
        void sounds.playTick();
        sounds.vibrate(14);
      }
    }

    if (!dockRef.current) return;
    if (isDragRef.current) {
      const rect = dockRef.current.getBoundingClientRect();
      setPointerX(e.clientX - rect.left);
      const idx = getIdx(dockRef, e.clientX, navItems.length);
      if (idx !== lastIdxRef.current) {
        lastIdxRef.current = idx;
        if (navItems[idx]) setHoverLabel(navItems[idx].label);
        void sounds.playTick();
        sounds.vibrate(6);
      }
    }
  };

  const onDockUp = (e: React.PointerEvent) => {
    const dx = downXRef.current !== null ? Math.abs(e.clientX - downXRef.current) : 0;
    const idx = getIdx(dockRef, e.clientX, navItems.length);
    const target = navItems[idx];

    if (!isDragRef.current && dx < 6) {
      // Tap gesture
      if (target) {
        if (target.href === '/settings') {
          setShowSubRuler((prev) => !prev);
          void sounds.playTick();
          sounds.vibrate(12);
        } else {
          if (target.href === '/study') {
            useQuestionStore.getState().clearSession();
          }
          router.push(target.href);
          setShowSubRuler(false);
          void sounds.playTick();
          sounds.vibrate(8);
        }
      }
    } else if (isDragRef.current && target) {
      // Drag release gesture
      if (target.href === '/settings') {
        setShowSubRuler(true);
      } else {
        if (target.href === '/study') {
          useQuestionStore.getState().clearSession();
        }
        router.push(target.href);
        setShowSubRuler(false);
      }
      void sounds.playTick();
      sounds.vibrate(8);
    }

    downXRef.current   = null;
    downYRef.current   = null;
    isDragRef.current  = false;
    setPointerX(null);
    setHoverLabel(null);
    lastIdxRef.current = null;
    scheduleBadgeHide();
  };

  const onDockLeave = () => {
    downXRef.current   = null;
    downYRef.current   = null;
    isDragRef.current  = false;
    setPointerX(null);
    setHoverLabel(null);
    lastIdxRef.current = null;
    scheduleBadgeHide();
  };

  // ── Sub-ruler gesture handlers ─────────────────────────────────────────────
  const onSubDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    sounds.unlockSync();
    if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
    setShowBadge(true);
    isSubDragRef.current = false;
    downXRef.current     = e.clientX;
    if (!subRulerRef.current) return;
    const idx = getIdx(subRulerRef, e.clientX, SETTINGS_SUBNAV.length);
    subLastIdxRef.current = idx;
    if (SETTINGS_SUBNAV[idx]) setHoverLabel(`Settings ▸ ${SETTINGS_SUBNAV[idx].label}`);
    void sounds.playTick();
    sounds.vibrate(6);
  };

  const onSubMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (downXRef.current === null) return;
    const dx = Math.abs(e.clientX - downXRef.current);
    if (!isSubDragRef.current && dx > 6) {
      isSubDragRef.current = true;
    }
    setShowBadge(true);
    if (!subRulerRef.current) return;
    if (isSubDragRef.current) {
      const rect = subRulerRef.current.getBoundingClientRect();
      setSubPointerX(e.clientX - rect.left);
      const idx = getIdx(subRulerRef, e.clientX, SETTINGS_SUBNAV.length);
      if (idx !== subLastIdxRef.current) {
        subLastIdxRef.current = idx;
        if (SETTINGS_SUBNAV[idx]) setHoverLabel(`Settings ▸ ${SETTINGS_SUBNAV[idx].label}`);
        void sounds.playTick();
        sounds.vibrate(6);
      }
    }
  };

  const onSubUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    const idx = getIdx(subRulerRef, e.clientX, SETTINGS_SUBNAV.length);
    const sub = SETTINGS_SUBNAV[idx];
    if (sub) {
      router.push(`/settings?tab=${sub.tab}`);
      setTimeout(() => setShowSubRuler(false), 0);
      void sounds.playTick();
      sounds.vibrate(8);
    }
    isSubDragRef.current  = false;
    downXRef.current      = null;
    setSubPointerX(null);
    setHoverLabel(null);
    subLastIdxRef.current = null;
    scheduleBadgeHide();
  };

  // ── Dynamic Lift Physics — Icon lifts up to 26px upward on drag ─────────────
  const getLift = (
    pX: number | null,
    ref: React.RefObject<HTMLDivElement | null>,
    index: number,
    count: number,
    isActive: boolean
  ) => {
    let liftY   = isActive ? 4 : 0;
    let opacity = isActive ? 1 : 0.48;
    let scale   = 1;

    if (pX !== null && ref.current) {
      const rect    = ref.current.getBoundingClientRect();
      const itemW   = rect.width / count;
      const centerX = (index + 0.5) * itemW;
      const dist    = Math.abs(pX - centerX);
      const radius  = itemW * 1.8;
      if (dist < radius) {
        const factor = Math.cos((dist / radius) * (Math.PI / 2));
        liftY   = Math.max(liftY, factor * 26);
        opacity = Math.max(opacity, 0.48 + factor * 0.52);
        scale   = 1 + factor * 0.32;
      }
    }
    return { liftY, opacity, scale };
  };

  // Single Unified Ruler Overlay: 100% mathematically centered Main Lines & Gap Sub-Ticks
  const renderUnifiedRuler = (
    pX: number | null,
    ref: React.RefObject<HTMLDivElement | null>,
    isSliding: boolean,
    activeIdx: number,
    itemCount: number,
    isSub = false,
    subTicksPerGap = 4
  ) => {
    const ticks: React.ReactNode[] = [];
    const paddingVar = isSub ? 'var(--padding-sub)' : 'var(--padding-main)';
    const slotWVar   = isSub ? 'var(--slot-w-sub)'   : 'var(--slot-w-main)';

    // Helper to calculate wave height for any tick position in pixels during drag
    const isSmall   = typeof window !== 'undefined' && window.innerWidth <= 370;
    const paddingPx = isSub ? 12 : 14;
    const slotWPx   = isSub ? (isSmall ? 38 : 46) : (isSmall ? 50 : 58);

    const getWaveH = (tickSlotRatio: number, baseH: number) => {
      let h = baseH;
      if (pX !== null && ref.current) {
        const tickX  = paddingPx + tickSlotRatio * slotWPx;
        const dist   = Math.abs(pX - tickX);
        const radius = slotWPx * 0.95;
        if (dist < radius) {
          const factor = Math.cos((dist / radius) * (Math.PI / 2));
          h = Math.max(h, baseH + factor * 14);
        }
      }
      return h;
    };

    const startY = isSub ? 10 : 8;

    // 1. Edge sub-ticks before first slot center
    for (let e = 1; e <= 2; e++) {
      const h = getWaveH((e / 3) * 0.5, 3);
      ticks.push(
        <motion.div
          key={`edge-start-${e}`}
          className={styles.scaleSubTick}
          initial={false}
          style={{ left: `calc(${e / 3} * (${paddingVar} + 0.5 * ${slotWVar}) - 0.5px)`, height: `${h}px` }}
          animate={{
            y: isSliding ? 0 : startY,
            opacity: isSliding ? 1 : 0,
          }}
          transition={{
            y: { type: 'spring', stiffness: 420, damping: 22 },
            opacity: { duration: 0.18 },
            left: { duration: 0 },
          }}
        />
      );
    }

    // 2. Main Lines & Gap Sub-Ticks
    for (let slot = 0; slot < itemCount; slot++) {
      const isSlotActive = slot === activeIdx;
      const mainH = getWaveH(slot + 0.5, isSlotActive ? 8.5 : 7.5);
      const isDot = isSlotActive && !isSliding;

      // SINGLE UNIFIED ELEMENT: Anchored at exact bottom baseline (bottom: 6px / 4px)!
      // Shared bottom baseline across all main lines & sub-ticks — zero hanging lines!
      if (isDot || isSliding) {
        const targetScaleX = isDot ? 1 : (isSlotActive ? 0.4 : 0.27);

        ticks.push(
          <motion.div
            key={`main-indicator-${slot}`}
            className={cn(
              styles.scaleMainIndicator,
              isSlotActive && styles.scaleMainIndicatorActive
            )}
            initial={false}
            style={{ left: `calc(${paddingVar} + ${slot + 0.5} * ${slotWVar} - 2.75px)` }}
            animate={{
              y: isSliding ? 0 : (isDot ? 0 : startY),
              scaleX: targetScaleX,
              height: isDot ? 5.5 : mainH,
              borderRadius: isDot ? 9999 : 1,
              opacity: isDot ? 1 : 1,
            }}
            transition={{
              y: { type: 'spring', stiffness: 420, damping: 22 },
              scaleX: { type: 'spring', stiffness: 500, damping: 32 },
              height: { type: 'spring', stiffness: 500, damping: 32 },
              borderRadius: { type: 'spring', stiffness: 500, damping: 32 },
              opacity: { duration: 0.18 },
              left: { duration: 0 }, // Lock horizontal position instantly without spring shift
            }}
          />
        );
      }

      // SUB-TICKS in gap to next slot center
      if (slot < itemCount - 1) {
        for (let k = 1; k <= subTicksPerGap; k++) {
          const ratio = slot + 0.5 + k / (subTicksPerGap + 1);
          const subH  = getWaveH(ratio, (k % 2 === 0) ? 4.5 : 3);

          ticks.push(
            <motion.div
              key={`gap-${slot}-${k}`}
              className={styles.scaleSubTick}
              initial={false}
              style={{ left: `calc(${paddingVar} + ${ratio} * ${slotWVar} - 0.5px)`, height: `${subH}px` }}
              animate={{
                y: isSliding ? 0 : startY,
                opacity: isSliding ? 1 : 0,
              }}
              transition={{
                y: { type: 'spring', stiffness: 420, damping: 22 },
                opacity: { duration: 0.18 },
                left: { duration: 0 },
              }}
            />
          );
        }
      }
    }

    // 3. Edge sub-ticks after last slot center
    for (let e = 1; e <= 2; e++) {
      const ratio = itemCount - 0.5 + (e / 3) * 0.5;
      const h     = getWaveH(ratio, 3);
      ticks.push(
        <motion.div
          key={`edge-end-${e}`}
          className={styles.scaleSubTick}
          initial={false}
          style={{ left: `calc(${paddingVar} + ${itemCount - 0.5} * ${slotWVar} + ${e / 3} * (${paddingVar} + 0.5 * ${slotWVar}) - 0.5px)`, height: `${h}px` }}
          animate={{
            y: isSliding ? 0 : startY,
            opacity: isSliding ? 1 : 0,
          }}
          transition={{
            y: { type: 'spring', stiffness: 420, damping: 22 },
            opacity: { duration: 0.18 },
            left: { duration: 0 },
          }}
        />
      );
    }

    return (
      <div className={styles.rulerTicksOverlay}>
        {/* Horizontal Spine Line — Spring jiggle rise from bottom of panel */}
        <motion.div
          className={styles.scaleSpine}
          aria-hidden="true"
          animate={{
            y: isSliding ? 0 : startY,
            opacity: isSliding ? 1 : 0,
          }}
          transition={{
            y: { type: 'spring', stiffness: 420, damping: 22 },
            opacity: { duration: 0.18 },
          }}
        />

        {ticks}
      </div>
    );
  };

  const activeTab = searchParams.get('tab') ?? 'appearance';

  // Active label string
  const activeMain = navItems.find((n) => n.href === '/' ? pathname === '/' : pathname.startsWith(n.href));
  const activeSub  = SETTINGS_SUBNAV.find((s) => s.tab === activeTab);
  const currentBadgeLabel = hoverLabel ?? (
    pathname.startsWith('/settings')
      ? `Settings ▸ ${activeSub?.label ?? 'Appearance'}`
      : (activeMain?.label ?? 'Home')
  );

  const activeMainIdx = navItems.findIndex((n) => n.href === '/' ? pathname === '/' : pathname.startsWith(n.href));
  const activeSubIdx  = SETTINGS_SUBNAV.findIndex((s) => s.tab === activeTab);

  const isMainSliding = pointerX !== null;
  const isSubSliding  = subPointerX !== null;

  // ── Hide dock during active test sessions or on auth pages (mobile only) ─
  if (pathname === '/auth' || pathname.startsWith('/auth')) {
    return null;
  }

  const activeSession = useQuestionStore((s) => s.activeSession);
  const isStudyPage   = pathname === '/study';
  const hasTestParams = searchParams.has('deck') || searchParams.has('mode');
  const isTestActive  = isStudyPage && hasTestParams && !!(activeSession && !activeSession.finished_at);

  return (
    <div
      className={styles.mobileDockContainer}
      role="navigation"
      aria-label="Mobile navigation"
      style={{ pointerEvents: isTestActive ? 'none' : 'auto' }}
    >
      <motion.div
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        initial={false}
        animate={isTestActive
          ? { y: 140, opacity: 0 }
          : { y: 0,   opacity: 1 }
        }
        transition={isTestActive
          ? { type: 'spring', stiffness: 260, damping: 28, delay: 0.5 }
          : { y:       { type: 'spring', stiffness: 450, damping: 18, mass: 0.8 },
              opacity: { duration: 0.2 },
            }
        }
      >

      {/* Floating Label Badge */}
      {showBadge && (
        <div
          className={styles.dockLabelBadge}
          style={{ opacity: showBadge ? 1 : 0, transform: showBadge ? 'translateY(0)' : 'translateY(4px)' }}
        >
          {currentBadgeLabel}
        </div>
      )}

      {/* Sub-Ruler (Settings Sub-Nav) */}
      <AnimatePresence>
        {showSubRuler && (
          <motion.div
            key="sub-ruler-wrap"
            className={styles.subRulerWrap}
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{ opacity: 0, y: 10,  scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          >
            <div
              ref={subRulerRef}
              className={styles.subRuler}
              onPointerDown={onSubDown}
              onPointerMove={onSubMove}
              onPointerUp={onSubUp}
              onPointerLeave={() => {
                isSubDragRef.current = false;
                setSubPointerX(null);
                setHoverLabel(null);
                subLastIdxRef.current = null;
                scheduleBadgeHide();
              }}
            >
              {/* Single Unified Ruler Overlay */}
              {renderUnifiedRuler(subPointerX, subRulerRef, isSubSliding, activeSubIdx, SETTINGS_SUBNAV.length, true)}

              {SETTINGS_SUBNAV.map((sub, idx) => {
                const isSubActive = pathname.startsWith('/settings') && activeTab === sub.tab;
                const Icon        = sub.icon;
                const { liftY, opacity, scale } = getLift(subPointerX, subRulerRef, idx, SETTINGS_SUBNAV.length, isSubActive);

                const iconSize = Icon === GraduationCap ? 22 : 20;

                return (
                  <div key={sub.tab} className={styles.subRulerSlot}>
                    {/* Uniform Icon Container */}
                    <motion.div
                      className={cn(styles.mobileDockItem, isSubActive && styles.mobileDockItemActive)}
                      initial={false}
                      animate={{ y: -liftY, opacity, scale }}
                      transition={{ type: 'spring', stiffness: 480, damping: 28 }}
                    >
                      <Icon size={iconSize} strokeWidth={2} style={{ width: iconSize, height: iconSize }} />
                    </motion.div>
                  </div>
                );
              })}
            </div>

            {/* Connector Line down to Settings slot */}
            <div className={styles.subRulerConnector} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Outside Tap Overlay to Close Sub-Ruler */}
      {showSubRuler && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 998 }}
          onClick={(e) => {
            e.stopPropagation();
            setTimeout(() => setShowSubRuler(false), 0);
          }}
        />
      )}

      {/* Main Scale Ruler Dock */}
      <div
        ref={dockRef}
        className={styles.mobileDock}
        onPointerDown={onDockDown}
        onPointerMove={onDockMove}
        onPointerUp={onDockUp}
        onPointerLeave={onDockLeave}
        style={{ position: 'relative', zIndex: 999 }}
      >
        {/* Single Unified Ruler Overlay */}
        {renderUnifiedRuler(pointerX, dockRef, isMainSliding, activeMainIdx, navItems.length, false)}

        {navItems.map((item, index) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon   = item.icon;
          const { liftY, opacity, scale } = getLift(pointerX, dockRef, index, navItems.length, active);

          const iconSize = Icon === GraduationCap ? 22 : 20;

          return (
            <div key={item.href} className={cn(styles.mobileDockSlot, active && styles.mobileDockSlotActive)}>
              {/* Uniform Icon Container */}
              <motion.div
                className={cn(styles.mobileDockItem, active && styles.mobileDockItemActive)}
                initial={false}
                animate={{ y: -liftY, opacity, scale }}
                transition={{ type: 'spring', stiffness: 480, damping: 28 }}
              >
                <Icon size={iconSize} strokeWidth={2} style={{ width: iconSize, height: iconSize }} />
              </motion.div>
            </div>
          );
        })}
      </div>
    </motion.div>
    </div>
  );
}

// =============================================================================
// Main Export
// =============================================================================

interface SidebarProps {
  onOpenCommandPalette: () => void;
}

export default function Sidebar({ onOpenCommandPalette }: SidebarProps) {
  useEffect(() => {
    // unlockSync() MUST be called synchronously inside a native gesture event.
    // iOS Safari requires AudioContext.resume() to be called in the same
    // synchronous call stack as the touchstart/pointerdown event.
    const unlockHandler = () => sounds.unlockSync();

    window.addEventListener('pointerdown', unlockHandler, { capture: true, passive: true });
    window.addEventListener('touchstart',  unlockHandler, { capture: true, passive: true });
    window.addEventListener('click',       unlockHandler, { capture: true, passive: true });
    window.addEventListener('keydown',     unlockHandler, { capture: true, passive: true });

    return () => {
      window.removeEventListener('pointerdown', unlockHandler, { capture: true });
      window.removeEventListener('touchstart',  unlockHandler, { capture: true });
      window.removeEventListener('click',       unlockHandler, { capture: true });
      window.removeEventListener('keydown',     unlockHandler, { capture: true });
    };
  }, []);

  return (
    <React.Suspense fallback={null}>
      <DesktopSidebar onOpenCommandPalette={onOpenCommandPalette} />
      <MobileDock />
    </React.Suspense>
  );
}