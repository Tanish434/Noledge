/**
 * @file hooks/useTheme.ts
 * @description Theme management hook for Noledge's dual dark/light theme system.
 *
 * The theme system works at two levels:
 *   1. CSS Custom Properties (globals.css): all visual tokens are defined
 *      per theme using [data-theme="dark"] and [data-theme="light"] selectors.
 *   2. JavaScript (this hook): reads/writes the user's preference to
 *      localStorage and applies the data-theme attribute to <html>.
 *
 * The initial theme is set by an inline blocking script in layout.tsx BEFORE
 * React hydrates. This prevents the flash of wrong theme (FOWT). This hook
 * handles all subsequent theme changes (user interaction).
 *
 * Theme preference options:
 *   'dark'   — Always use dark theme regardless of system preference
 *   'light'  — Always use light theme regardless of system preference
 *   'system' — Follow the OS/browser color scheme preference
 *              (prefers-color-scheme media query)
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { STORAGE_KEYS } from '@/lib/constants';

// =============================================================================
// Types
// =============================================================================

/**
 * ThemePreference — the three possible user preference settings.
 *
 * Note: the RESOLVED theme (what's actually applied) is always 'dark' or
 * 'light' — never 'system'. 'system' is a preference that RESOLVES to one
 * of the two based on the OS setting.
 */
export type ThemePreference = 'dark' | 'light' | 'system';

/**
 * ResolvedTheme — the theme currently applied to the UI.
 */
export type ResolvedTheme = 'dark' | 'light';

/**
 * UseThemeReturn — the object returned by useTheme().
 *
 * Fields:
 *   preference    — The stored user preference ('dark', 'light', 'system')
 *   resolvedTheme — The actually-applied theme
 *   setTheme      — Set a new theme preference
 *   toggleTheme   — Toggle between dark and light (sets explicit preference,
 *                   not 'system', for predictable toggle behavior)
 */
export interface UseThemeReturn {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (preference: ThemePreference) => void;
  toggleTheme: () => void;
}

// =============================================================================
// Utility: Resolve Theme
// =============================================================================

/**
 * resolveTheme — determine the actual applied theme from a preference.
 *
 * For 'dark' and 'light', this is trivial. For 'system', we read the
 * prefers-color-scheme media query.
 *
 * @param preference The stored preference
 * @returns The resolved 'dark' | 'light' value
 */
function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') {
    if (typeof window === 'undefined') return 'dark'; // SSR default
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return preference;
}

/**
 * applyTheme — set data-theme on the <html> element.
 *
 * This is the single function that actually applies the theme to the DOM.
 * All other logic feeds into this function.
 *
 * @param resolved The resolved 'dark' or 'light' value
 */
function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', resolved);
}

// =============================================================================
// Hook
// =============================================================================

/**
 * useTheme — read and write the application theme.
 *
 * Reads the initial preference from localStorage (set by the blocking script
 * in layout.tsx). Listens for OS theme changes when preference is 'system'.
 * Updates localStorage and the data-theme attribute on theme changes.
 *
 * @returns UseThemeReturn
 */
export function useTheme(): UseThemeReturn {
  // Read the initial preference from localStorage.
  // We initialize lazily (via a function) to avoid reading localStorage on
  // every render — it's a synchronous DOM API and should be called sparingly.
  const [preference, setPreference] = useState<ThemePreference>(() => {
    if (typeof window === 'undefined') return 'dark'; // SSR default
    const stored = localStorage.getItem(STORAGE_KEYS.THEME);
    return (stored as ThemePreference) ?? 'system';
  });

  // The resolved theme is derived from the preference.
  // Re-derives on preference change.
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(
    () => resolveTheme(preference)
  );

  /**
   * setTheme — change the user's theme preference.
   *
   * Stores the preference in localStorage, resolves the actual theme,
   * applies it to the DOM, and updates state.
   */
  const setTheme = useCallback((newPreference: ThemePreference): void => {
    setPreference(newPreference);
    localStorage.setItem(STORAGE_KEYS.THEME, newPreference);
    const resolved = resolveTheme(newPreference);
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, []);

  // On mount, sync preference and resolvedTheme with actual localStorage and DOM data-theme attribute
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.THEME) as ThemePreference | null;
    if (stored) {
      setPreference(stored);
    }
    const domTheme = document.documentElement.getAttribute('data-theme') as ResolvedTheme | null;
    if (domTheme) {
      setResolvedTheme(domTheme);
    } else {
      const resolved = resolveTheme(stored ?? 'system');
      setResolvedTheme(resolved);
      applyTheme(resolved);
    }
  }, []);

  /**
   * toggleTheme — flip between dark and light.
   *
   * Always toggles between explicit 'dark' and 'light' (not 'system').
   * Reads from DOM data-theme attribute if available to ensure absolute accuracy.
   */
  const toggleTheme = useCallback((): void => {
    const domTheme = typeof document !== 'undefined' ? (document.documentElement.getAttribute('data-theme') as ResolvedTheme | null) : null;
    const current = domTheme ?? resolvedTheme;
    const next: ResolvedTheme = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }, [resolvedTheme, setTheme]);

  // Listen for OS theme changes when preference is 'system'.
  // This makes the app react to the user switching their OS dark mode
  // setting without needing to reload the page.
  useEffect(() => {
    if (preference !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (): void => {
      const resolved = resolveTheme('system');
      setResolvedTheme(resolved);
      applyTheme(resolved);
    };

    // Use addEventListener for modern browsers; addListener as fallback
    // for older Safari that didn't support addEventListener on MediaQueryList.
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      // Legacy fallback (Safari < 14)
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [preference]);

  return {
    preference,
    resolvedTheme,
    setTheme,
    toggleTheme,
  };
}
