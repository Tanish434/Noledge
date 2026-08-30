/**
 * @file components/ui/PageTransition.tsx
 * @description GSAP page entry transition wrapper — fade + slide + blur.
 *
 * Wraps a page's content and plays a fade + slide-up + blur animation on mount.
 * Used on ALL main pages (/, /study, /manage, /create, /settings).
 *
 * ANIMATION:
 *   Enter: opacity 0→1, y 16→0, blur 8px→0, duration 350ms, ease power2.out
 *   Stagger: .pt-item elements stagger in at 60ms intervals
 *
 * USAGE:
 *   <PageTransition>
 *     <h1 className="pt-item">Title</h1>
 *     <Content className="pt-item" />
 *   </PageTransition>
 */

'use client';

import React, { useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { getReducedMotion } from '@/hooks/useGSAP';

// =============================================================================
// Component
// =============================================================================

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

export default function PageTransition({ children, className }: PageTransitionProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || getReducedMotion()) return;

    const el = ref.current;
    const items = el.querySelectorAll('.pt-item');

    if (items.length > 0) {
      // Fast staggered entry
      gsap.fromTo(
        items,
        { opacity: 0, y: 8 },
        {
          opacity: 1,
          y: 0,
          duration: 0.2,
          ease: 'power2.out',
          stagger: 0.03,
          clearProps: 'transform,opacity',
        }
      );
    } else {
      // Whole-page instant fade + slide
      gsap.fromTo(
        el,
        { opacity: 0, y: 6 },
        {
          opacity: 1,
          y: 0,
          duration: 0.2,
          ease: 'power2.out',
          clearProps: 'transform,opacity',
        }
      );
    }
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}