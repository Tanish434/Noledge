/**
 * @file components/ui/Popover.tsx
 * @description Animated popover — GSAP fade + scale with hover, click-outside, and select-auto-close.
 */

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { gsap } from 'gsap';
import { getReducedMotion } from '@/hooks/useGSAP';
import { cn } from '@/utils/cn';

export interface PopoverProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'top-start' | 'top-end' | 'bottom' | 'bottom-start' | 'bottom-end' | 'left' | 'right';
  className?: string;
  openOnHover?: boolean;
  closeOnSelect?: boolean;
}

export default function Popover({
  trigger,
  children,
  side = 'bottom',
  className,
  openOnHover = false,
  closeOnSelect = true,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((prev) => !prev);
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (!openOnHover) return;
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setOpen(true);
  }, [openOnHover]);

  const handleMouseLeave = useCallback(() => {
    if (!openOnHover) return;
    hoverTimeoutRef.current = setTimeout(() => {
      setOpen(false);
    }, 200);
  }, [openOnHover]);

  useEffect(() => {
    if (!open || !contentRef.current || getReducedMotion()) return;
    gsap.fromTo(
      contentRef.current,
      { opacity: 0, scale: 0.92, y: -4 },
      { opacity: 1, scale: 1, y: 0, duration: 0.15, ease: 'power2.out' }
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener('pointerdown', handleOutsideClick);
    return () => {
      window.removeEventListener('pointerdown', handleOutsideClick);
    };
  }, [open]);

  const handleContentClick = useCallback(() => {
    if (closeOnSelect) {
      setOpen(false);
    }
  }, [closeOnSelect]);

  const sideStyles: Record<string, React.CSSProperties> = {
    top: { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 'var(--space-2)' },
    'top-start': { bottom: '100%', left: 0, marginBottom: 'var(--space-2)' },
    'top-end': { bottom: '100%', right: 0, marginBottom: 'var(--space-2)' },
    bottom: { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 'var(--space-2)' },
    'bottom-start': { top: '100%', left: 0, marginTop: 'var(--space-2)' },
    'bottom-end': { top: '100%', right: 0, marginTop: 'var(--space-2)' },
    left: { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 'var(--space-2)' },
    right: { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 'var(--space-2)' },
  };

  return (
    <div
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div onClick={toggle} style={{ cursor: 'pointer' }}>
        {trigger}
      </div>
      {open && (
        <div
          ref={contentRef}
          className={cn('card-shell', className)}
          onClick={handleContentClick}
          style={{
            position: 'absolute',
            zIndex: 100,
            padding: 'var(--space-4)',
            minWidth: '170px',
            ...sideStyles[side],
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}