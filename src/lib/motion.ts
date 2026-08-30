/**
 * @file lib/motion.ts
 * @description Unified GSAP motion presets — one consistent motion language.
 *
 * Hover:     180ms  power2.out
 * Click:     120ms  back.out(1.7)
 * Drawer:    350ms  expo.out
 * Modal:     250ms  scale + blur + fade
 * Cards:     40ms   stagger
 * Numbers:   1.2s   power2.out count-up
 * Charts:    0.8s   draw animation
 */

import { gsap } from 'gsap';
import { getReducedMotion } from '@/hooks/useGSAP';

// =============================================================================
// Motion Constants
// =============================================================================

export const MOTION = {
  hover: { duration: 0.18, ease: 'power2.out' },
  click: { duration: 0.12, ease: 'back.out(1.7)' },
  drawer: { duration: 0.35, ease: 'expo.out' },
  modal: { duration: 0.25, ease: 'back.out(1.2)' },
  stagger: 0.04,
  countUp: { duration: 1.2, ease: 'power2.out' },
  chart: { duration: 0.8, ease: 'power2.out' },
  page: { duration: 0.4, ease: 'power2.out' },
} as const;

// =============================================================================
// Hover Preset — lift + glow
// =============================================================================

export function gsapHover(el: HTMLElement | null, lift = 4, scale = 1.01) {
  if (!el || getReducedMotion()) return;
  gsap.to(el, {
    y: -lift,
    scale,
    duration: MOTION.hover.duration,
    ease: MOTION.hover.ease,
  });
}

export function gsapHoverOut(el: HTMLElement | null) {
  if (!el || getReducedMotion()) return;
  gsap.to(el, {
    y: 0,
    scale: 1,
    duration: MOTION.hover.duration,
    ease: 'power2.out',
  });
}

// =============================================================================
// Click Preset — compress + bounce
// =============================================================================

export function gsapClick(el: HTMLElement | null) {
  if (!el || getReducedMotion()) return;
  gsap.to(el, {
    scale: 0.94,
    duration: 0.08,
    ease: 'power2.in',
    yoyo: true,
    repeat: 1,
  });
}

// =============================================================================
// Ripple Effect
// =============================================================================

export function gsapRipple(el: HTMLElement | null, x: number, y: number) {
  if (!el || getReducedMotion()) return;
  const ripple = document.createElement('div');
  ripple.style.cssText = `position:absolute;border-radius:50%;background:oklch(1 0 0 / 0.3);pointer-events:none;`;
  el.appendChild(ripple);

  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  gsap.set(ripple, {
    x: x - rect.left - size / 2,
    y: y - rect.top - size / 2,
    width: size,
    height: size,
    scale: 0,
    opacity: 0.4,
  });
  gsap.to(ripple, {
    scale: 2,
    opacity: 0,
    duration: 0.5,
    ease: 'power2.out',
    onComplete: () => ripple.remove(),
  });
}

// =============================================================================
// Stagger Reveal
// =============================================================================

export function gsapStagger(els: Element[] | NodeListOf<Element>, delay = 0) {
  if (getReducedMotion()) return;
  gsap.fromTo(
    els,
    { y: 24, opacity: 0 },
    {
      y: 0,
      opacity: 1,
      duration: 0.4,
      stagger: MOTION.stagger,
      ease: 'power3.out',
      delay,
      clearProps: 'transform,opacity',
    }
  );
}


// =============================================================================
// Count Up Animation
// =============================================================================

export function gsapCountUp(el: HTMLElement | null, target: number, suffix = '') {
  if (!el || getReducedMotion()) {
    if (el) el.textContent = target.toString() + suffix;
    return;
  }
  const obj = { val: 0 };
  gsap.to(obj, {
    val: target,
    duration: MOTION.countUp.duration,
    ease: MOTION.countUp.ease,
    onUpdate: () => {
      el.textContent = Math.round(obj.val).toString() + suffix;
    },
  });
}

// =============================================================================
// Icon Hover Animation
// =============================================================================

export function gsapIconHover(el: HTMLElement | null, rotation = 15) {
  if (!el || getReducedMotion()) return;
  gsap.to(el, {
    rotation,
    duration: MOTION.hover.duration,
    ease: MOTION.hover.ease,
  });
}

export function gsapIconHoverOut(el: HTMLElement | null) {
  if (!el || getReducedMotion()) return;
  gsap.to(el, {
    rotation: 0,
    duration: MOTION.hover.duration,
    ease: MOTION.hover.ease,
  });
}

// =============================================================================
// Card Hover — full effect
// =============================================================================

export function gsapCardHover(el: HTMLElement | null) {
  if (!el || getReducedMotion()) return;
  gsap.to(el, {
    y: -6,
    scale: 1.02,
    duration: MOTION.hover.duration,
    ease: MOTION.hover.ease,
    boxShadow: '0 12px 32px oklch(0.05 0.005 240 / 0.4)',
  });
}

export function gsapCardHoverOut(el: HTMLElement | null) {
  if (!el || getReducedMotion()) return;
  gsap.to(el, {
    y: 0,
    scale: 1,
    duration: 0.3,
    ease: 'back.out(1.4)',
    boxShadow: '0 2px 6px oklch(0.05 0.005 240 / 0.3)',
  });
}

// =============================================================================
// Accordion Open Timeline
// =============================================================================

export function gsapAccordionOpen(
  arrow: HTMLElement | null,
  content: HTMLElement | null,
  children: Element[] | NodeListOf<Element>
) {
  if (getReducedMotion()) return;
  const tl = gsap.timeline();

  // Arrow rotate
  if (arrow) {
    tl.to(arrow, {
      rotation: 180,
      duration: 0.15,
      ease: 'power2.out',
    });
  }

  // Content expand
  if (content) {
    tl.to(content, {
      maxHeight: '2000px',
      duration: 0.25,
      ease: 'power2.out',
    }, '-=0.05');
  }

  // Children stagger
  tl.from(children, {
    y: 12,
    opacity: 0,
    duration: 0.2,
    stagger: MOTION.stagger,
    ease: 'power2.out',
  }, '-=0.15');
}

// =============================================================================
// Theme Switch Timeline
// =============================================================================

export function gsapThemeSwitch(
  currentIcon: HTMLElement | null,
  nextIcon: HTMLElement | null,
  container: HTMLElement | null,
  onSwap: () => void
) {
  if (getReducedMotion()) {
    onSwap();
    return;
  }

  const tl = gsap.timeline();

  // Current icon out
  if (currentIcon) {
    tl.to(currentIcon, {
      scale: 0,
      rotation: -90,
      opacity: 0,
      duration: 0.1,
      ease: 'power2.in',
    });
  }

  // Swap at midpoint
  tl.call(onSwap);

  // Next icon in
  if (nextIcon) {
    tl.fromTo(nextIcon, {
      scale: 0,
      rotation: 90,
      opacity: 0,
    }, {
      scale: 1,
      rotation: 0,
      opacity: 1,
      duration: 0.1,
      ease: 'back.out(1.7)',
    });
  }

  // Container pulse
  if (container) {
    tl.to(container, {
      scale: 0.92,
      duration: 0.08,
      ease: 'power2.in',
    }, 0);
    tl.to(container, {
      scale: 1,
      duration: 0.12,
      ease: 'back.out(2)',
    }, 0.08);
  }
}