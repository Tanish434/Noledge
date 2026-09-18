'use client';

import { Suspense, useEffect } from 'react';
import { useOffline } from '@/hooks/useOffline';
import { useSync } from '@/hooks/useSync';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { usePathname, useSearchParams } from 'next/navigation';
import { useSettingsStore } from '@/stores/settingsStore';
import { sounds } from '@/lib/sounds';
import AiTutorDrawer from '@/components/study/AiTutorDrawer';

function RouteScrollReset() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const resetScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;

      const elements = document.querySelectorAll<HTMLElement>(
        'main, .page-content, .page-shell, #noledge-root, [data-scrollable="true"]'
      );
      elements.forEach((el) => {
        el.scrollTop = 0;
      });
    };

    resetScroll();
    const rafId = requestAnimationFrame(resetScroll);
    const timeoutId = setTimeout(resetScroll, 50);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };
  }, [pathname, searchParams]);

  return null;
}



export default function AppProviders({ children }: { children: React.ReactNode }) {
  const { setSession } = useAuthStore();
  const { compact_mode, card_glow, high_contrast, font_family, font_size, reduce_motion } = useSettingsStore();

  // ── Sync Appearance & Accessibility attributes to <html> element ────────
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-compact', String(compact_mode));
    root.setAttribute('data-card-glow', String(card_glow));
    root.setAttribute('data-high-contrast', String(high_contrast));
    root.setAttribute('data-reduce-motion', String(reduce_motion));
    root.setAttribute('data-font-style', font_family);
    root.setAttribute('data-font-size', font_size);
  }, [compact_mode, card_glow, high_contrast, font_family, font_size, reduce_motion]);

  // ── Global Native Gesture Unlock for Mobile Audio (iOS Safari & Android Chrome) ──
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const unlockAudio = () => {
      sounds.unlockSync();
    };

    const options = { capture: true, passive: true };
    window.addEventListener('touchstart', unlockAudio, options);
    window.addEventListener('pointerdown', unlockAudio, options);
    window.addEventListener('click', unlockAudio, options);
    window.addEventListener('keydown', unlockAudio, options);

    return () => {
      window.removeEventListener('touchstart', unlockAudio, options);
      window.removeEventListener('pointerdown', unlockAudio, options);
      window.removeEventListener('click', unlockAudio, options);
      window.removeEventListener('keydown', unlockAudio, options);
    };
  }, []);

  // ── Supabase auth state subscription ─────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        import('@/lib/supabaseSync').then(({ syncSupabaseCloud }) => {
          void syncSupabaseCloud();
        });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        import('@/lib/supabaseSync').then(({ syncSupabaseCloud }) => {
          void syncSupabaseCloud();
        });
      }
    });

    return () => subscription.unsubscribe();
  }, [setSession]);

  // Monitor network connectivity — triggers offline event replay on reconnect
  useOffline();

  // Auto-sync from GitHub/Obsidian on tab restore and reconnect
  useSync();

  return (
    <>
      <Suspense fallback={null}>
        <RouteScrollReset />
      </Suspense>
      {children}
      <AiTutorDrawer />
    </>
  );
}
