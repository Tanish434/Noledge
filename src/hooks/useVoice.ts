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
  const hasNativeSpeech = typeof window !== 'undefined' && (
    'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  );
  const isSupported = typeof window !== 'undefined' && (
    hasNativeSpeech || (Boolean(navigator?.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined')
  );

  // ─── State ────────────────────────────────────────────────────────────
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [finalTranscript, setFinalTranscript] = useState<string>('');
  const [confidence, setConfidence] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (e) { /* ignore */ }
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

    // MediaRecorder recording fallback (e.g. Firefox)
    if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          mediaStreamRef.current = stream;
          audioChunksRef.current = [];

          let mimeType = 'audio/webm';
          if (typeof MediaRecorder !== 'undefined') {
            if (!MediaRecorder.isTypeSupported('audio/webm') && MediaRecorder.isTypeSupported('audio/ogg')) {
              mimeType = 'audio/ogg';
            }
          }

          const mr = new MediaRecorder(stream, { mimeType });
          mediaRecorderRef.current = mr;

          mr.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              audioChunksRef.current.push(e.data);
            }
          };

          mr.onstop = () => {
            // Cleanly stop media tracks now that recorder is done
            if (mediaStreamRef.current) {
              try {
                mediaStreamRef.current.getTracks().forEach((track) => track.stop());
              } catch {}
              mediaStreamRef.current = null;
            }

            const chunks = [...audioChunksRef.current];
            audioChunksRef.current = [];
            if (chunks.length === 0) {
              setState('done');
              return;
            }

            const recordedBlob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
            setState('processing');

            const reader = new FileReader();
            reader.onloadend = async () => {
              const base64Data = (reader.result as string)?.split(',')[1];
              if (!base64Data) {
                setState('done');
                return;
              }

              try {
                const res = await fetch('/api/agent/transcribe', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ audio: base64Data, mimeType: recordedBlob.type }),
                });
                if (res.ok) {
                  const data = await res.json();
                  const txt = String(data.text || '').trim();
                  if (txt) {
                    setTranscript(txt);
                    setFinalTranscript(txt);
                    setConfidence(0.95);
                  }
                }
              } catch (txErr) {
                log.warn('transcribe_fallback_failed', 'Failed to transcribe audio blob', { error: String(txErr) });
              } finally {
                setState('done');
              }
            };
            reader.readAsDataURL(recordedBlob);
          };

          mr.start(100);
        })
        .catch((err) => {
          log.warn('mic_access_warning', 'Mic permission requested or unavailable', { error: String(err) });
          setError('Microphone access denied or unavailable.');
          setState('error');
        });
    }

    return true;
  }, [isSupported, hasNativeSpeech, createRecognition]);

  const stop = useCallback((): void => {
    if (recognitionRef.current && hasNativeSpeech) {
      setState('processing');
      try { recognitionRef.current.stop(); } catch (e) { setState('done'); }
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      setState('processing');
      try {
        if (typeof mediaRecorderRef.current.requestData === 'function') {
          mediaRecorderRef.current.requestData();
        }
        mediaRecorderRef.current.stop();
      } catch (e) {
        setState('done');
      }
    }
  }, [hasNativeSpeech]);

  const reset = useCallback((): void => {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (e) { /* ignore */ }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (e) { /* ignore */ }
      mediaRecorderRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    audioChunksRef.current = [];
    setTranscript('');
    setFinalTranscript('');
    setConfidence(0);
    setError(null);
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
