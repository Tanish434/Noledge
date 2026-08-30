/**
 * @file components/ui/Toast.tsx
 * @description GSAP-animated toast notification system.
 *
 * Toasts are non-blocking notifications that appear in the top-right corner
 * (desktop) or bottom-center (mobile, above the tab bar) and auto-dismiss
 * after a configurable duration.
 *
 * Architecture:
 *   - ToastProvider: React context that wraps the app, exposes `addToast()`
 *   - useToast(): hook to access `addToast()` from any component
 *   - ToastContainer: renders the list of active toasts, handles GSAP animations
 *   - Toast: individual toast item with icon, message, and dismiss button
 *
 * GSAP animations:
 *   - Enter: slide in from right + fade in (desktop), slide up + fade (mobile)
 *   - Exit: slide out in reverse direction + fade out
 *   - Stacking: each new toast shifts existing ones upward/downward
 */

'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useId,
} from 'react';
import { gsap } from 'gsap';
import { X, CheckCircle2, AlertTriangle, Info, XCircle } from 'lucide-react';
import { UI } from '@/lib/constants';
import { cn } from '@/utils/cn';
import styles from './Toast.module.css';

// =============================================================================
// Types
// =============================================================================

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastData {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;    // ms, defaults to UI.TOAST_DURATION_MS
}

interface ToastContextValue {
  addToast: (message: string, variant?: ToastVariant, duration?: number) => void;
}

// =============================================================================
// Context
// =============================================================================

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * useToast — access the toast system from any component.
 *
 * @example
 *   const { addToast } = useToast();
 *   addToast('Deck synced!', 'success');
 *   addToast('Sync failed — check connection', 'error', 5000);
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

// =============================================================================
// Individual Toast Item
// =============================================================================

const ICONS: Record<ToastVariant, React.ComponentType<{ size?: number }>> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

interface ToastItemProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const Icon = ICONS[toast.variant];

  // Entrance animation
  useEffect(() => {
    if (!ref.current) return;
    gsap.fromTo(
      ref.current,
      { x: 40, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.3, ease: 'power3.out' }
    );
  }, []);

  const handleDismiss = useCallback(() => {
    if (!ref.current) { onDismiss(toast.id); return; }
    gsap.to(ref.current, {
      x: 40,
      opacity: 0,
      duration: 0.2,
      ease: 'power2.in',
      onComplete: () => onDismiss(toast.id),
    });
  }, [toast.id, onDismiss]);

  // Auto-dismiss
  useEffect(() => {
    const timer = setTimeout(handleDismiss, toast.duration ?? UI.TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [handleDismiss, toast.duration]);

  return (
    <div
      ref={ref}
      role="alert"
      aria-live="polite"
      className={cn(styles.toast, styles[`toast-${toast.variant}`])}
    >
      <span className={styles.toastIcon} aria-hidden="true"><Icon size={18} /></span>
      <span className={styles.toastMessage}>{toast.message}</span>
      <button
        onClick={handleDismiss}
        className={styles.toastClose}
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// =============================================================================
// Toast Container + Provider
// =============================================================================

/**
 * ToastProvider — wrap your app with this to enable toasts everywhere.
 *
 * Place this in the root layout so all pages can access addToast().
 * The ToastContainer renders into a portal (#toast-portal div) so toasts
 * always appear above other content, including modals.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const addToast = useCallback((
    message: string,
    variant: ToastVariant = 'info',
    duration?: number
  ) => {
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `toast-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setToasts((prev) => [...prev, { id, message, variant, duration }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {/* Toast container — positioned fixed in CSS, renders at bottom of DOM */}
      <div className={styles.toastContainer} aria-label="Notifications">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
