/**
 * @file components/ui/Notifications.tsx
 * @description Notification bell with dropdown — shows sync status, alerts.
 */

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bell, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { gsap } from 'gsap';
import { getReducedMotion } from '@/hooks/useGSAP';
import { useSyncStore } from '@/stores/syncStore';
import { cn } from '@/utils/cn';

interface Notification {
  id: string;
  type: 'success' | 'warning' | 'info';
  message: string;
  timestamp: string;
}

export default function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const { syncState } = useSyncStore();

  const notifications: Notification[] = [
    { id: '1', type: 'info', message: `Sync: ${syncState}`, timestamp: 'now' },
  ];

  useEffect(() => {
    if (!getReducedMotion() && bellRef.current) {
      gsap.fromTo(bellRef.current,
        { scale: 0.8 },
        { scale: 1, duration: 0.3, ease: 'back.out(2)' }
      );
    }
  }, []);

  const toggle = useCallback(() => setOpen((p) => !p), []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const iconFor = (type: string) => {
    if (type === 'success') return CheckCircle2;
    if (type === 'warning') return AlertTriangle;
    return Info;
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        ref={bellRef}
        onClick={toggle}
        className="btn-icon"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell size={18} strokeWidth={1.75} />
        {notifications.length > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4,
            width: 6, height: 6,
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-accent)',
          }} />
        )}
      </button>
      {open && (
        <div
          className="card-shell"
          style={{
            position: 'absolute', top: 'calc(100% + var(--space-2))', right: 0,
            width: '320px', padding: 'var(--space-3)',
            zIndex: 'var(--z-dropdown)',
          }}
        >
          <div style={{ padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
            Notifications
          </div>
          {notifications.map((n) => {
            const Icon = iconFor(n.type);
            return (
              <div key={n.id} style={{
                display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-3)',
                borderRadius: 'var(--radius-sm)',
              }}>
                <Icon size={16} strokeWidth={1.75} style={{ color: `var(--color-${n.type === 'success' ? 'success' : n.type === 'warning' ? 'warning' : 'info'})`, flexShrink: 0, marginTop: 1 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>{n.message}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{n.timestamp}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}