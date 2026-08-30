/**
 * @file hooks/useHaptics.ts
 * @description Hook for haptic feedback via the Vibration API + visual animations.
 *
 * "Haptics" in Noledge means two things simultaneously:
 *   1. Physical vibration — using the browser's Vibration API (navigator.vibrate)
 *      to create tactile feedback on phones.
 *   2. Visual haptics — GSAP micro-animations (shake, pulse, bounce) that
 *      simulate physical feedback on screens that don't vibrate (laptop).
 *
 * The Vibration API is:
 *   - Supported: Chrome for Android, Samsung Internet, some Firefox for Android
 *   - NOT supported: iOS Safari (Apple doesn't expose vibration to web apps)
 *   - NOT supported: Desktop browsers (no vibration hardware)
 *
 * For iOS and desktop, the visual haptics (shake/pulse animations) provide
 * equivalent feedback. Users with devices that support vibration get both.
 *
 * Vibration is automatically disabled if:
 *   1. The user has reduced motion preference set (prefers-reduced-motion)
 *   2. navigator.vibrate is not available (unsupported browser)
 *   3. The user has disabled haptics in Noledge settings
 *
 * All vibration pattern values come from HAPTIC_PATTERNS in constants.ts.
 */

'use client';

import { useCallback } from 'react';
import { HAPTIC_PATTERNS } from '@/lib/constants';

// =============================================================================
// Types
// =============================================================================

/**
 * HapticType — the type of feedback event to trigger.
 *
 * Each type maps to:
 *   - A specific vibration pattern in HAPTIC_PATTERNS
 *   - A specific visual GSAP animation in the calling component
 */
export type HapticType = 'correct' | 'wrong' | 'swipe' | 'session-complete';

/**
 * UseHapticsReturn — the object returned by useHaptics().
 *
 * Fields:
 *   trigger   — Trigger a haptic feedback event by type
 *   isSupported — Whether the Vibration API is available on this device
 */
export interface UseHapticsReturn {
  trigger: (type: HapticType) => void;
  isSupported: boolean;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * useHaptics — trigger haptic feedback (vibration + visual) for study events.
 *
 * @param enabled  Whether haptics are enabled in user settings.
 *                 Defaults to true. When false, vibration is suppressed
 *                 (visual animations are controlled by the calling component).
 *
 * @returns UseHapticsReturn
 *
 * @example
 *   const { trigger } = useHaptics(settings.haptics_enabled);
 *
 *   // In answer handler:
 *   if (isCorrect) {
 *     trigger('correct');
 *     // Also add GSAP pulse animation in the component
 *   } else {
 *     trigger('wrong');
 *     // Also add GSAP shake animation
 *   }
 */
export function useHaptics(enabled: boolean = true): UseHapticsReturn {
  // Check once at hook initialization whether the Vibration API is available.
  // navigator.vibrate is undefined in non-supporting browsers.
  const isSupported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  /**
   * trigger — vibrate the device using the pattern for the given haptic type.
   *
   * Silently does nothing if:
   *   - haptics are disabled by the caller
   *   - Vibration API is not supported
   *   - User prefers reduced motion (vibration can cause discomfort for some users
   *     with vestibular disorders — the W3C recommends treating vibration similarly
   *     to animation for accessibility purposes)
   */
  const trigger = useCallback((type: HapticType): void => {
    if (!enabled) return;
    if (!isSupported) return;

    // Check reduced motion preference — see note above about vestibular disorders
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    // Select the vibration pattern for this haptic type
    let pattern: number[];
    switch (type) {
      case 'correct':         pattern = HAPTIC_PATTERNS.CORRECT; break;
      case 'wrong':           pattern = HAPTIC_PATTERNS.WRONG; break;
      case 'swipe':           pattern = HAPTIC_PATTERNS.SWIPE; break;
      case 'session-complete': pattern = HAPTIC_PATTERNS.SESSION_COMPLETE; break;
      default:                pattern = HAPTIC_PATTERNS.SWIPE; break;
    }

    // navigator.vibrate() accepts either a single duration or an array pattern.
    // The return value is a boolean indicating if the vibration was scheduled
    // (not if it actually vibrated — that's not observable from JS).
    // We ignore the return value because there's nothing to do if it fails.
    try {
      navigator.vibrate(pattern);
    } catch {
      // Vibrate can throw in some restricted environments (some browsers
      // require a user gesture before the first vibration). Silently ignore.
    }
  }, [enabled, isSupported]);

  return { trigger, isSupported };
}
