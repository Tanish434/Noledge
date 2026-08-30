/**
 * @file utils/keyboard.ts
 * @description Helper functions to safely validate keyboard shortcut triggers.
 */

/**
 * isInputOrEditable — returns true if the event target or current active element
 * is an input, textarea, select, or any contenteditable element (or child thereof).
 */
export function isInputOrEditable(e: KeyboardEvent): boolean {
  const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  const target = e.target as HTMLElement | null;

  const isFormEl = (el: HTMLElement | null): boolean => {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) {
      return true;
    }
    return el.closest('input, textarea, select, [contenteditable="true"]') !== null;
  };

  return isFormEl(active) || isFormEl(target);
}

/**
 * hasModifierKey — returns true if Ctrl, Alt, or Meta (Cmd) modifier keys are active,
 * or Shift key (except when pressing Shift + / to type '?').
 */
export function hasModifierKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.altKey || e.metaKey) return true;
  if (e.shiftKey && e.key !== '?') return true;

  if (typeof e.getModifierState === 'function') {
    if (e.getModifierState('Control') || e.getModifierState('Alt') || e.getModifierState('Meta')) {
      return true;
    }
    if (e.getModifierState('Shift') && e.key !== '?') {
      return true;
    }
  }

  return false;
}
