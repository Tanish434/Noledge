/**
 * @file hooks/useGSAP.ts
 * @description React hook for safe GSAP animation lifecycle management.
 *
 * GSAP animations in React require careful lifecycle handling because:
 *   1. React StrictMode mounts components twice in development. If we create
 *      GSAP timelines in useEffect without cleanup, they leak and cause
 *      duplicate animations.
 *   2. GSAP ScrollTrigger instances persist after component unmount if not
 *      explicitly killed — causing "can't call setState on unmounted component"
 *      style bugs and memory leaks.
 *   3. GSAP 3's context() API solves both problems: gsap.context() captures
 *      all animations and ScrollTriggers created within its callback, and
 *      ctx.revert() kills them all at once in the cleanup function.
 *
 * This hook wraps gsap.context() with React's useLayoutEffect (not useEffect)
 * because GSAP animations should run synchronously before paint to avoid
 * a frame of the pre-animation state showing. useEffect runs after paint.
 *
 * Design decision: We also expose the GSAP context object so callers can
 * use ctx.add() to add animations imperatively (e.g., in event handlers
 * that fire after the initial mount). This is safer than using gsap directly
 * because ctx.add()-registered animations are also cleaned up by ctx.revert().
 *
 * Usage:
 *   const containerRef = useRef<HTMLDivElement>(null);
 *   useGSAP((ctx) => {
 *     gsap.from('.card', { opacity: 0, y: 30, stagger: 0.1 });
 *   }, containerRef, [dependencies]);
 */

'use client';

import { useRef, useLayoutEffect, useCallback } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Draggable } from 'gsap/Draggable';
import { Flip } from 'gsap/Flip';

// =============================================================================
// GSAP Plugin Registration
// =============================================================================

/**
 * Register GSAP plugins once at module load time.
 *
 * GSAP plugins must be registered before any animation uses them. We do
 * this at module scope (not inside a hook or component) so:
 *   1. Registration happens exactly once, regardless of how many components
 *      import useGSAP.
 *   2. It runs synchronously before any component mounts, guaranteeing
 *      plugins are available on first render.
 *
 * The `typeof window !== 'undefined'` guard is required because Next.js
 * renders this module on the server during SSR/SSG. GSAP plugins that
 * touch the DOM (ScrollTrigger, Draggable) must not be imported on the
 * server. The guard defers plugin registration to the client.
 */
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, Draggable, Flip);
}

// =============================================================================
// Types
// =============================================================================

/**
 * GSAPContext — the GSAP context object returned by gsap.context().
 *
 * We define this type manually rather than importing from GSAP's types
 * because the exact shape varies across GSAP versions. We only use
 * two methods: add() and revert().
 *
 * Fields:
 *   add     — Register an animation or function within this context.
 *             Animations added via ctx.add() are killed by ctx.revert().
 *   revert  — Kill all animations and ScrollTriggers in this context and
 *             restore all elements to their pre-animation state.
 */
export interface GSAPContext {
  add: (fn: () => void) => void;
  revert: () => void;
}

/**
 * GSAPSetupCallback — the function passed to useGSAP.
 *
 * Called once on mount (and after hot-module replacement in development).
 * Receives the GSAP context so callers can register additional animations
 * after mount without leaking them.
 *
 * Note: This callback runs inside useLayoutEffect. Do NOT set React state
 * inside it — use GSAP's own state management (gsap.set, MotionValues).
 */
export type GSAPSetupCallback = (ctx: GSAPContext) => void;

// =============================================================================
// Hook
// =============================================================================

/**
 * useGSAP — lifecycle-safe GSAP animation hook for React components.
 *
 * @param setup       Function that creates GSAP animations. Runs on mount.
 * @param containerRef Optional ref to scope all animations to a DOM subtree.
 *                     When provided, GSAP uses this element as the root for
 *                     selector-based queries (e.g. '.card' only matches
 *                     elements inside this container, not the whole document).
 *                     Required for ScrollTrigger to work correctly.
 * @param dependencies Array of React dependencies (like useEffect's second arg).
 *                     When any dependency changes, the previous animations are
 *                     cleaned up (ctx.revert()) and setup() is called again.
 *
 * @returns           Object with the addAnimation function for imperative use.
 *
 * @example
 *   const ref = useRef<HTMLDivElement>(null);
 *   const { addAnimation } = useGSAP((ctx) => {
 *     gsap.from('.card', {
 *       opacity: 0,
 *       y: 40,
 *       stagger: 0.08,
 *       ease: 'power3.out',
 *     });
 *   }, ref, [cards.length]); // Re-run if number of cards changes
 */
export function useGSAP(
  setup: GSAPSetupCallback,
  containerRef?: React.RefObject<HTMLElement | null>,
  dependencies: React.DependencyList = []
): { addAnimation: (fn: () => void) => void } {
  // Store the GSAP context so we can expose addAnimation to callers.
  const contextRef = useRef<ReturnType<typeof gsap.context> | null>(null);

  // Stable callback reference — prevents unnecessary re-runs when the
  // setup function is recreated on every render (which it will be, since
  // it's typically an inline arrow function). We use a ref to hold the
  // latest version of setup and call it from a stable wrapper.
  const setupRef = useRef<GSAPSetupCallback>(setup);
  setupRef.current = setup;

  useLayoutEffect(() => {
    // Create a new GSAP context. The second argument scopes selector queries
    // to the container element (if provided). Without scoping, '.card' would
    // match ANY element with class 'card' on the page — a common source of
    // animation bugs in apps with multiple animated components.
    const ctx = gsap.context((self) => {
      setupRef.current(self as GSAPContext);
    }, containerRef?.current ?? undefined);

    contextRef.current = ctx;

    // Cleanup — called when: component unmounts, dependencies change,
    // React StrictMode double-mounts.
    return () => {
      ctx.revert();
      contextRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  /**
   * addAnimation — imperatively add an animation to the current context.
   *
   * Use this in event handlers to ensure animations created after the
   * initial mount are also properly cleaned up on unmount.
   *
   * @example
   *   const handleSwipe = () => {
   *     addAnimation(() => {
   *       gsap.to('.card', { x: 500, opacity: 0, duration: 0.3 });
   *     });
   *   };
   */
  const addAnimation = useCallback((fn: () => void): void => {
    if (contextRef.current) {
      contextRef.current.add(fn);
    } else {
      // Context doesn't exist yet (called before mount) — run directly.
      // This shouldn't happen in normal usage but handles edge cases.
      fn();
    }
  }, []);

  return { addAnimation };
}

// =============================================================================
// Utility: Reduced Motion Check
// =============================================================================

/**
 * getReducedMotion — check whether the user prefers reduced motion.
 *
 * Used by animation setup functions to decide whether to run animations.
 * When the user has reduced motion enabled:
 *   - GSAP animations should be instant (duration: 0)
 *   - Scroll-driven effects should be skipped entirely
 *   - Swipe animations should still show directionality but without physics
 *
 * This is a utility function (not a hook) so it can be called inside
 * GSAP setup callbacks, which run outside React's render cycle.
 *
 * @returns true if the user prefers reduced motion, false otherwise
 */
export function getReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stored = localStorage.getItem('noledge:settings');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.state?.reduce_motion) return true;
    }
  } catch {}
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// =============================================================================
// Re-export GSAP for convenience
// =============================================================================

/**
 * Re-export gsap and plugins so components only need one import:
 *   import { gsap, ScrollTrigger, Draggable, Flip, useGSAP } from '@/hooks/useGSAP';
 *
 * This is a stylistic choice — the imports are identical to importing from
 * 'gsap' directly, but centralizing them here means:
 *   1. If we ever need to swap the GSAP version or replace it with a different
 *      animation library, we only change this file.
 *   2. Plugin registration (above) is guaranteed to have run before any
 *      component uses the plugins.
 */
export { gsap, ScrollTrigger, Draggable, Flip };
