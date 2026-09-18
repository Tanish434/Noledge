/**
 * layout.tsx
 * @description Root layout for the Noledge Next.js App Router.
 *
 * This is the outermost layout — it wraps every page in the application.
 * It handles:
 *   1. Theme initialization (prevents flash of wrong theme on load)
 *   2. HTML metadata (SEO, PWA manifest link, Open Graph)
 *   3. Font loading (Geist and Geist Mono via CSS import in globals.css)
 *   4. Provider tree (Theme, Toast, and future providers)
 *   5. Navigation shell (bottom nav on mobile, sidebar on desktop)
 *   6. Page transition wrapper (GSAP animates this on route changes)
 *
 * THEME INITIALIZATION SCRIPT:
 * The theme is initialized via an inline blocking script (renderBlocking=true)
 * that runs BEFORE React hydration. This is intentional — it prevents the
 * flash of wrong theme (FOWT) that would occur if we set the theme after
 * React mounts. The script reads from localStorage and sets data-theme on
 * <html> synchronously, so the correct theme is applied before the first paint.
 *
 * RSC BOUNDARY:
 * This is a Server Component (no 'use client'). All providers and interactive
 * elements that need client-side APIs are isolated in client component wrappers.
 */

import type { Metadata, Viewport } from 'next';
import './globals.css';
import { APP_NAME, APP_DESCRIPTION } from '@/lib/constants';

// =============================================================================
// Metadata — SEO & PWA
// =============================================================================

/**
 * metadata — Next.js static metadata export for SEO and social sharing.
 *
 * These values populate:
 *   - <title> and <meta name="description"> for search engines
 *   - Open Graph tags for rich link previews (Slack, Twitter, iMessage)
 *   - Manifest link for PWA installability
 *   - Theme color for browser chrome styling (matches dark theme bg)
 */
export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    // Template: page-specific titles append "| Noledge" for sub-pages
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: APP_NAME,
  },
  formatDetection: {
    // Prevent iOS from auto-linking phone numbers in question content
    telephone: false,
  },
  openGraph: {
    type: 'website',
    title: APP_NAME,
    description: APP_DESCRIPTION,
    siteName: APP_NAME,
  },
  robots: {
    // This is a personal tool — no need for search engine indexing
    index: false,
    follow: false,
  },
};

/**
 * viewport — Next.js viewport configuration.
 *
 * themeColor changes between dark/light modes to style the browser chrome
 * (the address bar area on mobile Chrome/Safari) consistently with the
 * app's background color.
 *
 * width=device-width, initial-scale=1 prevents iOS from zooming in on
 * inputs (which it does by default for font sizes under 16px).
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,      // Prevent user-zoom (study cards need precise touch)
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: dark)',  color: '#050507' },
    { media: '(prefers-color-scheme: light)', color: '#f8f8fc' },
  ],
};

// =============================================================================
// Theme Initialization Script
// =============================================================================

/**
 * themeScript — an IIFE that runs synchronously before React hydration.
 *
 * This script reads the user's saved theme preference from localStorage
 * and immediately applies it as a data-theme attribute on <html>. By
 * running synchronously (not deferred), it happens before the browser
 * paints anything — eliminating the flash of wrong theme.
 *
 * Why a raw script tag and not a hook?
 *   React hooks run AFTER hydration, which is AFTER the first paint.
 *   If we set the theme in a useEffect, users would briefly see the
 *   wrong theme before the effect fires. The inline blocking script
 *   avoids this at the cost of a tiny synchronous execution on every
 *   page load (typically < 1ms, completely imperceptible).
 *
 * The script is kept minimal — no imports, no dependencies — because
 * it runs in a context where the module system isn't available yet.
 */
const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('noledge:theme');
    var preferred = stored || (
      window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    );
    document.documentElement.setAttribute('data-theme', preferred);
  } catch (e) {
    // If localStorage is blocked (private browsing, storage quota), 
    // default to dark theme silently.
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`.trim();

// =============================================================================
// Root Layout Component
// =============================================================================

/**
 * RootLayout — the root server component that wraps all pages.
 *
 * IMPORTANT: This component is a Server Component. All client-side interactivity
 * (navigation, toasts, theme toggle) is handled in separate Client Components
 * that are imported here. The RSC boundary ensures that static layout HTML
 * is generated server-side for fast initial page load, while interactive
 * elements hydrate on the client.
 */
import AppShell from '@/components/ui/AppShell';
import { ToastProvider } from '@/components/ui/Toast';
import ServiceWorkerRegister from '@/components/ui/ServiceWorkerRegister';
import AppProviders from '@/components/ui/AppProviders';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/react';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="dark"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <script
          id="theme-init"
          dangerouslySetInnerHTML={{ __html: themeScript }}
          suppressHydrationWarning
        />
      </head>
      <body suppressHydrationWarning>
        <ToastProvider>
          <ServiceWorkerRegister />
          <AppProviders>
            <div id="noledge-root" className="page-shell">
              <AppShell />
              <main className="page-content">
                {children}
              </main>
            </div>
          </AppProviders>
        </ToastProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
