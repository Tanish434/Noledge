/**
 * @file app/not-found.tsx
 * @description 404 page — shown when a route doesn't exist.
 *
 * Next.js App Router automatically renders this file when notFound() is
 * called from a server component or when a route segment has no matching file.
 *
 * This is a Server Component (no 'use client') because it renders static
 * HTML — no interactivity needed beyond the navigation links.
 *
 * The visual design uses the same centered card pattern as error.tsx
 * but with a lighter tone (compass icon vs bug icon) since a 404 is
 * not a crash — the user just navigated to the wrong place.
 */

import React from 'react';
import Link from 'next/link';
import { Compass, Home, BookOpen } from 'lucide-react';
import styles from './not-found.module.css';

export default function NotFoundPage() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        {/* Icon */}
        <div className={styles.iconWrap} aria-hidden="true">
          <Compass size={40} fill="currentColor" strokeWidth={1.75} />
        </div>

        {/* Headline */}
        <h1 className={styles.title}>Page not found</h1>
        <p className={styles.code}>404</p>

        <p className={styles.message}>
          We couldn&apos;t find the page you were looking for.
          It may have been moved or deleted.
        </p>

        {/* Nav options */}
        <nav className={styles.actions} aria-label="Navigation options">
          <Link href="/" className="btn btn-primary" id="not-found-home">
            <Home size={16} aria-hidden="true" />
            Go Home
          </Link>
          <Link href="/study" className="btn btn-ghost" id="not-found-study">
            <BookOpen size={16} aria-hidden="true" />
            Study
          </Link>
        </nav>
      </div>
    </main>
  );
}
