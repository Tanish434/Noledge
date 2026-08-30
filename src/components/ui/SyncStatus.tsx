/**
 * @file components/ui/SyncStatus.tsx
 * @description Sync status indicator showing connection state, pending events,
 *              and cloud (Supabase) auth/sync status.
 */

'use client';

import React from 'react';
import { RefreshCw, CloudOff, AlertTriangle, CheckCircle2, User, LogOut } from 'lucide-react';
import { useSyncStore } from '@/stores/syncStore';
import { useAuthStore } from '@/stores/authStore';
import { useRouter } from 'next/navigation';
import { cn } from '@/utils/cn';
import styles from './SyncStatus.module.css';

export default function SyncStatus({ compact = false }: { compact?: boolean }) {
  const { syncState, lastSyncAt, pendingEventCount, conflicts } = useSyncStore();
  const { user, signOut } = useAuthStore();
  const router = useRouter();

  const config = {
    idle: { label: 'GitHub', icon: CheckCircle2, color: 'var(--color-correct)' },
    syncing: { label: 'Syncing…', icon: RefreshCw, color: 'var(--color-warning)' },
    offline: { label: 'Offline', icon: CloudOff, color: 'var(--color-text-tertiary)' },
    error: { label: 'Sync error', icon: AlertTriangle, color: 'var(--color-wrong)' },
    conflict: { label: `${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''}`, icon: AlertTriangle, color: 'var(--color-warning)' },
  }[syncState];

  const Icon = config.icon;

  const lastSyncFormatted = lastSyncAt
    ? new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Never';

  if (compact) {
    return (
      <div className={styles.compact} title={config.label}>
        <span className={cn('sync-dot', styles[`state-${syncState}`])} />
      </div>
    );
  }

  const [confirmSignOut, setConfirmSignOut] = React.useState(false);

  return (
    <div className={styles.container}>
      {user && (
        <div className="flex items-center gap-1.5 min-w-0 w-full text-xs font-mono text-slate-400 mb-1.5" title={`Signed in as ${user.email}`}>
          <User size={12} className="shrink-0 text-purple-400" />
          <span className={styles.userEmail} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.email?.split('@')[0]}
          </span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
        <Icon
          size={13}
          style={{ color: config.color }}
          aria-hidden="true"
          className={syncState === 'syncing' ? styles.spin : undefined}
        />
        <span className={styles.label} style={{ color: config.color }}>
          {config.label}
        </span>
        {lastSyncAt && (
          <span className={styles.lastSync} style={{ marginLeft: 4 }}>• {lastSyncFormatted}</span>
        )}
      </div>
    </div>
  );
}
