/**
 * globals.d.ts
 * Global ambient type declarations for Noledge.
 *
 * Types declared here are globally available without imports.
 * Used for:
 *   - Web APIs not fully typed in @types/node / lib.dom.d.ts for this TS version
 *   - Browser vendor-prefixed APIs (webkit*, moz*)
 *   - Environment variable typing
 */

// =============================================================================
// Web Speech API
// =============================================================================
// SpeechRecognition and SpeechSynthesis are in lib.dom.d.ts from TS 4.4+,
// but some build configs exclude them. Declaring here as a safety net.

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

declare class SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;

  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onnomatch: ((this: SpeechRecognition, ev: Event) => void) | null;

  start(): void;
  stop(): void;
  abort(): void;
}

// Vendor-prefixed webkit version (Chrome, older Safari)
declare class webkitSpeechRecognition extends SpeechRecognition {}

interface Window {
  SpeechRecognition: typeof SpeechRecognition;
  webkitSpeechRecognition: typeof webkitSpeechRecognition;
}

// =============================================================================
// Navigator.vibrate (Vibration API)
// =============================================================================
// Present on mobile browsers but may be missing from the TS target lib

interface Navigator {
  vibrate(pattern: number | number[]): boolean;
}

// =============================================================================
// CSS Custom Properties for GSAP
// =============================================================================
// Allow GSAP to set CSS variables via gsap.set(el, { '--custom-prop': value })
// This is a GSAP-specific pattern, not standard TS DOM types.
interface CSSStyleDeclaration {
  [key: `--${string}`]: string;
}
