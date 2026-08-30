/**
 * @file app/error.tsx
 * @description Global error boundary for Next.js App Router.
 *
 * Next.js renders this component when an unhandled error occurs anywhere in
 * the component tree below the root layout. It catches:
 *   - Runtime errors during rendering
 *   - Errors in event handlers (if not caught locally)
 *   - Errors in async data fetching (Server Components, route handlers)
 *
 * This is a CLIENT COMPONENT — it must be because it uses the `error` and
 * `reset` props that Next.js passes at runtime, and it uses useEffect to
 * log the error.
 *
 * The `reset` function attempts to re-render the segment. If the error was
 * transient (network blip, race condition), this will succeed. If it was
 * permanent (broken component), the error will appear again.
 *
 * For production, errors should be reported to a monitoring service
 * (e.g. Sentry). The logger call here is the integration point.
 */

'use client';

import React, { useEffect } from 'react';
import { RotateCcw, Bug } from 'lucide-react';
import styles from './error.module.css';

interface ErrorPageProps {
  /** The actual Error object thrown — includes message and stack trace */
  error: Error & { digest?: string };
  /** Call this to re-render the segment — attempts recovery */
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Log to console in development; in production hook up to Sentry here
    console.error('[Noledge Error Boundary]', error);
  }, [error]);

  return (
    <main className={styles.page} role="alert" aria-live="assertive">
      <div className={styles.card}>
        {/* Icon */}
        <div className={styles.iconWrap} aria-hidden="true">
          <Bug size={40} fill="currentColor" strokeWidth={1.75} />
        </div>

        <h1 className={styles.title}>Something went wrong</h1>

        <p className={styles.message}>
          {error.message
            ? error.message
            : 'An unexpected error occurred. Your study data is safe.'}
        </p>

        {/* Digest — Next.js server error identifier for debugging */}
        {error.digest && (
          <p className={styles.digest}>
            Error ID: <code>{error.digest}</code>
          </p>
        )}

        <div className={styles.actions}>
          <button
            id="error-retry"
            className="btn btn-primary"
            onClick={reset}
          >
            <RotateCcw size={16} aria-hidden="true" />
            Try Again
          </button>

          <a href="/" className="btn btn-ghost">
            Go Home
          </a>
        </div>

        {/* Stack trace — only shown in development */}
        {process.env.NODE_ENV === 'development' && error.stack && (
          <details className={styles.stack}>
            <summary className={styles.stackSummary}>Stack trace (dev only)</summary>
            <pre className={styles.stackContent}>{error.stack}</pre>
          </details>
        )}
      </div>
    </main>
  );
}
