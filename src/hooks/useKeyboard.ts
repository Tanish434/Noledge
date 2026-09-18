/**
 * @file hooks/useKeyboard.ts
 * @description Keyboard shortcut hook for study session navigation.
 *
 * Keyboard shortcuts:
 *   →  / L / D  — next card (or "I know it" equivalent)
 *   ←  / H / A  — previous card
 *   Space       — reveal answer / flip card
 *   1-5         — score the card (when in answer-revealed state)
 *   Esc         — exit session
 *
 * Shortcuts are disabled when:
 *   - The user is focused in a text input (typing answer)
 *   - The session is not active
 *   - reduced-motion is preferred (no GSAP side-effects, but logic still fires)
 */

'use client';

import { useEffect, useCallback } from 'react';
import { createLogger } from '@/lib/logger';
import { isInputOrEditable, hasModifierKey } from '@/utils/keyboard';

const log = createLogger('ui');

// =============================================================================
// Types
// =============================================================================

export interface KeyboardHandlers {
  /** Fire when the user presses → or D to go to the next card */
  onNext?: () => void;
  /** Fire when the user presses ← or A to go to the previous card */
  onPrev?: () => void;
  /** Fire when the user presses Space to reveal the answer */
  onReveal?: () => void;
  /** Fire when user presses 1 (Forgot), 2 (Hard), 3 (Good), 4 (Easy) */
  onRate?: (rating: 'again' | 'hard' | 'good' | 'easy') => void;
  /** Fire when the user presses Esc to exit the session */
  onEscape?: () => void;
  /** Whether keyboard shortcuts are currently active */
  enabled?: boolean;
}

// =============================================================================
// Hook
// =============================================================================

export function useKeyboard({
  onNext,
  onPrev,
  onReveal,
  onRate,
  onEscape,
  enabled = true,
}: KeyboardHandlers): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Don't fire shortcuts when AI drawer is open
      if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-ai-drawer-open')) {
        return;
      }

      // Don't fire shortcuts when typing in inputs
      if (isInputOrEditable(event)) {
        return;
      }

      const key = event.key;
      const code = event.code;

      if (key === ' ' || code === 'Space') {
        if (onReveal) {
          event.preventDefault();
          log.debug('keyboard_reveal', 'Reveal answer via keyboard');
          onReveal();
        }
        return;
      }

      if (key === 'ArrowRight' || code === 'ArrowRight' || code === 'KeyD' || code === 'KeyL') {
        if (onNext) {
          event.preventDefault();
          log.debug('keyboard_next', 'Next card via keyboard');
          onNext();
        }
        return;
      }

      if (key === 'ArrowLeft' || code === 'ArrowLeft' || code === 'KeyA' || code === 'KeyH') {
        if (onPrev) {
          event.preventDefault();
          log.debug('keyboard_prev', 'Previous card via keyboard');
          onPrev();
        }
        return;
      }

      if (key === '1' || code === 'Digit1' || code === 'Numpad1') {
        if (onRate) {
          event.preventDefault();
          onRate('again');
        }
        return;
      }

      if (key === '2' || code === 'Digit2' || code === 'Numpad2') {
        if (onRate) {
          event.preventDefault();
          onRate('hard');
        }
        return;
      }

      if (key === '3' || code === 'Digit3' || code === 'Numpad3') {
        if (onRate) {
          event.preventDefault();
          onRate('good');
        }
        return;
      }

      if (key === '4' || code === 'Digit4' || code === 'Numpad4') {
        if (onRate) {
          event.preventDefault();
          onRate('easy');
        }
        return;
      }

      if (key === 'Escape' || code === 'Escape') {
        if (onEscape) {
          event.preventDefault();
          log.debug('keyboard_escape', 'Escape session via keyboard');
          onEscape();
        }
        return;
      }
    },
    [enabled, onNext, onPrev, onReveal, onRate, onEscape]
  );

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);
}
