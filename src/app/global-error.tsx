'use client';

import React, { useEffect } from 'react';
import { RotateCcw, Home, AlertTriangle } from 'lucide-react';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error('[Noledge Root Global Error]', error);
  }, [error]);

  return (
    <html lang="en" data-theme="dark">
      <head>
        <title>Error | Noledge</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background-color: #050507;
            color: #f4f4f5;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
          }
          .card {
            background: #0d0d12;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            padding: 36px 32px;
            max-width: 440px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
          }
          .icon-wrap {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: rgba(239, 68, 68, 0.12);
            color: #ef4444;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
          }
          h1 {
            font-size: 20px;
            font-weight: 700;
            margin-bottom: 8px;
            color: #ffffff;
          }
          p {
            font-size: 14px;
            color: #a1a1aa;
            line-height: 1.5;
            margin-bottom: 24px;
          }
          .actions {
            display: flex;
            gap: 12px;
            justify-content: center;
          }
          .btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 20px;
            font-size: 14px;
            font-weight: 600;
            border-radius: 10px;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.15s ease;
          }
          .btn-primary {
            background: #8b5cf6;
            color: #ffffff;
            border: none;
          }
          .btn-primary:hover {
            background: #7c3aed;
          }
          .btn-secondary {
            background: transparent;
            color: #d4d4d8;
            border: 1px solid rgba(255, 255, 255, 0.14);
          }
          .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.05);
          }
        `}</style>
      </head>
      <body>
        <div className="card">
          <div className="icon-wrap">
            <AlertTriangle size={28} />
          </div>
          <h1>Something went wrong</h1>
          <p>An unexpected error occurred while rendering the application.</p>
          <div className="actions">
            <button className="btn btn-primary" onClick={reset}>
              <RotateCcw size={16} />
              Try Again
            </button>
            <a href="/" className="btn btn-secondary">
              <Home size={16} />
              Go Home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
