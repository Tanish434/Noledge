/**
 * @file stores/settingsStore.ts
 * @description Zustand store for user preferences and settings.
 *
 * All settings are persisted to localStorage using Zustand's persist middleware.
 * Settings are intentionally small and serializable (no functions, no class instances)
 * so they can be safely JSON-serialized to localStorage.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ThemePreference } from '@/hooks/useTheme';
import { DEFAULT_SESSION_CARD_LIMIT } from '@/lib/constants';

// =============================================================================
// Settings Shape
// =============================================================================

export interface UserSettings {
  theme: ThemePreference;
  haptics_enabled: boolean;
  sound_enabled: boolean;
  voice_language: string;        // BCP 47 language tag, e.g. 'en-US'
  auto_advance: boolean;         // Auto-advance to next card after correct answer
  auto_advance_delay_ms: number; // Delay before auto-advance (ms)
  show_progress_bar: boolean;
  show_session_timer: boolean;
  default_session_limit: number; // Default card limit for study sessions
  shuffle_options: boolean;      // Shuffle MCQ options on display
  show_mastered: boolean;        // Include mastered cards in review-all sessions
  font_size: 'sm' | 'md' | 'lg'; // Question text size preference
  font_family: 'sans' | 'mono' | 'serif' | 'rounded' | 'slab' | 'dyslexic'; // Typography style preference
  compact_mode: boolean;        // Compact padding for study cards & lists
  high_contrast: boolean;       // High contrast borders & labels
  card_glow: boolean;           // Subtle card border glow effect
  reduce_motion: boolean;        // Override for GSAP animations (manual, separate from prefers-reduced-motion)
  sidebar_collapsed: boolean;    // Sidebar collapse state for desktop
  sidebar_expand_on_hover: boolean; // Auto-expand sidebar on hover when collapsed
  auto_sync: boolean;            // Enable automatic background synchronization
  sync_interval_mins: number;   // Minimum gap between background sync attempts
  sync_on_app_focus: boolean;    // Sync when returning to tab/app
  sync_on_reconnect: boolean;    // Sync immediately when internet reconnects
  ai_provider: 'gemini' | 'openai' | 'groq' | 'openrouter' | 'custom'; // AI Provider for AI Tutor
  ai_api_key: string;            // User's custom AI API key
  ai_model: string;              // Model ID (e.g. gemini-3.5-flash-lite, gemini-3.5-flash)
  ai_custom_endpoint?: string;   // Optional custom OpenAI-compatible endpoint
}

export interface SettingsState extends UserSettings {
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
  resetToDefaults: () => void;
}

// =============================================================================
// Default Settings
// =============================================================================

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'system',
  haptics_enabled: true,
  sound_enabled: true,
  voice_language: 'en-US',
  auto_advance: false,
  auto_advance_delay_ms: 1500,
  show_progress_bar: true,
  show_session_timer: true,
  default_session_limit: DEFAULT_SESSION_CARD_LIMIT,
  shuffle_options: true,
  show_mastered: false,
  font_size: 'md',
  font_family: 'sans',
  compact_mode: false,
  high_contrast: false,
  card_glow: true,
  reduce_motion: false,
  sidebar_collapsed: false,
  sidebar_expand_on_hover: false,
  auto_sync: true,
  sync_interval_mins: 5,
  sync_on_app_focus: true,
  sync_on_reconnect: true,
  ai_provider: 'gemini',
  ai_api_key: '',
  ai_model: 'gemini-3.5-flash-lite',
  ai_custom_endpoint: '',
};

// =============================================================================
// Store
// =============================================================================

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,

      updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
        set({ [key]: value } as Partial<SettingsState>);
      },

      resetToDefaults: () => {
        set(DEFAULT_SETTINGS);
      },
    }),
    {
      name: 'noledge:settings',
      storage: createJSONStorage(() => localStorage),
      // Only persist the settings values, not the action functions.
      // NOTE: ai_api_key is intentionally never persisted (security).
      partialize: (state) => ({
        theme: state.theme,
        haptics_enabled: state.haptics_enabled,
        sound_enabled: state.sound_enabled,
        voice_language: state.voice_language,
        auto_advance: state.auto_advance,
        auto_advance_delay_ms: state.auto_advance_delay_ms,
        show_progress_bar: state.show_progress_bar,
        show_session_timer: state.show_session_timer,
        default_session_limit: state.default_session_limit,
        shuffle_options: state.shuffle_options,
        show_mastered: state.show_mastered,
        font_size: state.font_size,
        font_family: state.font_family,
        compact_mode: state.compact_mode,
        high_contrast: state.high_contrast,
        card_glow: state.card_glow,
        reduce_motion: state.reduce_motion,
        sidebar_collapsed: state.sidebar_collapsed,
        sidebar_expand_on_hover: state.sidebar_expand_on_hover,
        auto_sync: state.auto_sync,
        sync_interval_mins: state.sync_interval_mins,
        sync_on_app_focus: state.sync_on_app_focus,
        sync_on_reconnect: state.sync_on_reconnect,
        ai_provider: state.ai_provider,
        ai_model: state.ai_model,
        ai_custom_endpoint: state.ai_custom_endpoint,
      }),
    }
  )
);
