/**
 * @file lib/sounds.ts
 * @description Procedural sound effects — Web Audio API, zero dependencies.
 *
 * Mobile Audio Reliability:
 * - iOS Safari requires AudioContext to be created AND resumed SYNCHRONOUSLY
 *   inside a native touchstart/pointerdown handler. async/await chains do NOT
 *   satisfy the requirement — the context must be created + resume() called
 *   in the same synchronous call stack as the gesture.
 * - unlockSync() creates the context and calls resume() synchronously — this
 *   is the ONLY reliable way to unlock audio on iOS Safari.
 * - Android Chrome works with async resume() but also benefits from sync unlock.
 * - haptics_enabled setting is respected by checking settingsStore directly.
 */

import { useSettingsStore } from '@/stores/settingsStore';

class SoundEngine {
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private readonly TARGET_GAIN = 0.38;
  private warmedUp = false;
  private unlocked = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && this.audioCtx && this.audioCtx.state === 'suspended') {
          this.unlocked = false;
        }
      };
      window.addEventListener('visibilitychange', handleVisibilityChange, { passive: true });
      window.addEventListener('pageshow', handleVisibilityChange, { passive: true });
    }
  }

  // ─── Synchronous unlock — MUST be called directly inside touchstart/pointerdown ───
  // iOS Safari & Android Chrome require AudioContext to be created AND resumed
  // SYNCHRONOUSLY inside a native touchstart/pointerdown handler.
  unlockSync() {
    if (typeof window === 'undefined') return;

    try {
      // 1. iOS 17+ WebKit AudioSession API — route audio to Media channel instead of Ambient
      // This bypasses the physical iPhone Ring/Silent switch!
      if ('audioSession' in navigator) {
        try {
          (navigator as unknown as { audioSession: { type: string } }).audioSession.type = 'playback';
        } catch {
          // silently ignore if unsupported
        }
      }

      // 2. Instantiate AudioContext synchronously if null
      if (!this.audioCtx) {
        this.audioCtx = new (
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        )();
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.gain.value = 0;
        this.masterGain.connect(this.audioCtx.destination);
      }

      // 3. Synchronously call resume() inside native event stack
      if (this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume();
      }

      // 4. Play a 1-frame silent buffer source to prime WebKit hardware output buffer
      if (!this.unlocked && this.audioCtx && this.masterGain) {
        const silentBuffer = this.audioCtx.createBuffer(1, 1, 22050);
        const source = this.audioCtx.createBufferSource();
        source.buffer = silentBuffer;
        source.connect(this.masterGain);
        source.start(0);
        this.unlocked = true;
        this.warmUp();
      } else if (this.audioCtx.state === 'running') {
        this.unlocked = true;
        this.warmUp();
      }
    } catch {
      // silently ignore
    }
  }

  // Alias for backward compat
  unlock() {
    this.unlockSync();
  }

  private warmUp() {
    if (this.warmedUp || !this.audioCtx || !this.masterGain) return;
    this.warmedUp = true;
    const now = this.audioCtx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(0, now);
    this.masterGain.gain.linearRampToValueAtTime(this.TARGET_GAIN, now + 0.04);
  }

  /** Returns the shared AudioContext if it's initialized and ready. */
  getAudioCtx(): AudioContext | null {
    if (this.audioCtx?.state === 'running') return this.audioCtx;
    return null;
  }

  // ─── Internal helper: prepare context synchronously before playback ───────
  private prepareCtx(): boolean {
    this.unlockSync();
    if (!this.audioCtx || !this.masterGain) return false;
    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume();
    }
    this.warmUp();
    return true;
  }

  // ─── Haptics — respects haptics_enabled setting ────────────────────────────
  vibrate(pattern: number | number[] = 10) {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    const { haptics_enabled } = useSettingsStore.getState();
    if (!haptics_enabled) return;
    if (!('vibrate' in navigator)) return;
    try { navigator.vibrate(pattern); } catch { /* silently ignore */ }
  }

  // ─── Apple iOS picker scroll tick ─────────────────────────────────────────
  playTick() {
    const { sound_enabled } = useSettingsStore.getState();
    if (!sound_enabled) return;
    if (!this.prepareCtx() || !this.audioCtx || !this.masterGain) return;

    const ctx = this.audioCtx;
    const t = ctx.currentTime;
    const sr = ctx.sampleRate;

    // Layer 1: click transient — 3ms high-pass noise
    const tFrames = Math.floor(sr * 0.003);
    const tbuf = ctx.createBuffer(1, tFrames, sr);
    const tdata = tbuf.getChannelData(0);
    for (let i = 0; i < tFrames; i++) {
      tdata[i] = (Math.random() * 2 - 1) * (1 - i / tFrames);
    }
    const tsrc = ctx.createBufferSource();
    tsrc.buffer = tbuf;
    const thp = ctx.createBiquadFilter();
    thp.type = 'highpass';
    thp.frequency.value = 900;
    const tg = ctx.createGain();
    tg.gain.value = 0.55;
    tsrc.connect(thp);
    thp.connect(tg);
    tg.connect(this.masterGain);
    tsrc.start(t);

    // Layer 2: resonant body — 750→600 Hz sine, 22ms decay
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(750, t);
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.022);
    og.gain.setValueAtTime(0.45, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.022);
    osc.connect(og);
    og.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.025);
  }

  // ─── Settings switch toggle ────────────────────────────────────────────────
  playToggle() {
    const { sound_enabled } = useSettingsStore.getState();
    if (!sound_enabled) return;
    if (!this.prepareCtx() || !this.audioCtx || !this.masterGain) return;

    const t = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(540, t);
    osc.frequency.linearRampToValueAtTime(440, t + 0.05);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.85, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  // ─── Theme change shimmer ──────────────────────────────────────────────────
  playThemeChange() {
    const { sound_enabled } = useSettingsStore.getState();
    if (!sound_enabled) return;
    if (!this.prepareCtx() || !this.audioCtx || !this.masterGain) return;

    const t = this.audioCtx.currentTime;
    const pairs: [number, number][] = [
      [523.25, 0.48],
      [784.00, 0.35],
      [1046.5, 0.22],
    ];
    pairs.forEach(([freq, peak]) => {
      const osc = this.audioCtx!.createOscillator();
      const gain = this.audioCtx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.45);
    });
  }

  // ─── Correct answer ───────────────────────────────────────────────────────
  playCorrect() {
    const { sound_enabled } = useSettingsStore.getState();
    if (!sound_enabled) return;
    if (!this.prepareCtx() || !this.audioCtx || !this.masterGain) return;

    const t = this.audioCtx.currentTime;
    const osc1 = this.audioCtx.createOscillator();
    const osc2 = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc1.type = 'sine'; osc2.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, t);
    osc1.frequency.exponentialRampToValueAtTime(1046.50, t + 0.1);
    osc2.frequency.setValueAtTime(659.25, t);
    osc2.frequency.exponentialRampToValueAtTime(1318.51, t + 0.1);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.45, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc1.connect(gain); osc2.connect(gain);
    gain.connect(this.masterGain);
    osc1.start(t); osc2.start(t);
    osc1.stop(t + 0.3); osc2.stop(t + 0.3);
  }

  // ─── Incorrect answer ─────────────────────────────────────────────────────
  playIncorrect() {
    const { sound_enabled } = useSettingsStore.getState();
    if (!sound_enabled) return;
    if (!this.prepareCtx() || !this.audioCtx || !this.masterGain) return;

    const t = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    const filter = this.audioCtx.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.15);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(700, t);
    filter.frequency.exponentialRampToValueAtTime(280, t + 0.15);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.32, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(filter); filter.connect(gain); gain.connect(this.masterGain);
    osc.start(t); osc.stop(t + 0.2);
  }

  // ─── Session complete ─────────────────────────────────────────────────────
  playComplete() {
    const { sound_enabled } = useSettingsStore.getState();
    if (!sound_enabled) return;
    if (!this.prepareCtx() || !this.audioCtx || !this.masterGain) return;

    const t = this.audioCtx.currentTime;
    const ctx = this.audioCtx;
    [
      { freq: 523.25, time: 0 },
      { freq: 659.25, time: 0.15 },
      { freq: 783.99, time: 0.3 },
      { freq: 1046.50, time: 0.45 },
    ].forEach(({ freq, time }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const s = t + time;
      gain.gain.setValueAtTime(0, s);
      gain.gain.linearRampToValueAtTime(0.3, s + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, s + 0.4);
      osc.connect(gain); gain.connect(this.masterGain!);
      osc.start(s); osc.stop(s + 0.4);
    });
  }
}

export const sounds = new SoundEngine();


