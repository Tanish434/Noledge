/**
 * @file hooks/useVoice.ts
 * @description Hook for Web Speech API voice recognition in voice-type questions.
 *
 * Voice questions in Noledge work as follows:
 *   1. User taps the microphone button → recording starts
 *   2. Web Speech API streams recognized text to a display area in real-time
 *   3. After silence (or manual stop), recognition ends
 *   4. The final transcript is passed to the answer scoring function
 *
 * Browser support for Web Speech API:
 *   ✅ Chrome (desktop + Android) — best support, full real-time streaming
 *   ✅ Edge (desktop) — good support
 *   ⚠️  Safari (desktop + iOS) — supported from iOS 13 / macOS 14.4, but
 *       requires HTTPS in production and behaves differently (may require
 *       explicit language setting)
 *   ❌ Firefox — not supported (Mozilla's policy position on the API)
 *
 * Graceful degradation: When voice is not supported, the voice question
 * type falls back to a typing interface. The QuestionRenderer checks
 * isSupported from this hook to decide which UI to show.
 *
 * Privacy note: Speech recognition on Chrome Android sends audio to Google's
 * servers unless the device has offline speech recognition models installed.
 * We display a privacy notice in the voice question UI.
 */

'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { createLogger } from '@/lib/logger';

const log = createLogger('ui');

// =============================================================================
// Types
// =============================================================================

/**
 * VoiceState — current state of the voice recognition system.
 *
 * 'idle'         — Not recording, no result
 * 'listening'    — Actively recording and transcribing
 * 'processing'   — Recognition ended, finalizing transcript
 * 'done'         — Transcription complete, result available
 * 'error'        — An error occurred
 * 'not-supported' — Web Speech API not available in this browser
 */
export type VoiceState = 'idle' | 'listening' | 'processing' | 'done' | 'error' | 'not-supported';

/**
 * UseVoiceReturn — return value of useVoice().
 *
 * Fields:
 *   state          — Current voice recognition state
 *   transcript     — Current recognized text (updates in real-time while listening)
 *   finalTranscript — The finalized transcript after recognition ends
 *   confidence     — Recognition confidence score (0-1), from the API
 *   start          — Start recording. Returns false if not supported or already listening.
 *   stop           — Stop recording and finalize the transcript.
 *   reset          — Reset to idle state, clearing transcript.
 *   isSupported    — Whether Web Speech API is available
 *   error          — Error message if state === 'error'
 */
export interface UseVoiceReturn {
  state: VoiceState;
  transcript: string;
  finalTranscript: string;
  confidence: number;
  start: () => boolean;
  stop: () => void;
  reset: () => void;
  isSupported: boolean;
  error: string | null;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * useVoice — Web Speech API wrapper for voice question recognition.
 *
 * @param language  BCP 47 language tag for recognition (e.g. 'en-US').
 *                  Defaults to 'en-US'. Should match the question's language.
 *
 * @returns UseVoiceReturn
 */
export function useVoice(language: string = 'en-US'): UseVoiceReturn {
  const isSupported = typeof window !== 'undefined' && (
    'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  );
  const hasNativeSpeech = isSupported;

  // ─── State ────────────────────────────────────────────────────────────
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [finalTranscript, setFinalTranscript] = useState<string>('');
  const [confidence, setConfidence] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const createRecognition = useCallback((): SpeechRecognition | null => {
    if (!hasNativeSpeech) return null;

    const SpeechRecognitionAPI =
      (window as Window & { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ||
      (window as Window & { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) return null;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = language;

    recognition.onresult = (event: SpeechRecognitionEvent): void => {
      let interimText = '';
      let finalText = '';
      let bestConfidence = 0;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        const conf = result[0].confidence;

        if (result.isFinal) {
          finalText += text;
          bestConfidence = Math.max(bestConfidence, conf);
        } else {
          interimText += text;
        }
      }

      setTranscript(finalText || interimText);

      if (finalText) {
        setFinalTranscript((prev) => prev + finalText);
        setConfidence(bestConfidence);
      }
    };

    recognition.onend = (): void => {
      setState((prev) => (prev === 'listening' ? 'done' : prev));
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent): void => {
      const errorCode = event.error;
      log.warn('voice_recognition_error', `Speech recognition error: ${errorCode}`);
      if (errorCode !== 'no-speech') {
        setError(`Voice recognition error: ${errorCode}`);
        setState('error');
      }
    };

    return recognition;
  }, [hasNativeSpeech, language]);

  // ─── API Functions ────────────────────────────────────────────────────

  const start = useCallback((): boolean => {
    if (!isSupported) return false;

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (e) { /* ignore */ }
    }

    setTranscript('');
    setFinalTranscript('');
    setConfidence(0);
    setError(null);
    setState('listening');

    if (hasNativeSpeech) {
      const recognition = createRecognition();
      if (recognition) {
        recognitionRef.current = recognition;
        try {
          recognition.start();
          return true;
        } catch (e) {
          log.warn('voice_start_warning', 'Native speech start warning', { error: String(e) });
        }
      }
    }

    if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          mediaStreamRef.current = stream;
        })
        .catch((err) => {
          log.warn('mic_access_warning', 'Mic permission requested or unavailable', { error: String(err) });
        });
    }

    return true;
  }, [isSupported, hasNativeSpeech, createRecognition]);

  const stop = useCallback((): void => {
    if (recognitionRef.current && hasNativeSpeech) {
      setState('processing');
      try { recognitionRef.current.stop(); } catch (e) { setState('done'); }
    } else {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      setState('done');
    }
  }, [hasNativeSpeech]);

  const reset = useCallback((): void => {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (e) { /* ignore */ }
      recognitionRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setTranscript('');
    setFinalTranscript('');
    setConfidence(0);
    setError(null);
    setState('idle');
  }, []);

  // ─── Cleanup on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  return {
    state,
    transcript,
    finalTranscript,
    confidence,
    start,
    stop,
    reset,
    isSupported,
    error,
  };
}
