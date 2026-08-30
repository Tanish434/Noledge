/**
 * @file app/settings/page.tsx
 * @description Settings page — full-width, single-panel.
 * Navigation is in the main sidebar (Sidebar.tsx) as a sub-group under Settings.
 * Active section driven by ?tab= search param.
 */

'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Palette,
  GraduationCap,
  RefreshCw,
  Download,
  Accessibility,
  SlidersHorizontal,
  Info,
  User as UserIcon,
  LogOut,
  ShieldCheck,
  Bot,
  Sparkles,
  Key,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import type { SettingsState } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { useSourceStore } from '@/stores/sourceStore';
import PageTransition from '@/components/ui/PageTransition';
import SourceManager from '@/components/sources/SourceManager';
import CustomSelect from '@/components/ui/CustomSelect';
import { Switch } from '@/components/unlumen-ui/primitives/switch';
import { useSync } from '@/hooks/useSync';
import { useToast } from '@/components/ui/Toast';
import { sounds } from '@/lib/sounds';
import styles from './settings.module.css';

// =============================================================================
// Types
// =============================================================================

type SectionId = 'appearance' | 'study' | 'sync' | 'import' | 'accessibility' | 'advanced' | 'about';

interface NavEntry {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  eyebrow: string;
  subtitle: string;
}

const NAV: NavEntry[] = [
  { id: 'appearance',    label: 'Appearance',   icon: Palette,           eyebrow: 'Visual',    subtitle: 'Theme, text size, and visual preferences' },
  { id: 'study',         label: 'Study',         icon: GraduationCap,     eyebrow: 'Learning',  subtitle: 'Session behaviour, feedback and auto-advance' },
  { id: 'sync',          label: 'Sync',          icon: RefreshCw,         eyebrow: 'Data',      subtitle: 'Supabase sync and real-time updates' },
  { id: 'import',        label: 'Import',        icon: Download,          eyebrow: 'Sources',   subtitle: 'Connect GitHub repos and Obsidian vaults' },
  { id: 'accessibility', label: 'Accessibility', icon: Accessibility,     eyebrow: 'Access',    subtitle: 'Motion, contrast, and screen reader support' },
  { id: 'advanced',      label: 'Advanced',      icon: SlidersHorizontal, eyebrow: 'Developer', subtitle: 'Developer options and data management' },
  { id: 'about',         label: 'About',         icon: Info,              eyebrow: 'Info',      subtitle: 'Version, credits, and reset options' },
];

// =============================================================================
// SettingRow
// =============================================================================

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  onClick?: () => void;
}

function SettingRow({ label, description, children, onClick }: SettingRowProps) {
  return (
    <div
      className={styles.settingRow}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <div className={styles.settingInfo}>
        <span className={styles.settingLabel}>{label}</span>
        {description && <span className={styles.settingDesc}>{description}</span>}
      </div>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

// =============================================================================
// SectionCard
// =============================================================================

function SectionCard({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionCardHeader}>
        <Icon size={15} strokeWidth={1.75} className={styles.sectionCardIcon} />
        <span className={styles.sectionCardTitle}>{title}</span>
      </div>
      <div className={styles.sectionCardBody}>{children}</div>
    </div>
  );
}

// =============================================================================
// WiredSwitch
// =============================================================================

function WiredSwitch({ checked, onChange, 'aria-label': ariaLabel, soundEnabled = true }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  'aria-label': string;
  soundEnabled?: boolean;
}) {
  return (
    <Switch
      checked={checked}
      onCheckedChange={(v) => {
        if (soundEnabled) sounds.playToggle();
        onChange(v);
      }}
      aria-label={ariaLabel}
    />
  );
}

// =============================================================================
// Section Renderers
// =============================================================================

function AppearanceSection({ s }: { s: SettingsState }) {
  return (
    <SectionCard icon={Palette} title="Display & Layout">
      <SettingRow label="Text Size" description="Font size used during study sessions">
        <CustomSelect
          value={s.font_size}
          options={[
            { value: 'sm', label: 'Small' },
            { value: 'md', label: 'Medium' },
            { value: 'lg', label: 'Large' },
          ]}
          onChange={(v) => s.updateSetting('font_size', v)}
          aria-label="Text Size"
        />
      </SettingRow>

      <SettingRow label="Font Style" description="Typography style across study cards and questions">
        <CustomSelect
          value={s.font_family}
          options={[
            { value: 'sans', label: 'System Sans (Modern)' },
            { value: 'mono', label: 'Geist Mono (Code / Tech)' },
            { value: 'serif', label: 'Academic Serif (Editorial)' },
            { value: 'rounded', label: 'Soft Rounded (Friendly)' },
            { value: 'slab', label: 'Technical Slab (Typewriter)' },
            { value: 'dyslexic', label: 'OpenDyslexic (Accessible)' },
          ]}
          onChange={(v) => s.updateSetting('font_family', v)}
          aria-label="Font Style"
        />
      </SettingRow>

      <SettingRow label="Compact Cards" description="Use tighter padding for study cards and list items" onClick={() => s.updateSetting('compact_mode', !s.compact_mode)}>
        <WiredSwitch checked={s.compact_mode} onChange={(v) => s.updateSetting('compact_mode', v)}
          aria-label="Compact cards" soundEnabled={s.sound_enabled} />
      </SettingRow>

      <SettingRow label="Card Glow" description="Subtle glow effect on active card borders" onClick={() => s.updateSetting('card_glow', !s.card_glow)}>
        <WiredSwitch checked={s.card_glow} onChange={(v) => s.updateSetting('card_glow', v)}
          aria-label="Card glow" soundEnabled={s.sound_enabled} />
      </SettingRow>
    </SectionCard>
  );
}

function StudySection({ s }: { s: SettingsState }) {
  return (
    <>
      <SectionCard icon={GraduationCap} title="Feedback">
        <SettingRow label="Haptics" description="Vibration on mobile when answering cards" onClick={() => s.updateSetting('haptics_enabled', !s.haptics_enabled)}>
          <WiredSwitch checked={s.haptics_enabled} onChange={(v) => s.updateSetting('haptics_enabled', v)}
            aria-label="Haptics" soundEnabled={s.sound_enabled} />
        </SettingRow>
        <SettingRow label="Sound Effects" description="Web Audio tones on correct and incorrect answers" onClick={() => s.updateSetting('sound_enabled', !s.sound_enabled)}>
          <WiredSwitch checked={s.sound_enabled} onChange={(v) => s.updateSetting('sound_enabled', v)}
            aria-label="Sound effects" soundEnabled={s.sound_enabled} />
        </SettingRow>
      </SectionCard>

      <SectionCard icon={GraduationCap} title="Session">
        <SettingRow label="Progress Bar" description="Show progress during study sessions" onClick={() => s.updateSetting('show_progress_bar', !s.show_progress_bar)}>
          <WiredSwitch checked={s.show_progress_bar} onChange={(v) => s.updateSetting('show_progress_bar', v)}
            aria-label="Progress bar" soundEnabled={s.sound_enabled} />
        </SettingRow>
        <SettingRow label="Session Timer" description="Show elapsed time during a session" onClick={() => s.updateSetting('show_session_timer', !s.show_session_timer)}>
          <WiredSwitch checked={s.show_session_timer} onChange={(v) => s.updateSetting('show_session_timer', v)}
            aria-label="Session timer" soundEnabled={s.sound_enabled} />
        </SettingRow>
        <SettingRow label="Shuffle Options" description="Randomize MCQ answer order on display" onClick={() => s.updateSetting('shuffle_options', !s.shuffle_options)}>
          <WiredSwitch checked={s.shuffle_options} onChange={(v) => s.updateSetting('shuffle_options', v)}
            aria-label="Shuffle options" soundEnabled={s.sound_enabled} />
        </SettingRow>
        <SettingRow label="Auto-Advance" description="Advance to next card after correct answer" onClick={() => s.updateSetting('auto_advance', !s.auto_advance)}>
          <WiredSwitch checked={s.auto_advance} onChange={(v) => s.updateSetting('auto_advance', v)}
            aria-label="Auto-advance" soundEnabled={s.sound_enabled} />
        </SettingRow>
        <SettingRow label="Session Limit" description="Maximum number of cards per study session">
          <CustomSelect
            value={s.default_session_limit}
            options={[
              { value: 10, label: '10 cards' },
              { value: 20, label: '20 cards' },
              { value: 30, label: '30 cards' },
              { value: 50, label: '50 cards' },
              { value: 75, label: '75 cards' },
              { value: 100, label: '100 cards' },
              { value: 150, label: '150 cards' },
              { value: 200, label: '200 cards' },
              { value: 500, label: '500 cards' },
              { value: 999999, label: 'No Limit (All Cards ∞)' },
            ]}
            onChange={(v) => s.updateSetting('default_session_limit', v)}
            aria-label="Session Limit"
          />
        </SettingRow>
        <SettingRow label="Voice Language" description="Language for voice recognition questions">
          <CustomSelect
            value={s.voice_language}
            options={[
              { value: 'en-US', label: 'English (US)' },
              { value: 'en-GB', label: 'English (UK)' },
              { value: 'fr-FR', label: 'French' },
              { value: 'de-DE', label: 'German' },
              { value: 'es-ES', label: 'Spanish' },
              { value: 'it-IT', label: 'Italian' },
              { value: 'ja-JP', label: 'Japanese' },
              { value: 'zh-CN', label: 'Chinese (Simplified)' },
              { value: 'ar-SA', label: 'Arabic' },
              { value: 'hi-IN', label: 'Hindi' },
            ]}
            onChange={(v) => s.updateSetting('voice_language', v)}
            aria-label="Voice Language"
          />
        </SettingRow>
      </SectionCard>

      <SectionCard icon={Bot} title="AI Tutor Studio">
        <SettingRow label="AI Provider" description="Model provider for AI Tutor contextual question explanations">
          <CustomSelect
            value={s.ai_provider || 'gemini'}
            options={[
              { value: 'gemini', label: 'Google Gemini (Free tier available)' },
              { value: 'openai', label: 'OpenAI (GPT-4o / GPT-4o-mini)' },
              { value: 'groq', label: 'Groq (Ultra-fast Llama 3.3)' },
              { value: 'openrouter', label: 'OpenRouter (Multi-model)' },
              { value: 'custom', label: 'Custom (Local / Ollama)' },
            ]}
            onChange={(v) => s.updateSetting('ai_provider', v as any)}
            aria-label="AI Provider"
          />
        </SettingRow>

        <SettingRow label="AI API Key" description="Your personal API key (stored securely on device)">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', maxWidth: '280px' }}>
            <input
              type="password"
              className="input"
              style={{ width: '100%', height: '36px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
              placeholder={s.ai_provider === 'gemini' ? 'Enter Google Gemini API key' : 'Enter API Key'}
              value={s.ai_api_key || ''}
              onChange={(e) => s.updateSetting('ai_api_key', e.target.value.trim())}
            />
          </div>
        </SettingRow>
      </SectionCard>
    </>
  );
}

function SyncSection({ s }: { s: SettingsState }) {
  return (
    <SectionCard icon={RefreshCw} title="Sync Settings">
      <SettingRow label="Auto-Sync" description="Automatically sync data when online" onClick={() => s.updateSetting('auto_sync', !s.auto_sync)}>
        <WiredSwitch
          checked={s.auto_sync}
          onChange={(v) => s.updateSetting('auto_sync', v)}
          aria-label="Auto-sync"
          soundEnabled={s.sound_enabled}
        />
      </SettingRow>

      <SettingRow label="Sync Interval" description="Minimum background interval between automatic syncs">
        <CustomSelect
          value={s.sync_interval_mins}
          options={[
            { value: 1, label: 'Every 1 min' },
            { value: 5, label: 'Every 5 min' },
            { value: 15, label: 'Every 15 min' },
            { value: 30, label: 'Every 30 min' },
            { value: 60, label: 'Every hour' },
          ]}
          onChange={(v) => s.updateSetting('sync_interval_mins', Number(v))}
          aria-label="Sync Interval"
        />
      </SettingRow>

      <SettingRow label="Sync on Tab Focus" description="Sync fresh data when returning to app tab" onClick={() => s.updateSetting('sync_on_app_focus', !s.sync_on_app_focus)}>
        <WiredSwitch
          checked={s.sync_on_app_focus}
          onChange={(v) => s.updateSetting('sync_on_app_focus', v)}
          aria-label="Sync on tab focus"
          soundEnabled={s.sound_enabled}
        />
      </SettingRow>

      <SettingRow label="Sync on Reconnect" description="Sync immediately when network reconnects" onClick={() => s.updateSetting('sync_on_reconnect', !s.sync_on_reconnect)}>
        <WiredSwitch
          checked={s.sync_on_reconnect}
          onChange={(v) => s.updateSetting('sync_on_reconnect', v)}
          aria-label="Sync on reconnect"
          soundEnabled={s.sound_enabled}
        />
      </SettingRow>
    </SectionCard>
  );
}

function AccessibilitySection({ s }: { s: SettingsState }) {
  return (
    <SectionCard icon={Accessibility} title="Accessibility">
      <SettingRow label="Reduce Motion" description="Disable all animations, overrides system preference" onClick={() => s.updateSetting('reduce_motion', !s.reduce_motion)}>
        <WiredSwitch checked={s.reduce_motion} onChange={(v) => s.updateSetting('reduce_motion', v)}
          aria-label="Reduce motion" soundEnabled={s.sound_enabled} />
      </SettingRow>
      <SettingRow label="High Contrast" description="Increase contrast for improved readability" onClick={() => s.updateSetting('high_contrast', !s.high_contrast)}>
        <WiredSwitch checked={s.high_contrast} onChange={(v) => s.updateSetting('high_contrast', v)}
          aria-label="High contrast" soundEnabled={s.sound_enabled} />
      </SettingRow>
      <SettingRow label="Large Text" description="Apply larger font sizes throughout the app" onClick={() => s.updateSetting('font_size', s.font_size === 'lg' ? 'md' : 'lg')}>
        <WiredSwitch checked={s.font_size === 'lg'} onChange={(v) => s.updateSetting('font_size', v ? 'lg' : 'md')}
          aria-label="Large text" soundEnabled={s.sound_enabled} />
      </SettingRow>
    </SectionCard>
  );
}

function AdvancedSection({ s }: { s: SettingsState }) {
  return (
    <SectionCard icon={SlidersHorizontal} title="Developer Options">
      <SettingRow label="Auto-Advance Delay" description="Delay before advancing to next card">
        <CustomSelect
          value={s.auto_advance_delay_ms}
          options={[
            { value: 1000, label: '1 second' },
            { value: 1500, label: '1.5 seconds' },
            { value: 2000, label: '2 seconds' },
            { value: 3000, label: '3 seconds' },
          ]}
          onChange={(v) => s.updateSetting('auto_advance_delay_ms', v)}
          aria-label="Auto-Advance Delay"
        />
      </SettingRow>
      <SettingRow label="Collapse Sidebar" description="Start with sidebar collapsed on desktop">
        <WiredSwitch checked={s.sidebar_collapsed} onChange={(v) => s.updateSetting('sidebar_collapsed', v)}
          aria-label="Sidebar collapsed" soundEnabled={s.sound_enabled} />
      </SettingRow>
    </SectionCard>
  );
}

function AboutSection({ s }: { s: SettingsState }) {
  const { user, signOut } = useAuthStore();
  const [isSignOutModalOpen, setIsSignOutModalOpen] = React.useState(false);
  const [isResetConfirming, setIsResetConfirming] = React.useState(false);

  const email = user?.email ?? 'Anonymous User';
  const provider = user?.app_metadata?.provider ?? 'google';
  const initial = email.charAt(0).toUpperCase();

  return (
    <>
      {/* User Profile & Account Info Card */}
      <SectionCard icon={UserIcon} title="Account & Profile">
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '16px',
          background: 'var(--color-bg-secondary)',
          borderRadius: '14px',
          border: '1px solid var(--color-border)',
          marginBottom: '20px'
        }}>
          <div style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-subtle))',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '22px',
            fontWeight: '700',
            flexShrink: 0,
            boxShadow: 'var(--shadow-sm)'
          }}>
            {initial}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '16px',
              fontWeight: '600',
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {email}
            </div>
            <div style={{
              fontSize: '13px',
              color: 'var(--color-text-tertiary)',
              marginTop: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              flexWrap: 'wrap'
            }}>
              <span>Provider: <strong style={{ color: 'var(--color-text-secondary)', textTransform: 'capitalize' }}>{provider}</strong></span>
              <span style={{ opacity: 0.4 }}>•</span>
              <span style={{ color: 'var(--color-correct)', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: '500' }}>
                <ShieldCheck size={14} /> Authenticated (Active Session)
              </span>
            </div>
          </div>
        </div>

        <div className={styles.dangerZone}>
          <div>
            <div className={styles.dangerLabel}>Sign Out & Clear Session</div>
            <div className={styles.dangerDesc}>Logs out and completely wipes local storage data</div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)', gap: '6px' }}
            onClick={() => setIsSignOutModalOpen(true)}
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      </SectionCard>

      {/* Custom Redesigned Sign Out Confirmation Modal */}
      <AnimatePresence>
        {isSignOutModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              background: 'rgba(0, 0, 0, 0.65)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px'
            }}
            onClick={() => setIsSignOutModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 10 }}
              transition={{ type: 'spring', stiffness: 450, damping: 30 }}
              style={{
                width: '100%',
                maxWidth: '420px',
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: '20px',
                padding: '24px',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: '#ef4444',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <LogOut size={22} />
                </div>
                <div>
                  <h3 style={{ fontSize: '17px', fontWeight: '700', color: 'var(--color-text-primary)', margin: 0 }}>
                    Sign Out & Clear Session
                  </h3>
                  <p style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', margin: '2px 0 0 0' }}>
                    Are you sure you want to sign out?
                  </p>
                </div>
              </div>

              <p style={{ fontSize: '13.5px', color: 'var(--color-text-secondary)', lineHeight: '1.5', margin: 0 }}>
                This will log you out of your account and purge all locally cached data from this browser for security.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ borderRadius: '10px', padding: '8px 16px' }}
                  onClick={() => setIsSignOutModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{
                    background: '#ef4444',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '8px 18px',
                    fontWeight: '600',
                    boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)'
                  }}
                  onClick={() => {
                    setIsSignOutModalOpen(false);
                    void signOut();
                  }}
                >
                  Sign Out
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* App System Details */}
      <SectionCard icon={Info} title="About Noledge">
        <div className={styles.aboutGrid}>
          <div className={styles.aboutKv}><span className={styles.aboutKey}>Version</span><span className={styles.aboutVal}>v1.0.0</span></div>
          <div className={styles.aboutKv}><span className={styles.aboutKey}>Build</span><span className={styles.aboutVal}>stable</span></div>
          <div className={styles.aboutKv}><span className={styles.aboutKey}>Storage</span><span className={styles.aboutVal}>IndexedDB</span></div>
          <div className={styles.aboutKv}><span className={styles.aboutKey}>Sync</span><span className={styles.aboutVal}>Supabase</span></div>
        </div>
        <p className={styles.aboutDesc}>
          Spaced repetition, synced to your Obsidian vault and GitHub repos.
          All data is stored locally on your device and never shared.
        </p>
        <div className={styles.dangerZone}>
          <div>
            <div className={styles.dangerLabel}>Reset Settings</div>
            <div className={styles.dangerDesc}>Restore all settings to their default values</div>
          </div>
          {isResetConfirming ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setIsResetConfirming(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{ background: 'var(--color-danger)', color: '#fff', border: 'none' }}
                onClick={() => {
                  setIsResetConfirming(false);
                  s.resetToDefaults();
                }}
              >
                Confirm Reset
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)', opacity: 0.8 }}
              onClick={() => setIsResetConfirming(true)}
            >
              Reset to Defaults
            </button>
          )}
        </div>
      </SectionCard>
    </>
  );
}

// =============================================================================
// Settings Page — single-panel, tab driven by ?tab= URL param
// =============================================================================

function SettingsPageContent() {
  const s = useSettingsStore();
  const { user, isLoading } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeId = (searchParams.get('tab') ?? 'appearance') as SectionId;
  const active = NAV.find((n) => n.id === activeId) ?? NAV[0];

  useEffect(() => {
    if (!isLoading && !user) {
      if (typeof window !== 'undefined') {
        const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        router.replace(`/auth?redirect=${returnUrl}`);
      }
    }
  }, [isLoading, user, router]);

  if (!isLoading && !user) {
    return (
      <div className={styles.settings} style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          <ShieldCheck size={36} style={{ margin: '0 auto 12px', color: 'var(--color-accent)' }} />
          <p style={{ fontSize: '14px' }}>Redirecting to sign in...</p>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    switch (activeId) {
      case 'appearance':    return <AppearanceSection s={s} />;
      case 'study':         return <StudySection s={s} />;
      case 'sync':          return <SyncSection s={s} />;
      case 'import':        return <><SectionCard icon={Download} title="Sources"><SourceManager /></SectionCard></>;
      case 'accessibility': return <AccessibilitySection s={s} />;
      case 'advanced':      return <AdvancedSection s={s} />;
      case 'about':         return <AboutSection s={s} />;
    }
  };

  const ActiveIcon = active.icon;

  return (
    <PageTransition>
      <div className={styles.settings}>
        {/* Page header */}
        <div className={styles.headerCard}>
          <div className={styles.headerGlow} />
          <div className={styles.headerLeft}>
            <div className={styles.eyebrowRow}>
              <span className={styles.eyebrowBadge}>
                <ActiveIcon size={12} strokeWidth={2} /> {active.eyebrow}
              </span>
            </div>
            <h1 className={styles.headerTitle}>{active.label}</h1>
            <p className={styles.headerSubtitle}>{active.subtitle}</p>
          </div>
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeId}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className={styles.content}
          >
            {renderContent()}
          </motion.div>
        </AnimatePresence>
      </div>
    </PageTransition>
  );
}

export default function SettingsPage() {
  return (
    <React.Suspense fallback={<div className={styles.settings} />}>
      <SettingsPageContent />
    </React.Suspense>
  );
}