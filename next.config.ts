/**
 * next.config.ts
 * @description Next.js configuration for the Noledge PWA.
 *
 * Key configuration areas:
 *   1. PWA headers — Service worker scope, cache headers
 *   2. Security headers — CSP, HSTS, X-Frame-Options, etc.
 *   3. Images — allowed domains for question images from GitHub/Obsidian
 *   4. Compiler options — TypeScript strict mode inherited
 *
 * Service Worker:
 *   We use a custom service worker in public/sw.js rather than next-pwa
 *   because next-pwa's default caching strategies are too aggressive for
 *   a data-driven app — they can cache stale question content. Our custom
 *   SW uses a "network-first, cache-fallback" strategy for API routes
 *   and "cache-first" only for static assets.
 */

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ─── Dev Indicators ────────────────────────────────────────────────────
  // Disable the Next.js dev overlay indicator (floating element in corner)
  devIndicators: false,

  // ─── Allowed Dev Origins ─────────────────────────────────────────────
  // Allow network IP access in development (prevents cross-origin block)
  allowedDevOrigins: ['192.168.1.2', 'localhost'],

  // ─── Experimental Features ────────────────────────────────────────────
  experimental: {
    // React Compiler for automatic memoization (reduces manual useMemo/useCallback)
    // Disabled for now — requires Babel transform. Enable when project stabilizes.
    // reactCompiler: true,
  },

  // ─── Image Configuration ──────────────────────────────────────────────
  images: {
    // Allow images from these external domains in question content.
    // GitHub raw content (for images in repos) and common CDNs.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'github.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'user-images.githubusercontent.com',
        pathname: '/**',
      },
    ],
  },

  // ─── HTTP Headers ─────────────────────────────────────────────────────
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/(.*)',
        headers: [
          // X-Frame-Options: Prevent clickjacking — Noledge should not be
          // embeddable in iframes on other origins.
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          // X-Content-Type-Options: Prevent MIME-type sniffing. Browsers
          // should trust the Content-Type header we send, not try to guess.
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // Referrer-Policy: Don't send the full URL as Referer when
          // navigating to external links in question content.
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // Permissions-Policy: Explicitly declare which browser features
          // Noledge uses. Microphone is allowed for voice questions.
          // Everything else is off — reduce attack surface.
          {
            key: 'Permissions-Policy',
            value: 'microphone=(self), camera=(), geolocation=(), payment=()',
          },
        ],
      },
      {
        // Service Worker — must be served with the correct Content-Type
        // and no caching (SW updates must be fetched fresh every time)
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
      {
        // PWA Manifest — short cache, refreshed often so icon/name updates
        // propagate to installed PWAs
        source: '/manifest.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
