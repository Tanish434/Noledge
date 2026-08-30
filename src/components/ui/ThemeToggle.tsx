'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores/settingsStore';
import { sounds } from '@/lib/sounds';
import { Sun, Moon } from 'lucide-react';

function applyWithTransition(
  origin: { x: number; y: number },
  apply: () => void,
) {
  if (!document.startViewTransition) {
    apply();
    return;
  }
  const { x, y } = origin;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );
  document.documentElement.style.setProperty("--vt-x", `${x}px`);
  document.documentElement.style.setProperty("--vt-y", `${y}px`);
  document.documentElement.style.setProperty("--vt-r", `${endRadius}px`);
  document.startViewTransition(apply);
}

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const originRef = useRef({ x: 0, y: 0 });

  useEffect(() => setMounted(true), []);

  const { sound_enabled } = useSettingsStore();

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    originRef.current = { x: e.clientX, y: e.clientY };
    const domTheme = document.documentElement.getAttribute('data-theme');
    const current = domTheme === 'light' ? 'light' : 'dark';
    const next = current === "dark" ? "light" : "dark";
    if (sound_enabled) sounds.playThemeChange();
    applyWithTransition(originRef.current, () => setTheme(next));
  };

  const domTheme = mounted && typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;
  const isDark = domTheme ? domTheme === 'dark' : resolvedTheme === 'dark';

  if (!mounted) {
    return (
      <div
        aria-hidden
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          border: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-bg-secondary)',
        }}
      />
    );
  }

  return (
    <motion.button
      type="button"
      onClick={toggle}
      style={{
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-bg-secondary)',
        color: 'var(--color-text-primary)',
        cursor: 'pointer',
        outline: 'none',
        padding: 0,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        position: 'relative',
        overflow: 'hidden',
      }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.88 }}
      transition={{ type: "spring", duration: 0.2, bounce: 0 }}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.span
            key="moon"
            initial={{ rotate: -45, scale: 0.5, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: 45, scale: 0.5, opacity: 0 }}
            transition={{ type: "spring", duration: 0.28, bounce: 0.3 }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Moon size={18} strokeWidth={1.75} />
          </motion.span>
        ) : (
          <motion.span
            key="sun"
            initial={{ rotate: 45, scale: 0.5, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: -45, scale: 0.5, opacity: 0 }}
            transition={{ type: "spring", duration: 0.28, bounce: 0.3 }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Sun size={18} strokeWidth={1.75} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}