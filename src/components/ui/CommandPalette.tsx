/**
 * @file components/ui/CommandPalette.tsx
 * @description Master command menu search overlay containing every action, route, toggle, and preference in Noledge.
 */

'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import Fuse from 'fuse.js';
import {
  Search,
  Home,
  BookOpen,
  Layers,
  Plus,
  Settings,
  Sun,
  Moon,
  Laptop,
  X,
  Sparkles,
  Zap,
  Volume2,
  VolumeX,
  Type,
  Eye,
  Sliders,
  RefreshCw,
  SlidersHorizontal,
  Info,
  Code,
  CheckSquare,
  HelpCircle,
  FileText,
  ListChecks,
  type LucideIcon,
} from 'lucide-react';
import { useDeckStore } from '@/stores/deckStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/utils/cn';
import styles from './CommandPalette.module.css';

// =============================================================================
// Types
// =============================================================================

export interface CommandMenuItem {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: string;
  action: () => void;
  keywords?: string;
  shortcut?: string;
}

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

// =============================================================================
// Component
// =============================================================================

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const { decks } = useDeckStore();
  const { preference, setTheme } = useTheme();

  const {
    high_contrast,
    compact_mode,
    card_glow,
    reduce_motion,
    sound_enabled,
    auto_sync,
    font_family,
    font_size,
    updateSetting,
  } = useSettingsStore();

  // ─── Build comprehensive master command list ───────────────────────
  const commands: CommandMenuItem[] = useMemo(() => {
    const navCommands: CommandMenuItem[] = [
      {
        id: 'nav-home',
        label: 'Home Dashboard',
        hint: 'Overview & Activity',
        icon: Home,
        group: 'Navigation',
        action: () => {
          router.push('/');
          onClose();
        },
        keywords: 'dashboard home main index activity graph overview',
        shortcut: '⌘D',
      },
      {
        id: 'nav-study',
        label: 'Study Flashcards',
        hint: 'Spaced Repetition Session',
        icon: BookOpen,
        group: 'Navigation',
        action: () => {
          router.push('/study');
          onClose();
        },
        keywords: 'study learn review flashcards practice srs active recall',
        shortcut: '⌘S',
      },
      {
        id: 'nav-manage',
        label: 'Manage Decks & Cards',
        hint: 'Question Library',
        icon: Layers,
        group: 'Navigation',
        action: () => {
          router.push('/manage');
          onClose();
        },
        keywords: 'library decks manage questions organize edit delete search',
        shortcut: '⌘M',
      },
      {
        id: 'nav-create',
        label: 'Create New Question',
        hint: 'Question Creator Wizard',
        icon: Plus,
        group: 'Navigation',
        action: () => {
          router.push('/create');
          onClose();
        },
        keywords: 'create new card question add prompt wizard',
        shortcut: '⌘N',
      },
      {
        id: 'nav-settings',
        label: 'Settings & Preferences',
        hint: 'System Configuration',
        icon: Settings,
        group: 'Navigation',
        action: () => {
          router.push('/settings');
          onClose();
        },
        keywords: 'settings preferences theme config profile options',
        shortcut: '⌘,',
      },
      {
        id: 'nav-settings-appearance',
        label: 'Appearance Settings',
        hint: 'Fonts, Compact & Glow',
        icon: Eye,
        group: 'Navigation',
        action: () => {
          router.push('/settings?tab=appearance');
          onClose();
        },
        keywords: 'appearance theme font size compact glow style',
      },
      {
        id: 'nav-settings-study',
        label: 'Study & Session Options',
        hint: 'Limits & Audio Effects',
        icon: Sliders,
        group: 'Navigation',
        action: () => {
          router.push('/settings?tab=study');
          onClose();
        },
        keywords: 'study options limits audio sound session timer auto advance',
      },
      {
        id: 'nav-settings-sync',
        label: 'Vault & GitHub Sync Options',
        hint: 'Obsidian & Repository Sync',
        icon: RefreshCw,
        group: 'Navigation',
        action: () => {
          router.push('/settings?tab=sync');
          onClose();
        },
        keywords: 'sync obsidian github vault background interval reconnect',
      },
      {
        id: 'nav-settings-accessibility',
        label: 'Accessibility Options',
        hint: 'Contrast & Motion Reduction',
        icon: Zap,
        group: 'Navigation',
        action: () => {
          router.push('/settings?tab=accessibility');
          onClose();
        },
        keywords: 'accessibility high contrast reduce motion large text',
      },
      {
        id: 'nav-settings-advanced',
        label: 'Developer & Advanced Options',
        hint: 'Timing & Advanced Controls',
        icon: SlidersHorizontal,
        group: 'Navigation',
        action: () => {
          router.push('/settings?tab=advanced');
          onClose();
        },
        keywords: 'developer advanced options delay collapse sidebar',
      },
      {
        id: 'nav-settings-about',
        label: 'About Noledge',
        hint: 'Version & System Info',
        icon: Info,
        group: 'Navigation',
        action: () => {
          router.push('/settings?tab=about');
          onClose();
        },
        keywords: 'about version build info storage indexeddb supabase',
      },
    ];

    const createCommands: CommandMenuItem[] = [
      {
        id: 'create-mcq',
        label: 'Create Multiple Choice Question',
        hint: 'Single Choice Option',
        icon: ListChecks,
        group: 'Create Format',
        action: () => {
          router.push('/create?type=mcq');
          onClose();
        },
        keywords: 'create mcq multiple choice option question',
      },
      {
        id: 'create-typing',
        label: 'Create Type Answer Question',
        hint: 'Free Text Input',
        icon: FileText,
        group: 'Create Format',
        action: () => {
          router.push('/create?type=typing');
          onClose();
        },
        keywords: 'create typing text answer response fill',
      },
      {
        id: 'create-tf',
        label: 'Create True / False Question',
        hint: 'Binary Evaluation',
        icon: HelpCircle,
        group: 'Create Format',
        action: () => {
          router.push('/create?type=tf');
          onClose();
        },
        keywords: 'create true false tf boolean binary',
      },
      {
        id: 'create-code',
        label: 'Create Code Snippet Question',
        hint: 'Programming Challenge',
        icon: Code,
        group: 'Create Format',
        action: () => {
          router.push('/create?type=code');
          onClose();
        },
        keywords: 'create code snippet python javascript typescript function syntax',
      },
      {
        id: 'create-multi',
        label: 'Create Multi-Select Question',
        hint: 'Multiple Correct Answers',
        icon: CheckSquare,
        group: 'Create Format',
        action: () => {
          router.push('/create?type=multi');
          onClose();
        },
        keywords: 'create multi select checkboxes multiple correct',
      },
    ];

    const quickToggleCommands: CommandMenuItem[] = [
      {
        id: 'toggle-high-contrast',
        label: 'Toggle High Contrast Mode',
        hint: high_contrast ? 'Active (ON)' : 'Inactive (OFF)',
        icon: Eye,
        group: 'Quick Toggles',
        action: () => {
          updateSetting('high_contrast', !high_contrast);
        },
        keywords: 'toggle high contrast borders text accessibility sharpness',
      },
      {
        id: 'toggle-compact-mode',
        label: 'Toggle Compact Cards Mode',
        hint: compact_mode ? 'Active (ON)' : 'Inactive (OFF)',
        icon: Layers,
        group: 'Quick Toggles',
        action: () => {
          updateSetting('compact_mode', !compact_mode);
        },
        keywords: 'toggle compact mode padding density cards list spacing',
      },
      {
        id: 'toggle-card-glow',
        label: 'Toggle Card Glow Effect',
        hint: card_glow ? 'Active (ON)' : 'Inactive (OFF)',
        icon: Sparkles,
        group: 'Quick Toggles',
        action: () => {
          updateSetting('card_glow', !card_glow);
        },
        keywords: 'toggle card glow neon outline border effect',
      },
      {
        id: 'toggle-reduce-motion',
        label: 'Toggle Reduce Motion',
        hint: reduce_motion ? 'Active (ON)' : 'Inactive (OFF)',
        icon: Zap,
        group: 'Quick Toggles',
        action: () => {
          updateSetting('reduce_motion', !reduce_motion);
        },
        keywords: 'toggle reduce motion animations transitions gsap disable',
      },
      {
        id: 'toggle-sound-effects',
        label: 'Toggle Sound Effects',
        hint: sound_enabled ? 'Active (ON)' : 'Muted (OFF)',
        icon: sound_enabled ? Volume2 : VolumeX,
        group: 'Quick Toggles',
        action: () => {
          updateSetting('sound_enabled', !sound_enabled);
        },
        keywords: 'toggle sound audio effects tones feedback mute',
      },
      {
        id: 'toggle-auto-sync',
        label: 'Toggle Auto-Sync',
        hint: auto_sync ? 'Active (ON)' : 'Inactive (OFF)',
        icon: RefreshCw,
        group: 'Quick Toggles',
        action: () => {
          updateSetting('auto_sync', !auto_sync);
        },
        keywords: 'toggle auto sync background sync obsidian vault github',
      },
    ];

    const fontCommands: CommandMenuItem[] = [
      {
        id: 'font-sans',
        label: 'Set Font: System Sans (Modern)',
        hint: font_family === 'sans' ? 'Active' : undefined,
        icon: Type,
        group: 'Typography',
        action: () => {
          updateSetting('font_family', 'sans');
        },
        keywords: 'font system sans modern inter roboto default',
      },
      {
        id: 'font-mono',
        label: 'Set Font: Geist Mono (Code / Tech)',
        hint: font_family === 'mono' ? 'Active' : undefined,
        icon: Type,
        group: 'Typography',
        action: () => {
          updateSetting('font_family', 'mono');
        },
        keywords: 'font geist mono code technical monospace',
      },
      {
        id: 'font-serif',
        label: 'Set Font: Academic Serif (Editorial)',
        hint: font_family === 'serif' ? 'Active' : undefined,
        icon: Type,
        group: 'Typography',
        action: () => {
          updateSetting('font_family', 'serif');
        },
        keywords: 'font academic serif editorial book times georgia',
      },
      {
        id: 'font-rounded',
        label: 'Set Font: Soft Rounded (Friendly)',
        hint: font_family === 'rounded' ? 'Active' : undefined,
        icon: Type,
        group: 'Typography',
        action: () => {
          updateSetting('font_family', 'rounded');
        },
        keywords: 'font soft rounded friendly visual text',
      },
      {
        id: 'font-dyslexic',
        label: 'Set Font: OpenDyslexic (Accessible)',
        hint: font_family === 'dyslexic' ? 'Active' : undefined,
        icon: Type,
        group: 'Typography',
        action: () => {
          updateSetting('font_family', 'dyslexic');
        },
        keywords: 'font opendyslexic accessible legibility dyslexia',
      },
      {
        id: 'size-small',
        label: 'Set Text Size: Small (14px base)',
        hint: font_size === 'sm' ? 'Active' : undefined,
        icon: Type,
        group: 'Typography',
        action: () => {
          updateSetting('font_size', 'sm');
        },
        keywords: 'size small text 14px compact font scale',
      },
      {
        id: 'size-medium',
        label: 'Set Text Size: Medium (16px default)',
        hint: font_size === 'md' ? 'Active' : undefined,
        icon: Type,
        group: 'Typography',
        action: () => {
          updateSetting('font_size', 'md');
        },
        keywords: 'size medium text 16px default font scale',
      },
      {
        id: 'size-large',
        label: 'Set Text Size: Large (18px high-contrast)',
        hint: font_size === 'lg' ? 'Active' : undefined,
        icon: Type,
        group: 'Typography',
        action: () => {
          updateSetting('font_size', 'lg');
        },
        keywords: 'size large text 18px big accessible font scale',
      },
    ];

    const themeCommands: CommandMenuItem[] = [
      {
        id: 'theme-dark',
        label: 'Switch to Dark Theme',
        hint: preference === 'dark' ? 'Active' : undefined,
        icon: Moon,
        group: 'Theme',
        action: () => {
          setTheme('dark');
        },
        keywords: 'theme dark night mode background emerald black',
      },
      {
        id: 'theme-light',
        label: 'Switch to Light Theme',
        hint: preference === 'light' ? 'Active' : undefined,
        icon: Sun,
        group: 'Theme',
        action: () => {
          setTheme('light');
        },
        keywords: 'theme light day mode background white slate',
      },
      {
        id: 'theme-system',
        label: 'Switch to System Auto Theme',
        hint: preference === 'system' ? 'Active' : undefined,
        icon: Laptop,
        group: 'Theme',
        action: () => {
          setTheme('system');
        },
        keywords: 'theme system auto mode follow os browser',
      },
    ];

    const deckCommands: CommandMenuItem[] = Object.values(decks).map((deck) => ({
      id: `deck-${deck.id}`,
      label: `Study Deck: ${deck.name}`,
      hint: `${deck.question_count} cards`,
      icon: BookOpen,
      group: 'Decks Library',
      action: () => {
        router.push(`/study?deck=${deck.id}`);
        onClose();
      },
      keywords: `study deck ${deck.name} ${deck.description ?? ''} flashcards`,
    }));

    return [
      ...navCommands,
      ...createCommands,
      ...quickToggleCommands,
      ...fontCommands,
      ...themeCommands,
      ...deckCommands,
    ];
  }, [
    router,
    onClose,
    decks,
    preference,
    setTheme,
    high_contrast,
    compact_mode,
    card_glow,
    reduce_motion,
    sound_enabled,
    auto_sync,
    font_family,
    font_size,
    updateSetting,
  ]);

  // ─── Fuse.js fuzzy search engine ───────────────────────────────────
  const fuse = useMemo(() => {
    return new Fuse(commands, {
      keys: ['label', 'keywords', 'hint', 'group'],
      threshold: 0.35,
      ignoreLocation: true,
      minMatchCharLength: 1,
    });
  }, [commands]);

  // ─── Filtered results ────────────────────────────────────────────────
  const results = useMemo(() => {
    if (!query.trim()) return commands;
    return fuse.search(query).map((r) => r.item);
  }, [query, fuse, commands]);

  // ─── Group results ───────────────────────────────────────────────────
  const grouped = useMemo(() => {
    const groups: Record<string, CommandMenuItem[]> = {};
    results.forEach((item) => {
      if (!groups[item.group]) groups[item.group] = [];
      groups[item.group].push(item);
    });
    return Object.entries(groups);
  }, [results]);

  const flatResults = useMemo(() => results, [results]);

  // ─── Reset state on open & focus input ──────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      const timer = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // ─── Keyboard navigation ─────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, flatResults.length - 1));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const item = flatResults[activeIndex];
        if (item) item.action();
      }
    },
    [isOpen, flatResults, activeIndex, onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!isOpen) return null;

  let globalIndex = 0;

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <motion.div
        className={styles.palette}
        initial={{ opacity: 0, scale: 0.95, y: -12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -12 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Master Command Palette"
      >
        {/* ── Search Bar ────────────────────────────────────────────── */}
        <div className={styles.searchContainer}>
          <Search size={18} strokeWidth={2} className={styles.searchIcon} />
          <input
            ref={inputRef}
            type="text"
            className={styles.searchInput}
            placeholder="Search pages, decks, actions, settings, theme..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            aria-label="Search command menu"
          />
          {query && (
            <button className={styles.clearBtn} onClick={() => setQuery('')} aria-label="Clear search query">
              <X size={14} />
            </button>
          )}
          <kbd className={styles.searchKbd}>ESC</kbd>
        </div>

        {/* ── Results List ──────────────────────────────────────────── */}
        <div className={styles.results} role="listbox">
          {flatResults.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}>
                <Search size={28} strokeWidth={1.5} />
              </div>
              <p>No matching commands found for &ldquo;{query}&rdquo;</p>
            </div>
          ) : (
            grouped.map(([groupName, items]) => (
              <div key={groupName} className={styles.resultGroup}>
                <div className={styles.resultGroupLabel}>{groupName}</div>
                {items.map((item) => {
                  const currentIndex = globalIndex;
                  const isActive = currentIndex === activeIndex;
                  globalIndex += 1;
                  const ItemIcon = item.icon;

                  return (
                    <div
                      key={item.id}
                      className={cn(styles.resultItem, isActive && styles.resultItemActive)}
                      onClick={item.action}
                      onMouseEnter={() => setActiveIndex(currentIndex)}
                      role="option"
                      aria-selected={isActive}
                    >
                      <div className={styles.resultItemIcon}>
                        <ItemIcon size={18} strokeWidth={1.75} />
                      </div>
                      <span className={styles.resultItemLabel}>{item.label}</span>
                      {item.hint && <span className={styles.resultItemHint}>{item.hint}</span>}
                      {item.shortcut && (
                        <div className={styles.resultItemKbd}>
                          <kbd>{item.shortcut}</kbd>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* ── Footer Hints ──────────────────────────────────────────── */}
        <div className={styles.footer}>
          <div className={styles.footerHints}>
            <div className={styles.footerHint}>
              <kbd>&uarr;</kbd>
              <kbd>&darr;</kbd>
              <span>navigate</span>
            </div>
            <div className={styles.footerHint}>
              <kbd>&crarr;</kbd>
              <span>select</span>
            </div>
          </div>
          <div>Noledge Master Command Center</div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}