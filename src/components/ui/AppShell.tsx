/**
 * @file components/ui/AppShell.tsx
 * @description Client-side app shell — Sidebar + CommandPalette + Agentation.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
// import { Agentation } from 'agentation';
import Sidebar from './Sidebar';
import CommandPalette from './CommandPalette';
import ThemeToggle from './ThemeToggle';

export default function AppShell() {
  const router = useRouter();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      const isContentEditable = target.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        return;
      }

      if (isInput || isContentEditable) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        router.push('/');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        router.push('/create');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('noledge:save'));
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);

  useEffect(() => {
    const handleAiState = (e: Event) => {
      const customEvt = e as CustomEvent<{ open?: boolean }>;
      setIsAiDrawerOpen(Boolean(customEvt.detail?.open));
    };
    window.addEventListener('noledge-ai-drawer-state', handleAiState);
    return () => window.removeEventListener('noledge-ai-drawer-state', handleAiState);
  }, []);

  const openCommandPalette = useCallback(() => setCommandPaletteOpen(true), []);
  const closeCommandPalette = useCallback(() => setCommandPaletteOpen(false), []);

  return (
    <>
      <Sidebar onOpenCommandPalette={openCommandPalette} />
      {!isAiDrawerOpen && (
        <div
          id="global-theme-toggle-wrap"
          className="global-theme-toggle-wrap"
          style={{
            position: 'fixed',
            top: 'max(12px, env(safe-area-inset-top, 12px))',
            right: 'max(12px, env(safe-area-inset-right, 12px))',
            zIndex: 999,
          }}
        >
          <ThemeToggle />
        </div>
      )}
      <CommandPalette isOpen={commandPaletteOpen} onClose={closeCommandPalette} />
      {/* <Agentation /> */}
    </>
  );
}