'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import {
  Sparkles,
  X,
  Send,
  Mic,
  MicOff,
  Settings as SettingsIcon,
  Play,
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
  Clock,
  Share2,
  Paperclip,
  Trash2,
  Search,
  Check,
  FileText,
  Copy,
  Download,
  User,
  Wand2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useQuestionStore } from '@/stores/questionStore';
import { useDeckStore } from '@/stores/deckStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { renderMarkdownToHtml } from '@/utils/sanitize';
import { cn } from '@/utils/cn';
import { OrbEngine } from '@/lib/orb/orb';
import { ORB_VARIANT_LIST } from '@/lib/orb/orb-variants';
import { executeSiteAction, judgeCodeSnippet } from '@/lib/agentTools';
import { generatePrefixedId } from '@/utils/id';
import { cleanForSpeech, cleanChemistryAndLatex } from '@/utils/speechCleaner';
import { CustomSelect } from './CustomSelect';
import styles from './AiTutorDrawer.module.css';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  speaker?: string;
  content: string;
  timestamp?: number;
}

interface ChatSession {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}

interface AttachedFile {
  file: File;
  name: string;
  size: string;
  type: string;
}

const AVATAR_CHOICES = ['⚔️', '🛡️', '⚡', '🔮', '🧠', '🚀', '🎯', '💎', '🦊', '🌌', '🌍', '🌎', '🔥', '⭐', '🤖'];

const ORB_VARIANT_OPTIONS = ORB_VARIANT_LIST.map((v) => ({
  value: v.key,
  label: v.label,
  badge: v.key.toUpperCase(),
}));

const AI_MODEL_OPTIONS = [
  { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite (Fastest & Free Tier)', badge: 'FREE' },
  { value: 'gemini-flash-lite-latest', label: 'Gemini Flash Lite (Latest Stable)', badge: 'STABLE' },
  { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', badge: 'FAST' },
  { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (Balanced Multimodal)', badge: 'BALANCED' },
  { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (Deep Reasoning & Tools)', badge: 'ELITE' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', badge: 'V2.5' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Deep Architectural Reasoning)', badge: 'PRO' },
];

const STT_OPTIONS = [
  { value: 'livekit', label: 'LiveKit Deepgram Nova-3 (English — <150ms)', badge: '<150ms' },
  { value: 'speechmatics', label: 'Speechmatics (English — Broadcast Precision)', badge: 'HD' },
  { value: 'elevenlabs', label: 'ElevenLabs Scribe (English)', badge: 'SCRIBE' },
  { value: 'browser', label: 'Browser Web Speech API (Firefox/Chrome)', badge: 'NATIVE' },
];

const TTS_OPTIONS = [
  { value: 'cartesia', label: 'Cartesia Sonic-3 (Ultra-low Latency <90ms)', badge: '<90ms' },
  { value: 'elevenlabs', label: 'ElevenLabs Turbo v2.5 (Studio Expressive)', badge: 'STUDIO' },
  { value: 'livekit', label: 'LiveKit Cloud Voice (Zero-Lag Streaming)', badge: 'CLOUD' },
  { value: 'browser', label: 'Browser Natural SpeechSynthesis', badge: 'LOCAL' },
];

const VOICE_OPTIONS = [
  { value: 'executive', label: 'Corporate Executive Assistant (Default)' },
  { value: 'academic', label: 'Academic Computer Science Tutor' },
  { value: 'sarah', label: 'Sarah (Natural, Warm & Conversational)' },
  { value: 'rachel', label: 'Rachel (Professional, Direct & Articulate)' },
  { value: 'casper', label: 'Casper (Calm, Reflective & Analytical)' },
  { value: 'adam', label: 'Adam (Clear, Confident & Technical)' },
  { value: 'bella', label: 'Bella (Dynamic, High-Energy)' },
];

export default function AiTutorDrawer() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<'chat' | 'history' | 'settings'>('chat');
  const [showShareModal, setShowShareModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);

  // User Profile
  const [userName, setUserName] = useState('Kirito');
  const [userAvatar, setUserAvatar] = useState('⚔️');
  const [speakerVerified, setSpeakerVerified] = useState(true);

  const [inputQuery, setInputQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentState, setAgentState] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [isMicActive, setIsMicActive] = useState(false);
  const [selectedShader, setSelectedShader] = useState('shdr-31');
  const [isJudgingCode, setIsJudgingCode] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [isVoiceOutputEnabled, setIsVoiceOutputEnabled] = useState(true);

  // History & Sessions State
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [historySearchQuery, setHistorySearchQuery] = useState('');

  // Attachments State
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);

  // Settings local state
  const { ai_model, updateSetting } = useSettingsStore();
  const [ocrEnabled, setOcrEnabled] = useState(true);
  const [sttEngine, setSttEngine] = useState('livekit');
  const [ttsEngine, setTtsEngine] = useState('cartesia');
  const [voicePersona, setVoicePersona] = useState('executive');

  // Question & Deck Store context
  const { getCurrentQuestion, currentCardIndex, activeSession, nextCard, previousCard } = useQuestionStore();
  const currentQuestion = getCurrentQuestion();
  const { decks } = useDeckStore();

  // Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const orbRef = useRef<OrbEngine | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lkRoomRef = useRef<any>(null);
  const micTrackRef = useRef<any>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const hasAttemptedTokenRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const inputQueryRef = useRef(inputQuery);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const isSpaceKeyDownRef = useRef(false);
  const isRecordingRef = useRef(false);
  const startRecordingRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const stopRecordingRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const speakingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    inputQueryRef.current = inputQuery;
  }, [inputQuery]);

  // Unique key helper
  const generateMsgId = () => generatePrefixedId('msg');

  // 1. Load User Profile from storage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const savedProfile = localStorage.getItem('aliph1_user_profile');
      if (savedProfile) {
        const p = JSON.parse(savedProfile);
        if (p.name) setUserName(p.name);
        if (p.avatar) setUserAvatar(p.avatar);
      }
    } catch {
      // Ignore
    }
  }, []);

  // 2. Initialize or load initial session
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedSessionId = localStorage.getItem('aliph1_session_id');
    if (savedSessionId) {
      setCurrentSessionId(savedSessionId);
      const savedMsgs = localStorage.getItem(`aliph1_msgs_${savedSessionId}`);
      if (savedMsgs) {
        try {
          setMessages(JSON.parse(savedMsgs));
        } catch {
          setMessages([]);
        }
      }
    } else {
      const newSid = `sess_${Math.floor(Date.now() / 1000)}_${Math.random().toString(36).substring(2, 8)}`;
      setCurrentSessionId(newSid);
      localStorage.setItem('aliph1_session_id', newSid);
    }
  }, []);

  // 3. Persist active messages & update session metadata
  useEffect(() => {
    if (typeof window === 'undefined' || !currentSessionId) return;

    // Save active messages
    try {
      localStorage.setItem(`aliph1_msgs_${currentSessionId}`, JSON.stringify(messages));
    } catch {
      // Storage full
    }

    if (messages.length > 0) {
      try {
        const rawSessions = localStorage.getItem('aliph1_all_sessions');
        let sessionList: ChatSession[] = rawSessions ? JSON.parse(rawSessions) : [];

        const firstUserMsg = messages.find((m) => m.role === 'user');
        const title = firstUserMsg ? firstUserMsg.content.replace(/<[^>]*>?/gm, '').slice(0, 36) : 'New Discussion';

        const existingIdx = sessionList.findIndex((s) => s.id === currentSessionId);
        if (existingIdx >= 0) {
          sessionList[existingIdx] = {
            ...sessionList[existingIdx],
            title: sessionList[existingIdx].title || title,
            updated_at: Math.floor(Date.now() / 1000),
            message_count: messages.length,
          };
        } else {
          sessionList.unshift({
            id: currentSessionId,
            title,
            created_at: Math.floor(Date.now() / 1000),
            updated_at: Math.floor(Date.now() / 1000),
            message_count: messages.length,
          });
        }
        localStorage.setItem('aliph1_all_sessions', JSON.stringify(sessionList));
        setSessions(sessionList);
      } catch {
        // Ignore
      }
    }
  }, [messages, currentSessionId]);

  // 4. Open drawer event listener
  useEffect(() => {
    const handleOpenAi = () => {
      setIsOpen(true);
      setActivePanel('chat');
    };
    window.addEventListener('noledge_open_ai_tutor', handleOpenAi);
    return () => {
      window.removeEventListener('noledge_open_ai_tutor', handleOpenAi);
    };
  }, []);

  // 5. Sync data-ai-drawer-open attribute and strictly lock background scroll & overscroll
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('noledge-ai-drawer-state', { detail: { open: isOpen } }));
    }
    if (typeof document !== 'undefined') {
      if (isOpen) {
        document.documentElement.setAttribute('data-ai-drawer-open', 'true');
        const prevBodyOverflow = document.body.style.overflow;
        const prevHtmlOverflow = document.documentElement.style.overflow;
        const prevBodyOverscroll = document.body.style.overscrollBehavior;
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overscrollBehavior = 'none';

        return () => {
          document.body.style.overflow = prevBodyOverflow;
          document.documentElement.style.overflow = prevHtmlOverflow;
          document.body.style.overscrollBehavior = prevBodyOverscroll;
          document.documentElement.removeAttribute('data-ai-drawer-open');
          hasAttemptedTokenRef.current = false;
        };
      } else {
        document.documentElement.removeAttribute('data-ai-drawer-open');
        hasAttemptedTokenRef.current = false;
      }
    }
  }, [isOpen]);

  // Global Shortcut: Alt + C to toggle AI card anywhere across the app
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'c' || e.key === 'C' || e.code === 'KeyC')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts, true);
    return () => {
      window.removeEventListener('keydown', handleGlobalShortcuts, true);
    };
  }, []);

  // ── 6. STRICT KEYBOARD & FOCUS ISOLATION (Capture Phase) ────────────────
  // Prevents background study cards, tests, or scroll listeners from firing!
  useEffect(() => {
    if (!isOpen) {
      if (isRecordingRef.current) {
        void stopRecordingRef.current();
      }
      isSpaceKeyDownRef.current = false;
      return;
    }

    const handleKeyDownCapture = (e: KeyboardEvent) => {
      // (a) Alt + C shortcut always closes/toggles card immediately
      if (e.altKey && (e.key === 'c' || e.key === 'C' || e.code === 'KeyC')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setIsOpen(false);
        return;
      }

      const target = e.target as HTMLElement | null;

      // (b) If user is typing inside an input or textarea inside the AI card:
      // Allow event to proceed naturally to element so Space, Enter, and typing work
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
        return;
      }

      // (c) Spacebar outside input: HOLD Spacebar to talk (Push-to-Talk)
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (!e.repeat && !isSpaceKeyDownRef.current) {
          isSpaceKeyDownRef.current = true;
          void startRecordingRef.current();
        }
        return;
      }

      // (d) Escape: close modal or panel
      if (e.key === 'Escape' || e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (showShareModal) setShowShareModal(false);
        else if (showAccountModal) setShowAccountModal(false);
        else if (activePanel !== 'chat') setActivePanel('chat');
        else setIsOpen(false);
        return;
      }

      // (e) ANY OTHER KEY (Arrow keys, 1-4 rating, F for Zen, Enter):
      // Completely stop propagation so background flashcard NEVER flips, rates, or navigates!
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    const handleKeyUpCapture = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        if (isSpaceKeyDownRef.current) {
          isSpaceKeyDownRef.current = false;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          void stopRecordingRef.current();
        }
      }
    };

    const handleBlur = () => {
      if (isSpaceKeyDownRef.current) {
        isSpaceKeyDownRef.current = false;
        void stopRecordingRef.current();
      }
    };

    // Notice `true` for capture phase — intercepts BEFORE background listeners!
    window.addEventListener('keydown', handleKeyDownCapture, true);
    window.addEventListener('keyup', handleKeyUpCapture, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDownCapture, true);
      window.removeEventListener('keyup', handleKeyUpCapture, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isOpen, activePanel, showShareModal, showAccountModal]);

  // 7. Proactively sync current question context with the agent backend
  useEffect(() => {
    if (isOpen && currentQuestion) {
      void fetch('/api/agent/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_index: currentCardIndex,
          deck_name: activeSession?.deck_id || 'Study Session',
          path: pathname,
          question: {
            id: currentQuestion.id,
            type: currentQuestion.type,
            content: currentQuestion.content,
            options: currentQuestion.options,
            answer: currentQuestion.answer,
            explanation: currentQuestion.explanation,
            hints: currentQuestion.hints,
            code_language: currentQuestion.code_language || 'python',
          },
        }),
      }).catch(() => {});
    }
  }, [isOpen, currentQuestion, currentCardIndex, activeSession, pathname]);

  // 8. Initialize WebGL Orb Engine when drawer opens and chat panel is active
  useEffect(() => {
    if (!isOpen || activePanel !== 'chat' || !canvasRef.current) return;

    try {
      const savedShader = localStorage.getItem('selected_orb_variant') || selectedShader;
      const orb = new OrbEngine(canvasRef.current, savedShader);
      orbRef.current = orb;

      return () => {
        orb.destroy();
        orbRef.current = null;
      };
    } catch (e) {
      console.warn('[AgentDrawer] Error initializing OrbEngine:', e);
    }
  }, [isOpen, activePanel]);

  // 9. Update Orb visual state when agentState changes
  useEffect(() => {
    if (orbRef.current) {
      orbRef.current.setState(agentState);
    }
  }, [agentState]);

  // 10. Handle Shader Switch
  const handleShaderChange = useCallback((newShader: string) => {
    setSelectedShader(newShader);
    localStorage.setItem('selected_orb_variant', newShader);
    if (orbRef.current) {
      orbRef.current.switchVariant(newShader);
    }
  }, []);

  const handleNextVariant = useCallback(() => {
    const currentIndex = ORB_VARIANT_LIST.findIndex((v) => v.key === selectedShader);
    const nextIndex = (currentIndex + 1) % ORB_VARIANT_LIST.length;
    handleShaderChange(ORB_VARIANT_LIST[nextIndex].key);
  }, [selectedShader, handleShaderChange]);

  const handlePrevVariant = useCallback(() => {
    const currentIndex = ORB_VARIANT_LIST.findIndex((v) => v.key === selectedShader);
    const prevIndex = (currentIndex - 1 + ORB_VARIANT_LIST.length) % ORB_VARIANT_LIST.length;
    handleShaderChange(ORB_VARIANT_LIST[prevIndex].key);
  }, [selectedShader, handleShaderChange]);

  // Create or switch to fresh session (single source: Python backend, localStorage is cache only)
  // When called with an existing backend id (e.g. history_cleared event), switch only — no duplicate POST.
  const handleNewChat = useCallback((newSidParam?: string | unknown) => {
    const hasBackendId = typeof newSidParam === 'string' && Boolean(newSidParam);
    const localSid = hasBackendId ? (newSidParam as string) : `sess_${Math.floor(Date.now() / 1000)}_${Math.random().toString(36).substring(2, 8)}`;
    setMessages([]);
    setCurrentSessionId(localSid);
    try {
      localStorage.setItem('aliph1_session_id', localSid);
    } catch {}
    setAttachedFile(null);
    setActivePanel('chat');
    if (hasBackendId) return;
    // Persist to backend asynchronously so history is never phantom (no await to keep UI instant).
    void fetch('/api/agent/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Discussion' }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const backendId = data?.session?.id;
        if (backendId && backendId !== localSid) {
          setCurrentSessionId(backendId);
          try {
            localStorage.setItem('aliph1_session_id', backendId);
          } catch {}
        }
      })
      .catch(() => {});
  }, []);

  // Auto-scroll chat to bottom on new message or state change
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, agentState, isJudgingCode]);

  // 11. Connect to LiveKit Room if available (Strict single attempt, zero loops)
  const connectLiveKit = useCallback(async () => {
    if (typeof window === 'undefined' || hasAttemptedTokenRef.current) return;
    hasAttemptedTokenRef.current = true;

    setConnectionStatus('connecting');

    try {
      const tabId =
        typeof sessionStorage !== 'undefined'
          ? sessionStorage.getItem('noledge_tab_id') || ('tab_' + Math.random().toString(36).substring(2, 8))
          : 'tab_main';
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('noledge_tab_id', tabId);
      }
      const identity = `${userName}_${tabId}`;

      const resp = await fetch(
        `/api/agent/token?name=${encodeURIComponent(userName)}&identity=${encodeURIComponent(identity)}&room=agent-room`,
        { cache: 'no-store' }
      );
      if (!resp.ok) {
        setConnectionStatus('disconnected');
        return;
      }
      const tokenData = await resp.json();
      if (!tokenData.token || !tokenData.url) {
        setConnectionStatus('disconnected');
        return;
      }

      if (!(window as any).LivekitClient) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.getElementById('livekit-umd-script');
          if (existing) {
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', () => reject(new Error('Failed loading LiveKit script')));
            return;
          }
          const script = document.createElement('script');
          script.id = 'livekit-umd-script';
          script.src = 'https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js';
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed loading LiveKit script'));
          document.head.appendChild(script);
        });
      }

      const LivekitClient = (window as any).LivekitClient;
      if (!LivekitClient) throw new Error('LivekitClient not found on window');

      const room = new LivekitClient.Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });

      room.on(LivekitClient.RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const str = new TextDecoder().decode(payload);
          const data = JSON.parse(str);

          if (data.type === 'agent_state' || data.type === 'state') {
            const raw = (data.state || '').toLowerCase();
            if (raw.includes('think') || raw.includes('process')) {
              if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
              setAgentState('thinking');
            } else if (raw.includes('speak')) {
              if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
              setAgentState('speaking');
              // Safety fallback: return to idle after max 3.5s if no audio is playing
              speakingTimeoutRef.current = setTimeout(() => {
                setAgentState((curr) => (curr === 'speaking' ? 'idle' : curr));
              }, 3500);
            } else if (raw.includes('listen')) {
              if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
              setAgentState('listening');
            } else {
              if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
              setAgentState('idle');
            }
          } else if (data.type === 'chat_message') {
            const contentClean = (data.content || '').trim();
            if (!contentClean) return;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === (data.role === 'assistant' ? 'assistant' : 'user') && last.content.trim() === contentClean) {
                return prev;
              }
              return [
                ...prev,
                {
                  id: generateMsgId(),
                  role: data.role === 'assistant' ? 'assistant' : 'user',
                  speaker: data.speaker || (data.role === 'assistant' ? 'aliph1' : userName),
                  content: data.content,
                  timestamp: data.timestamp || Date.now(),
                },
              ];
            });
          } else if (data.type === 'switch_shader_ui') {
            if (data.variant) handleShaderChange(data.variant);
          } else if (data.type === 'switch_engine_ui') {
            if (data.tts) setTtsEngine(data.tts);
          } else if (data.type === 'switch_session_ui') {
            handleNewChat(data.session_id);
          } else if (data.type === 'change_avatar_ui') {
            if (data.avatar) {
              setUserAvatar(data.avatar);
              try {
                localStorage.setItem('aliph1_user_profile', JSON.stringify({ name: userName, avatar: data.avatar }));
              } catch {}
            }
          } else if (data.type === 'speaker_update' || data.type === 'speaker_detected') {
            const isVer = Boolean(data.verified);
            setSpeakerVerified(isVer);
            setUserName(isVer ? (data.speaker || 'Kirito') : 'Unknown');
          } else if (data.type === 'history_cleared') {
            try {
              localStorage.removeItem('aliph1_all_sessions');
            } catch {}
            setSessions([]);
            handleNewChat(data.new_session_id);
          } else if (data.type === 'session_deleted') {
            setSessions((prev) => {
              const updated = prev.filter((s) => s.id !== data.session_id);
              try {
                localStorage.setItem('aliph1_all_sessions', JSON.stringify(updated));
              } catch {}
              return updated;
            });
            if (data.is_current) {
              handleNewChat(data.new_session_id);
            }
          } else if (data.type === 'session_renamed') {
            setSessions((prev) =>
              prev.map((s) => (s.id === data.session_id ? { ...s, title: data.new_title } : s))
            );
          } else if (data.type === 'site_action') {
            void executeSiteAction(data.action, data.params).then((res) => {
              setMessages((prev) => [
                ...prev,
                {
                  id: generateMsgId(),
                  role: 'assistant',
                  speaker: 'aliph1',
                  content: `🛠️ **Tool Result:** ${res.message}`,
                  timestamp: Date.now(),
                },
              ]);
            });
          } else if (data.type === 'study_code_judged') {
            window.dispatchEvent(new CustomEvent('noledge_agent_code_judged', { detail: data }));
          } else if (data.type === 'study_answer_submitted') {
            window.dispatchEvent(new CustomEvent('noledge_agent_answer_submitted', { detail: data }));
          } else if (data.type === 'study_navigate_card') {
            if (data.direction === 'next') nextCard();
            else if (data.direction === 'prev') previousCard();
          }
        } catch {
          // Ignore
        }
      });

      room.on(LivekitClient.RoomEvent.TrackSubscribed, (track: any, publication: any, participant: any) => {
        if (track.kind === LivekitClient.Track.Kind?.Audio || track.kind === 'audio') {
          let audioEl = document.getElementById(`audio-${participant?.identity || 'agent'}`) as HTMLAudioElement | null;
          if (!audioEl) {
            audioEl = track.attach() as HTMLAudioElement;
            if (audioEl) {
              audioEl.id = `audio-${participant?.identity || 'agent'}`;
              audioEl.style.display = 'none';
              document.body.appendChild(audioEl);
            }
          } else {
            track.attach(audioEl);
          }
          if (audioEl) {
            audioEl.autoplay = true;
            audioEl.volume = 1.0;
            audioEl.muted = false;
            audioEl.play().catch(() => {});
          }
          track.on('ended', () => setAgentState('idle'));

          // Web Audio Analyser setup to drive Orb and dynamic speaking state
          try {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioCtx && track.mediaStreamTrack) {
              const ctx = new AudioCtx();
              const src = ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
              const analyser = ctx.createAnalyser();
              analyser.fftSize = 256;
              src.connect(analyser);
              const dataBuf = new Uint8Array(analyser.frequencyBinCount);
              let silenceFrames = 0;
              let isAgentSpeaking = false;

              const poll = () => {
                if (!lkRoomRef.current) return;
                analyser.getByteFrequencyData(dataBuf);
                let sum = 0;
                for (let i = 0; i < dataBuf.length; i++) sum += dataBuf[i];
                const avg = sum / dataBuf.length;
                const normalized = Math.min(1.0, (avg / 128.0) * 1.6);
                if (orbRef.current) orbRef.current.setAudioOutput(normalized);

                // Dynamically update speaking vs idle state based on physical sound output
                if (normalized > 0.04) {
                  silenceFrames = 0;
                  setAgentState((curr) => (curr !== 'speaking' ? 'speaking' : curr));
                } else {
                  silenceFrames++;
                  if (silenceFrames > 15) { // ~250ms of physical silence after speech
                    silenceFrames = 0;
                    setAgentState((curr) => (curr === 'speaking' ? 'idle' : curr));
                  }
                }

                requestAnimationFrame(poll);
              };
              requestAnimationFrame(poll);
            }
          } catch {}
        }
      });

      room.on(LivekitClient.RoomEvent.Disconnected, () => {
        setConnectionStatus('disconnected');
        micTrackRef.current = null;
      });

      await room.connect(tokenData.url, tokenData.token);
      lkRoomRef.current = room;
      setConnectionStatus('connected');

      // Synchronize active conversation session with LiveKit agent so it never resets to a new chat
      const activeSid = localStorage.getItem('aliph1_session_id') || currentSessionId;
      if (activeSid) {
        try {
          const initMsg = JSON.stringify({ type: 'init_session', session_id: activeSid });
          void room.localParticipant.publishData(new TextEncoder().encode(initMsg), { reliable: true });
        } catch {}
      }

      // Pre-create local microphone track so PTT is instantaneous (<1ms unmute)
      try {
        const micTrack = await LivekitClient.createLocalAudioTrack({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        });
        await room.localParticipant.publishTrack(micTrack);
        await micTrack.mute();
        micTrackRef.current = micTrack;
      } catch (micErr) {
        console.warn('[AgentDrawer] Mic pre-publish note:', micErr);
      }
    } catch (err) {
      console.warn('[AgentDrawer] LiveKit standby mode active:', err);
      setConnectionStatus('disconnected');
    }
  }, [handleShaderChange, nextCard, previousCard, userName]);

  useEffect(() => {
    if (isOpen) {
      void connectLiveKit();
    }
  }, [isOpen, connectLiveKit]);

  // 12. Load Sessions for History Panel (merge backend + local cache by id, no divergence)
  const loadSessions = useCallback(async () => {
    let backendList: ChatSession[] = [];
    try {
      const res = await fetch('/api/agent/history', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.sessions)) {
          backendList = data.sessions;
        }
      }
    } catch {
      // Fallback to cache
    }

    let localList: ChatSession[] = [];
    try {
      const localSessJson = localStorage.getItem('aliph1_all_sessions');
      if (localSessJson) localList = JSON.parse(localSessJson);
    } catch {
      localList = [];
    }

    // Merge by id: backend wins for metadata, local fills gaps when backend down.
    const merged = new Map<string, ChatSession>();
    for (const s of localList) if (s?.id) merged.set(s.id, s);
    for (const s of backendList) if (s?.id) merged.set(s.id, s);
    const list = Array.from(merged.values()).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));

    setSessions(list);
  }, []);

  useEffect(() => {
    if (activePanel === 'history') {
      void loadSessions();
    }
  }, [activePanel, loadSessions]);

  // Select a session from history
  const handleSelectSession = async (sid: string) => {
    setCurrentSessionId(sid);
    localStorage.setItem('aliph1_session_id', sid);

    // Read from localStorage first for instant load
    const savedLocal = localStorage.getItem(`aliph1_msgs_${sid}`);
    if (savedLocal) {
      try {
        setMessages(JSON.parse(savedLocal));
      } catch {
        // Fallback
      }
    }

    try {
      const res = await fetch(`/api/agent/history/${encodeURIComponent(sid)}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages(
            data.messages.map((m: any) => ({
              id: m.id || generateMsgId(),
              role: m.role || 'assistant',
              speaker: m.speaker || (m.role === 'assistant' ? 'aliph1' : userName),
              content: m.content || '',
              timestamp: m.timestamp || Date.now(),
            }))
          );
        }
      }
    } catch {
      // Fallback
    }

    setActivePanel('chat');
  };

  // Delete a session
  const handleDeleteSession = async (e: React.MouseEvent, sid: string) => {
    e.stopPropagation();
    try {
      await fetch(`/api/agent/history/${encodeURIComponent(sid)}`, { method: 'DELETE' });
    } catch {
      // Ignore
    }

    localStorage.removeItem(`aliph1_msgs_${sid}`);
    setSessions((prev) => {
      const updated = prev.filter((s) => s.id !== sid);
      localStorage.setItem('aliph1_all_sessions', JSON.stringify(updated));
      return updated;
    });

    if (currentSessionId === sid) {
      handleNewChat();
    }
  };

  // Clear all history
  const handleClearAllHistory = async () => {
    try {
      await fetch('/api/agent/history', { method: 'DELETE' });
    } catch {
      // Ignore
    }
    localStorage.removeItem('aliph1_all_sessions');
    setSessions([]);
    handleNewChat();
  };

  // 13. File Attachment Handlers
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const sizeFormatted = file.size > 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(file.size / 1024)} KB`;

    setAttachedFile({
      file,
      name: file.name,
      size: sizeFormatted,
      type: file.type,
    });
    e.target.value = '';
  };

  const handleRemoveAttachment = () => {
    setAttachedFile(null);
  };

  // 14. Text-To-Speech Synthesis helper (Universal browser voice engine)
  const speakText = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
      const clean = cleanForSpeech(text);
      if (!clean) return;
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = 'en-US';
      utterance.rate = 1.02;

      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        const engVoice = voices.find(
          (v) =>
            v.lang.startsWith('en') &&
            (v.name.includes('Natural') ||
              v.name.includes('Google') ||
              v.name.includes('Samantha') ||
              v.name.includes('David') ||
              v.name.includes('English'))
        );
        if (engVoice) utterance.voice = engVoice;
      }

      if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
      const estDuration = Math.max(2500, Math.min(18000, (clean.length / 14) * 1000 + 1500));
      speakingTimeoutRef.current = setTimeout(() => {
        setAgentState((curr) => (curr === 'speaking' ? 'idle' : curr));
      }, estDuration);

      utterance.onstart = () => setAgentState('speaking');
      utterance.onend = () => {
        if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
        setAgentState('idle');
      };
      utterance.onerror = () => {
        if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
        setAgentState('idle');
      };

      setTimeout(() => {
        window.speechSynthesis.speak(utterance);
      }, 40);
    } catch {}
  };

  // 14b. Unified speech router (single voice path; `force` for voice-initiated turns when output muted)
  const speakWithLiveKitOrBrowser = (textToSpeak: string, force = false) => {
    if (!isVoiceOutputEnabled && !force) return;
    const room = lkRoomRef.current;
    if (room && connectionStatus === 'connected') {
      try {
        const payload = JSON.stringify({
          type: 'speak_utterance',
          text: cleanForSpeech(textToSpeak),
          session_id: currentSessionId,
        });
        void room.localParticipant.publishData(new TextEncoder().encode(payload), { reliable: true });
        return;
      } catch {}
    }
    speakText(textToSpeak);
  };

  // 15. Save User Profile
  const handleSaveProfile = () => {
    const p = { name: userName.trim() || 'Kirito', avatar: userAvatar };
    localStorage.setItem('aliph1_user_profile', JSON.stringify(p));
    setShowAccountModal(false);
  };

  // 16. Send message (Handles text, site commands, Gemini LLM, code judging, and attached files)
  const handleSendMessage = async (e?: React.FormEvent, overrideText?: string, wasVoice = false) => {
    e?.preventDefault();
    const query = (overrideText !== undefined ? overrideText : inputQuery).trim();
    const currentAttachment = attachedFile;

    if (!query && !currentAttachment) return;

    setInputQuery('');
    setAttachedFile(null);

    const userText = currentAttachment ? `📎 [Attached: ${currentAttachment.name}] ${query}` : query;

    const userMsg: ChatMessage = {
      id: generateMsgId(),
      role: 'user',
      speaker: userName,
      content: userText,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setAgentState('thinking');

    // ── Check for direct Site Action intents from User ──
    const qLower = query.toLowerCase();
    // Multi-action helper: extract "rename (it|session|chat) to/as X" even when combined with delete/new.
    const extractRenameTitle = (raw: string): string | null => {
      const m = raw.match(/renam\w*.*? (?:to|as)\s+["']?(.+?)["']?[.?!]*$/i);
      if (!m) return null;
      const cand = (m[1] || '').trim().replace(/^["']|["']$/g, '');
      if (!cand || ['it', 'that', 'this', 'else', 'something else', 'session', 'chat'].includes(cand.toLowerCase())) return null;
      return cand;
    };
    const combinedRename = extractRenameTitle(query);

    // ── Direct Session History Clear & Delete Intents (multi-action: delete-all + rename) ──
    if (
      (qLower.includes('delete') || qLower.includes('clear') || qLower.includes('wipe') || qLower.includes('remove')) &&
      (qLower.includes('past session') ||
        qLower.includes('previous session') ||
        qLower.includes('all session') ||
        qLower.includes('chat session') ||
        qLower.includes('history') ||
        qLower.includes('all chat') ||
        qLower.includes('past chat') ||
        (qLower.includes('session') && !qLower.includes('this session') && !qLower.includes('current session')))
    ) {
      await handleClearAllHistory();
      let reply = '🧹 All past conversation sessions have been permanently cleared. Starting a fresh session!';
      // If user also asked to rename/new in same sentence, execute sequentially (no intelligence loss).
      if (combinedRename && currentSessionId) {
        try {
          await fetch(`/api/agent/history/${encodeURIComponent(currentSessionId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: combinedRename }),
          });
          // currentSessionId already rotated by handleClearAllHistory; rename the new active id.
          const activeId = localStorage.getItem('aliph1_session_id') || currentSessionId;
          await fetch(`/api/agent/history/${encodeURIComponent(activeId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: combinedRename }),
          });
          reply = `🧹 All past sessions cleared, fresh chat started and renamed to '${combinedRename}'.`;
        } catch {}
      }
      setMessages((prev) => [
        ...prev,
        {
          id: generateMsgId(),
          role: 'assistant',
          speaker: 'aliph1',
          content: reply,
          timestamp: Date.now(),
        },
      ]);
      speakWithLiveKitOrBrowser(reply, wasVoice);
      setAgentState('idle');
      return;
    }

    if (qLower === 'delete session' || qLower === 'delete this session' || qLower === 'delete this chat') {
      if (currentSessionId) {
        await handleDeleteSession({ stopPropagation: () => {} } as any, currentSessionId);
        const reply = '🗑️ Current conversation session deleted. Starting a fresh session!';
        setMessages((prev) => [
          ...prev,
          {
            id: generateMsgId(),
            role: 'assistant',
            speaker: 'aliph1',
            content: reply,
            timestamp: Date.now(),
          },
        ]);
        speakWithLiveKitOrBrowser(reply, wasVoice);
        setAgentState('idle');
        return;
      }
    }

    // Direct Change App / Switch Page intent
    if (
      qLower.includes('change the app') ||
      qLower.includes('switch the app') ||
      qLower.includes('change app') ||
      qLower.includes('switch app')
    ) {
      const target = qLower.includes('study')
        ? '/study'
        : qLower.includes('manage')
        ? '/manage'
        : qLower.includes('create')
        ? '/create'
        : pathname === '/study'
        ? '/manage'
        : '/study';
      await executeSiteAction('navigate_to', { path: target });
      const reply = `🚀 Navigating to **${target === '/study' ? 'Study Mode' : target === '/manage' ? 'Deck Manager' : 'Deck Creator'}**.`;
      setMessages((prev) => [
        ...prev,
        {
          id: generateMsgId(),
          role: 'assistant',
          speaker: 'aliph1',
          content: reply,
          timestamp: Date.now(),
        },
      ]);
      speakWithLiveKitOrBrowser(reply, wasVoice);
      setAgentState('idle');
      return;
    }

    // Direct Avatar Switch intent ("change avatar to earth", etc.)
    if (qLower.includes('avatar') && (qLower.includes('change') || qLower.includes('set') || qLower.includes('switch') || qLower.includes('to'))) {
      let targetAvatar = '';
      if (qLower.includes('earth') || qLower.includes('world') || qLower.includes('globe')) targetAvatar = '🌍';
      else if (qLower.includes('shield')) targetAvatar = '🛡️';
      else if (qLower.includes('sword')) targetAvatar = '⚔️';
      else if (qLower.includes('lightning') || qLower.includes('thunder') || qLower.includes('bolt')) targetAvatar = '⚡';
      else if (qLower.includes('crystal') || qLower.includes('magic') || qLower.includes('orb')) targetAvatar = '🔮';
      else if (qLower.includes('brain') || qLower.includes('mind')) targetAvatar = '🧠';
      else if (qLower.includes('rocket')) targetAvatar = '🚀';
      else if (qLower.includes('fire') || qLower.includes('flame')) targetAvatar = '🔥';
      else if (qLower.includes('star')) targetAvatar = '⭐';
      else if (qLower.includes('robot')) targetAvatar = '🤖';
      else {
        const emojiMatch = query.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u);
        if (emojiMatch) targetAvatar = emojiMatch[0];
      }

      if (targetAvatar) {
        setUserAvatar(targetAvatar);
        localStorage.setItem('aliph1_user_profile', JSON.stringify({ name: userName, avatar: targetAvatar }));
        const reply = `I've updated your avatar to ${targetAvatar}!`;
        setMessages((prev) => [
          ...prev,
          {
            id: generateMsgId(),
            role: 'assistant',
            speaker: 'aliph1',
            content: reply,
            timestamp: Date.now(),
          },
        ]);
        speakWithLiveKitOrBrowser(reply, wasVoice);
        setAgentState('idle');
        return;
      }
    }

    // Direct Name Change intent
    if (qLower.startsWith('my name is') || qLower.startsWith('call me') || qLower.startsWith('change name to')) {
      const parts = query.split(/(?:my name is|call me|change name to)\s+/i);
      if (parts.length > 1 && parts[1].trim()) {
        const newName = parts[1].trim().replace(/[.!,]$/g, '');
        setUserName(newName);
        localStorage.setItem('aliph1_user_profile', JSON.stringify({ name: newName, avatar: userAvatar }));
        const reply = `Nice to meet you, **${newName}**! Profile updated.`;
        setMessages((prev) => [
          ...prev,
          {
            id: generateMsgId(),
            role: 'assistant',
            speaker: 'aliph1',
            content: reply,
            timestamp: Date.now(),
          },
        ]);
        speakWithLiveKitOrBrowser(reply, wasVoice);
        setAgentState('idle');
        return;
      }
    }

    // Theme toggle intent
    if (qLower.includes('theme') && (qLower.includes('dark') || qLower.includes('light') || qLower.includes('switch') || qLower.includes('toggle'))) {
      const target = qLower.includes('light') ? 'light' : 'dark';
      const actionRes = await executeSiteAction('change_theme', { theme: target });
      const reply = `🎨 ${actionRes.message}`;
      setMessages((prev) => [
        ...prev,
        {
          id: generateMsgId(),
          role: 'assistant',
          speaker: 'aliph1',
          content: reply,
          timestamp: Date.now(),
        },
      ]);
      speakWithLiveKitOrBrowser(reply, wasVoice);
      setAgentState('idle');
      return;
    }

    // Shader switch intent
    if (qLower.includes('shader') && (qLower.includes('switch') || qLower.includes('change') || qLower.includes('set') || qLower.includes('to'))) {
      const match = ORB_VARIANT_LIST.find(
        (v) => qLower.includes(v.key.toLowerCase()) || qLower.includes(v.label.toLowerCase())
      );
      if (match) {
        handleShaderChange(match.key);
        const reply = `🔮 Switched orb shader to **${match.label}** (${match.key.toUpperCase()}).`;
        setMessages((prev) => [
          ...prev,
          {
            id: generateMsgId(),
            role: 'assistant',
            speaker: 'aliph1',
            content: reply,
            timestamp: Date.now(),
          },
        ]);
        speakWithLiveKitOrBrowser(reply, wasVoice);
        setAgentState('idle');
        return;
      }
    }

    // Delete deck intent
    if (qLower.startsWith('delete deck') || qLower.startsWith('remove deck')) {
      const match = query.match(/(?:delete|remove)\s+deck\s+["']?([^"'\n]+)["']?/i);
      const targetName = match ? match[1].trim() : '';
      if (targetName) {
        const targetDeck = Object.values(decks).find(
          (d) => d.name.toLowerCase() === targetName.toLowerCase() || d.id === targetName
        );
        if (targetDeck) {
          const res = await executeSiteAction('delete_deck', { deck_id: targetDeck.id });
          const reply = `🗑️ ${res.message}`;
          setMessages((prev) => [
            ...prev,
            {
              id: generateMsgId(),
              role: 'assistant',
              speaker: 'aliph1',
              content: reply,
              timestamp: Date.now(),
            },
          ]);
          speakWithLiveKitOrBrowser(reply, wasVoice);
          setAgentState('idle');
          return;
        }
      }
    }

    // Create deck intent
    if (qLower.startsWith('create deck') || qLower.startsWith('create a deck') || qLower.includes('new deck')) {
      const match = query.match(/deck\s+(?:called|named)?\s*["']?([^"'\n]+)["']?/i);
      const deckName = match ? match[1].trim() : 'New Deck';
      const actionRes = await executeSiteAction('create_deck', { name: deckName, description: 'Created by Voice AI' });
      const reply = `✨ ${actionRes.message}\n\nYou can now add flashcards or study it.`;
      setMessages((prev) => [
        ...prev,
        {
          id: generateMsgId(),
          role: 'assistant',
          speaker: 'aliph1',
          content: reply,
          timestamp: Date.now(),
        },
      ]);
      speakWithLiveKitOrBrowser(reply, wasVoice);
      setAgentState('idle');
      return;
    }

    // List decks intent
    if (qLower.includes('my decks') || qLower.includes('list decks') || qLower.includes('show decks')) {
      const actionRes = await executeSiteAction('get_decks');
      const decksList = actionRes.data || [];
      const formatted = decksList.map((d: any) => `- **${d.name}** (${d.card_count} cards)`).join('\n');
      const reply = `📚 **Your Decks (${decksList.length}):**\n\n${formatted || 'No decks found. Ask me to create one!'}`;
      setMessages((prev) => [
        ...prev,
        {
          id: generateMsgId(),
          role: 'assistant',
          speaker: 'aliph1',
          content: reply,
          timestamp: Date.now(),
        },
      ]);
      speakWithLiveKitOrBrowser(reply, wasVoice);
      setAgentState('idle');
      return;
    }

    // Navigation intent
    if (qLower.includes('open manage') || qLower.includes('go to manage') || qLower.includes('deck manager')) {
      await executeSiteAction('navigate_to', { path: '/manage' });
      setAgentState('idle');
      return;
    }
    if (qLower.includes('open create') || qLower.includes('create page')) {
      await executeSiteAction('navigate_to', { path: '/create' });
      setAgentState('idle');
      return;
    }
    if (qLower.includes('open study') || qLower.includes('start test') || qLower.includes('study mode')) {
      await executeSiteAction('navigate_to', { path: '/study' });
      setAgentState('idle');
      return;
    }

    // (a) If file attached, call upload endpoint
    if (currentAttachment) {
      try {
        const formData = new FormData();
        formData.append('file', currentAttachment.file);
        formData.append('prompt', query || 'Analyze this document or image thoroughly.');
        formData.append('session_id', currentSessionId);

        const uploadRes = await fetch('/api/agent/upload', {
          method: 'POST',
          body: formData,
        });

        if (uploadRes.ok) {
          const data = await uploadRes.json();
          const reply = data.text || 'File processed successfully.';
          const spokenText = data.spoken_summary || reply;
          setMessages((prev) => [
            ...prev,
            {
              id: generateMsgId(),
              role: 'assistant',
              speaker: 'aliph1',
              content: reply,
              timestamp: Date.now(),
            },
          ]);
          speakWithLiveKitOrBrowser(spokenText || reply, wasVoice);
          setAgentState('idle');
          return;
        }
      } catch (err) {
        console.warn('File upload error:', err);
      }
    }

    // (b) Try LiveKit room data channel if connected
    const room = lkRoomRef.current;
    if (room && connectionStatus === 'connected' && !currentAttachment) {
      try {
        const payload = JSON.stringify({ type: 'user_chat', text: query, session_id: currentSessionId });
        await room.localParticipant.publishData(new TextEncoder().encode(payload), { reliable: true });
        setAgentState('thinking');
        return;
      } catch {
        // Fallback
      }
    }

    // (c) Code question evaluation or educational response via REST
    try {
      if (
        currentQuestion?.type === 'code' &&
        (query.toLowerCase().includes('judge') ||
          query.toLowerCase().includes('code') ||
          query.toLowerCase().includes('check') ||
          query.toLowerCase().includes('evaluate'))
      ) {
        const cachedCode = localStorage.getItem(`code_buffer_${currentQuestion.id}`) || '';
        const data = await judgeCodeSnippet(currentQuestion, cachedCode);

        const reply = `### Code Evaluation Verdict: **${data.is_correct ? 'CORRECT' : 'INCORRECT'}** (Score: ${data.score}/100)\n\n${data.feedback}`;
        setMessages((prev) => [
          ...prev,
          {
            id: generateMsgId(),
            role: 'assistant',
            speaker: 'aliph1',
            content: reply,
            timestamp: Date.now(),
          },
        ]);
        speakWithLiveKitOrBrowser(reply, wasVoice);
        setAgentState('idle');
        return;
      }

      // Intelligent Gemini Chat Endpoint call
      try {
        const chatRes = await fetch('/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: query,
            session_id: currentSessionId,
            user_name: userName,
            user_avatar: userAvatar,
            context: {
              card_index: currentCardIndex,
              deck_name: activeSession?.deck_id || 'Study Session',
              path: pathname,
              question: currentQuestion
                ? {
                    id: currentQuestion.id,
                    type: currentQuestion.type,
                    content: currentQuestion.content,
                    options: currentQuestion.options,
                    answer: currentQuestion.answer,
                    explanation: currentQuestion.explanation,
                    hints: currentQuestion.hints,
                  }
                : null,
            },
            history: messages.slice(-6),
          }),
        });

        if (chatRes.ok) {
          const chatData = await chatRes.json();
          // Multi-action: execute every requested tool in sequence (e.g. clear + rename).
          const actionList = Array.isArray(chatData.actions)
            ? chatData.actions
            : chatData.action
              ? [{ action: chatData.action, params: chatData.params }]
              : [];
          for (const item of actionList) {
            const actName = item?.action;
            const actParams = item?.params || {};
            if (!actName) continue;
            if (actName === 'create_new_chat') {
              handleNewChat(actParams?.session_id);
            } else if (actName === 'clear_chat_history') {
              await handleClearAllHistory();
            } else if (actName === 'delete_chat_session') {
              const sid = actParams?.session_id || currentSessionId;
              if (sid) {
                await handleDeleteSession({ stopPropagation: () => {} } as any, sid);
              }
            } else if (actName === 'rename_chat_session' && actParams?.new_title) {
              const sid = actParams?.session_id || currentSessionId || localStorage.getItem('aliph1_session_id');
              if (sid) {
                try {
                  await fetch(`/api/agent/history/${encodeURIComponent(sid)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: actParams.new_title }),
                  });
                } catch {}
                setSessions((prev) => prev.map((s) => (s.id === sid ? { ...s, title: actParams.new_title } : s)));
              }
            } else if (actName === 'switch_orb_shader' && actParams?.variant_or_query) {
              const matched = ORB_VARIANT_LIST.find(
                (v) =>
                  v.key.toLowerCase() === String(actParams.variant_or_query).toLowerCase() ||
                  v.label.toLowerCase().includes(String(actParams.variant_or_query).toLowerCase())
              );
              if (matched) handleShaderChange(matched.key);
            } else if (actName === 'change_avatar' && actParams?.avatar) {
              setUserAvatar(actParams.avatar);
              localStorage.setItem('aliph1_user_profile', JSON.stringify({ name: userName, avatar: actParams.avatar }));
            } else if (actName === 'change_name' && actParams?.name) {
              setUserName(actParams.name);
              localStorage.setItem('aliph1_user_profile', JSON.stringify({ name: actParams.name, avatar: userAvatar }));
            } else {
              try {
                const siteRes = await executeSiteAction(actName, actParams);
                // Surface tool result inline so user sees real outcome, not a canned line.
                if (!siteRes.success) {
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: generateMsgId(),
                      role: 'assistant',
                      speaker: 'aliph1',
                      content: `⚠️ Tool \`${actName}\` failed: ${siteRes.message}`,
                      timestamp: Date.now(),
                    },
                  ]);
                }
              } catch {}
            }
          }

          const replyContent = chatData.text || 'Message processed.';
          setMessages((prev) => [
            ...prev,
            {
              id: generateMsgId(),
              role: 'assistant',
              speaker: 'aliph1',
              content: replyContent,
              timestamp: Date.now(),
            },
          ]);

          speakWithLiveKitOrBrowser(replyContent, wasVoice);
          setAgentState('idle');
          return;
        }
      } catch (chatErr) {
        console.warn('Chat endpoint call failed:', chatErr);
      }

      // Default educational query fallback
      const assistantText =
        currentQuestion?.explanation ||
        `I am active on **${pathname === '/study' ? 'Study Test' : pathname === '/manage' ? 'Deck Manager' : pathname === '/create' ? 'Deck Creator' : 'Dashboard'}**. Ask me questions, request deck/card management, or upload files.`;

      setMessages((prev) => [
        ...prev,
        {
          id: generateMsgId(),
          role: 'assistant',
          speaker: 'aliph1',
          content: assistantText,
          timestamp: Date.now(),
        },
      ]);
      speakWithLiveKitOrBrowser(assistantText, wasVoice);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: generateMsgId(),
          role: 'assistant',
          speaker: 'aliph1',
          content: 'I could not reach the server right now, but your context is active.',
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setAgentState('idle');
    }
  };

  // 17. Quick Judge Code Action (backend context first, localStorage fallback — never empty)
  const handleQuickJudgeCode = async () => {
    if (!currentQuestion || currentQuestion.type !== 'code' || isJudgingCode) return;

    setIsJudgingCode(true);
    setAgentState('thinking');

    try {
      let cachedCode = '';
      try {
        const ctxRes = await fetch('/api/agent/context', { cache: 'no-store' });
        if (ctxRes.ok) {
          const ctxData = await ctxRes.json();
          const backendCode = String(ctxData?.context?.code_buffer || '').trim();
          const backendQid = String(ctxData?.context?.question?.id || '');
          if (backendCode && (!backendQid || backendQid === currentQuestion.id)) {
            cachedCode = backendCode;
          }
        }
      } catch {}
      if (!cachedCode) {
        cachedCode = localStorage.getItem(`code_buffer_${currentQuestion.id}`) || '';
      }
      const data = await judgeCodeSnippet(currentQuestion, cachedCode);

      setMessages((prev) => [
        ...prev,
        {
          id: generateMsgId(),
          role: 'assistant',
          speaker: 'aliph1',
          content: `### Code Evaluation: **${data.is_correct ? 'CORRECT' : 'INCORRECT'}** (${data.score}/100)\n\n${data.feedback}`,
          timestamp: Date.now(),
        },
      ]);

      window.dispatchEvent(new CustomEvent('noledge_agent_code_judged', { detail: data }));
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: generateMsgId(),
          role: 'assistant',
          speaker: 'aliph1',
          content: 'Could not complete code evaluation. Please verify your code editor input.',
          timestamp: Date.now(),
        },
      ]);
      console.warn('Judge code error:', err);
    } finally {
      setIsJudgingCode(false);
      setAgentState('idle');
    }
  };

  // ── Universal Voice Recording Engine (single-mic: LiveKit xor local) ─────
  // Priority: LiveKit pre-warmed track when connected (no second getUserMedia),
  // else Web Speech interim + MediaRecorder fallback exclusively (never parallel).
  const startVoiceRecording = useCallback(async () => {
    if (isRecordingRef.current) return;
    isRecordingRef.current = true;
    setIsMicActive(true);
    setAgentState('listening');

    // (A) LiveKit Room integration if connected with pre-warmed track
    const room = lkRoomRef.current;
    const livekitActive = Boolean(room && connectionStatus === 'connected' && micTrackRef.current);
    if (livekitActive && room) {
      try {
        await micTrackRef.current.unmute();
        const data = JSON.stringify({ type: 'ptt_start' });
        await room.localParticipant.publishData(new TextEncoder().encode(data), { reliable: true });
        if (orbRef.current) {
          orbRef.current.setAudioInput(0.35);
          orbRef.current.setAudioOutput(0.0);
        }
      } catch (e) {
        console.warn('[Voice] LiveKit mic error:', e);
      }
    }

    // (B) Web Speech API streaming recognition if supported (Chrome, Edge)
    // When LiveKit is active, Web Speech is interim-only (no extra mic stream).
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            transcript += event.results[i][0].transcript;
          }
          if (transcript) {
            setInputQuery(transcript);
          }
        };

        recognition.onerror = (event: any) => {
          console.warn('[SpeechRecognition] error:', event.error);
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (err) {
        console.warn('[SpeechRecognition] start error:', err);
      }
    }

    // (C) MediaRecorder fallback ONLY when LiveKit is NOT active and Web Speech is unavailable.
    // Prevents triple-mic contention (LiveKit + Speech + Recorder) which broke STT.
    const needsLocalRecorder = !livekitActive && !SpeechRecognition;
    if (!needsLocalRecorder) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        mediaStreamRef.current = stream;
        audioChunksRef.current = [];

        let mimeType = 'audio/webm';
        if (typeof MediaRecorder !== 'undefined') {
          if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            mimeType = 'audio/webm;codecs=opus';
          } else if (MediaRecorder.isTypeSupported('audio/webm')) {
            mimeType = 'audio/webm';
          } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
            mimeType = 'audio/mp4';
          } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
            mimeType = 'audio/ogg';
          }

          const recorder = new MediaRecorder(stream, { mimeType });
          recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
              audioChunksRef.current.push(event.data);
            }
          };

          recorder.start(100);
          mediaRecorderRef.current = recorder;
        }
      }
    } catch (err) {
      console.warn('[MediaRecorder] mic access error:', err);
    }
  }, [connectionStatus]);

  const stopVoiceRecording = useCallback(async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setIsMicActive(false);
    setAgentState('thinking');

    // (A) LiveKit Room integration
    const room = lkRoomRef.current;
    if (room && connectionStatus === 'connected' && micTrackRef.current) {
      try {
        const data = JSON.stringify({ type: 'ptt_released', has_attachment: false });
        await room.localParticipant.publishData(new TextEncoder().encode(data), { reliable: true });
        setTimeout(async () => {
          if (!isRecordingRef.current && micTrackRef.current) {
            try {
              await micTrackRef.current.mute();
            } catch {}
          }
        }, 200);
        if (orbRef.current) {
          orbRef.current.setAudioInput(0.0);
        }
      } catch (e) {
        console.warn('[Voice] LiveKit release error:', e);
      }
    }

    // (B) Stop Web Speech API recognition
    try {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    } catch {}

    const recognizedText = inputQueryRef.current.trim();

    // (C) Stop MediaRecorder and process audio chunks
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = async () => {
        try {
          // If we created an independent getUserMedia stream, stop its tracks
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => {
              if (micTrackRef.current && track === (micTrackRef.current as any).mediaStreamTrack) return;
              track.stop();
            });
          }
          mediaStreamRef.current = null;

          // If browser speech recognition already captured text, send it immediately
          if (recognizedText) {
            void handleSendMessage(undefined, recognizedText, true);
            return;
          }

          // Otherwise (e.g. in Firefox), transcribe audio recording via Gemini API
          const chunks = [...audioChunksRef.current];
          audioChunksRef.current = [];
          if (chunks.length > 0) {
            const blobType = recorder.mimeType || 'audio/webm';
            const audioBlob = new Blob(chunks, { type: blobType });

            if (audioBlob.size > 100) {
              const reader = new FileReader();
              reader.readAsDataURL(audioBlob);
              reader.onloadend = async () => {
                try {
                  const base64Audio = (reader.result as string)?.split(',')[1] || '';
                  if (base64Audio) {
                    const res = await fetch('/api/agent/transcribe', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        audio: base64Audio,
                        mimeType: blobType,
                      }),
                    });

                    if (res.ok) {
                      const data = await res.json();
                      const transcribed = (data.text || '').trim();
                      if (transcribed) {
                        setInputQuery(transcribed);
                        void handleSendMessage(undefined, transcribed, true);
                        return;
                      }
                    }
                  }
                } catch (txErr) {
                  console.warn('[Audio transcribe] error:', txErr);
                }
                setAgentState('idle');
              };
              return;
            }
          }
          setAgentState('idle');
        } catch (e) {
          console.warn('[Voice onstop] error:', e);
          setAgentState('idle');
        }
      };

      try {
        try {
          if (typeof recorder.requestData === 'function') {
            recorder.requestData();
          }
        } catch {}
        recorder.stop();
      } catch {
        setAgentState('idle');
      }
    } else {
      if (recognizedText) {
        void handleSendMessage(undefined, recognizedText, true);
      } else {
        setAgentState('idle');
      }
    }
  }, [connectionStatus]);

  const toggleMic = useCallback(async () => {
    if (isRecordingRef.current) {
      await stopVoiceRecording();
    } else {
      await startVoiceRecording();
    }
  }, [startVoiceRecording, stopVoiceRecording]);

  useEffect(() => {
    startRecordingRef.current = startVoiceRecording;
    stopRecordingRef.current = stopVoiceRecording;
  }, [startVoiceRecording, stopVoiceRecording]);

  // 18. Share Functions
  const handleCopyMarkdown = () => {
    const md = messages.map((m) => `**${m.role === 'user' ? userName : 'aliph1'}**: ${m.content}`).join('\n\n');
    void navigator.clipboard.writeText(md);
    alert('Conversation transcript copied to clipboard!');
  };

  const handleCopyShareLink = () => {
    const url = `${window.location.origin}/study?agent_session=${currentSessionId}`;
    void navigator.clipboard.writeText(url);
    alert('Shareable link copied to clipboard!');
  };

  const handleDownloadHtml = () => {
    const content = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>aliph1 Conversation Export</title><style>body{font-family:sans-serif;max-width:700px;margin:30px auto;padding:20px;background:#0A0A0A;color:#EDEDED;line-height:1.6}.msg{margin-bottom:18px;padding:12px 16px;border-radius:12px;background:#141414;border:1px solid #222}.user{border-left:4px solid #4F46E5}.assistant{border-left:4px solid #10B981}.author{font-weight:bold;margin-bottom:4px;color:#A5B4FC}</style></head><body><h2>aliph1 Voice AI Conversation Export</h2>${messages.map((m) => `<div class="msg ${m.role}"><div class="author">${m.role === 'user' ? userName : 'aliph1'}</div><div>${m.content}</div></div>`).join('')}</body></html>`;
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${currentSessionId}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Scroll to bottom on new message
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isJudgingCode]);

  // Filtered sessions for history search
  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(historySearchQuery.toLowerCase())
  );

  // Dynamic route context string for card banner
  const getRouteContextLabel = () => {
    if (pathname === '/study') {
      return currentQuestion ? `STUDY • ${currentQuestion.type.toUpperCase()}` : 'STUDY SESSION';
    }
    if (pathname === '/manage') return 'DECK MANAGER';
    if (pathname === '/create') return 'DECK CREATOR';
    if (pathname === '/settings') return 'SETTINGS PANEL';
    return 'DASHBOARD';
  };

  return (
    <>
      {/* Floating Sparkle Button (Available across all panels and routes) */}
      {!isOpen && (
        <button
          type="button"
          className={styles.floatingAiBtn}
          onClick={() => setIsOpen(true)}
          aria-label="Toggle AI Agent (Alt + C)"
          title="Voice AI Agent (Alt + C)"
        >
          <Sparkles size={18} className={styles.sparkleIcon} />
        </button>
      )}

      {/* Main Standalone Card Modal */}
      {isOpen && (
        <div
          className={styles.drawerOverlay}
          onClick={() => setIsOpen(false)}
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <main
            className={styles.appCard}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="aliph1 Voice AI"
          >
            {/* TOP HEADER / CAPSULES BAR (Faithful to agent/web/index.html) */}
            <header className={styles.cardHeader}>
              {/* User Identification Tablet with Avatar */}
              <div
                className={styles.userTablet}
                onClick={() => setShowAccountModal(true)}
                title="Click to manage account, speaker profile, and avatar"
              >
                <span className={styles.userAvatarEmoji}>{userAvatar}</span>
                <span className={styles.userName}>{userName}</span>
              </div>

              {/* Navigation Capsules: New Chat, History, Settings, Share, Close */}
              <div className={styles.capsulesGroup}>
                <button
                  type="button"
                  className={styles.capsuleBtn}
                  onClick={handleNewChat}
                  title="Start a fresh conversation session"
                  aria-label="New Session"
                >
                  <Plus size={13} strokeWidth={2.5} />
                  <span>New Chat</span>
                </button>

                <button
                  type="button"
                  className={cn(styles.capsuleBtn, styles.btnIconOnly, activePanel === 'history' && styles.active)}
                  onClick={() => setActivePanel(activePanel === 'history' ? 'chat' : 'history')}
                  title="Conversation History"
                  aria-label="History"
                >
                  <Clock size={15} strokeWidth={2.2} />
                </button>

                <button
                  type="button"
                  className={cn(styles.capsuleBtn, styles.btnIconOnly, activePanel === 'settings' && styles.active)}
                  onClick={() => setActivePanel(activePanel === 'settings' ? 'chat' : 'settings')}
                  title="Engine & Model Settings"
                  aria-label="Settings"
                >
                  <SettingsIcon size={15} strokeWidth={2.2} />
                </button>

                <button
                  type="button"
                  className={cn(styles.capsuleBtn, styles.btnIconOnly, !isVoiceOutputEnabled && styles.muted)}
                  onClick={() => {
                    const next = !isVoiceOutputEnabled;
                    setIsVoiceOutputEnabled(next);
                    if (!next && typeof window !== 'undefined' && 'speechSynthesis' in window) {
                      window.speechSynthesis.cancel();
                      setAgentState('idle');
                    }
                  }}
                  title={isVoiceOutputEnabled ? 'Mute Voice Output' : 'Enable Voice Output'}
                  aria-label="Voice Output Toggle"
                >
                  {isVoiceOutputEnabled ? <Volume2 size={15} strokeWidth={2.2} /> : <VolumeX size={15} strokeWidth={2.2} />}
                </button>

                <button
                  type="button"
                  className={styles.capsuleBtn}
                  onClick={() => setShowShareModal(true)}
                  title="Share full chat session"
                  aria-label="Share"
                >
                  <Share2 size={13} strokeWidth={2.2} />
                  <span>Share</span>
                </button>

                <button
                  type="button"
                  className={cn(styles.capsuleBtn, styles.btnIconOnly)}
                  onClick={() => setIsOpen(false)}
                  title="Close Agent"
                  aria-label="Close"
                >
                  <X size={15} strokeWidth={2.5} />
                </button>
              </div>
            </header>

            {/* PANEL 1: MAIN CONVERSATION & ORB VIEW */}
            {activePanel === 'chat' && (
              <section className={cn(styles.cardPanel, styles.active)}>
                {/* Top Center: Orb Section with Mode Preview Pills & Variant Switcher */}
                <div className={styles.orbHeroSection}>
                  <div className={styles.orbControlsBar}>
                    <div className={styles.orbModeBar} role="tablist" aria-label="Orb Mode Preview">
                      <button
                        type="button"
                        className={cn(styles.modePill, agentState === 'idle' && styles.active)}
                        onClick={() => setAgentState('idle')}
                      >
                        Idle
                      </button>
                      <button
                        type="button"
                        className={cn(styles.modePill, agentState === 'thinking' && styles.active)}
                        onClick={() => setAgentState('thinking')}
                      >
                        Thinking
                      </button>
                      <button
                        type="button"
                        className={cn(
                          styles.modePill,
                          agentState === 'speaking' && styles.active
                        )}
                        onClick={() => setAgentState('speaking')}
                      >
                        Speaking
                      </button>
                    </div>

                    <div className={styles.orbVariantCapsule}>
                      <button
                        type="button"
                        className={styles.variantNavArrow}
                        onClick={handlePrevVariant}
                        title="Previous Orb Variant"
                        aria-label="Previous Variant"
                      >
                        <ChevronLeft size={12} strokeWidth={2.5} />
                      </button>
                      <div className={styles.variantSelectWrapper}>
                        <CustomSelect
                          value={selectedShader}
                          onChange={(val) => handleShaderChange(val)}
                          options={ORB_VARIANT_OPTIONS}
                          searchable={true}
                          alignRight={true}
                          isOrbVariant={true}
                          placeholder="Select Shader Variant"
                        />
                      </div>
                      <button
                        type="button"
                        className={styles.variantNavArrow}
                        onClick={handleNextVariant}
                        title="Next Orb Variant"
                        aria-label="Next Variant"
                      >
                        <ChevronRight size={12} strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>

                  {/* Single Canvas WebGL Orb Stage */}
                  <div className={styles.orbStage}>
                    <canvas ref={canvasRef} className={styles.orbCanvas} width={190} height={190} />
                  </div>
                </div>

                {/* Dynamic Context Banner (Adapts to current route / question) */}
                <div className={styles.activeQuestionBanner}>
                  <div className={styles.questionBannerHeader}>
                    <span className={styles.questionTypeTag}>{getRouteContextLabel()}</span>
                    <span className={styles.questionSnippet}>
                      {pathname === '/study' && currentQuestion
                        ? `${currentQuestion.content.replace(/<[^>]*>?/gm, '').slice(0, 60)}...`
                        : pathname === '/manage'
                        ? `Managing ${Object.keys(decks).length} flashcard decks`
                        : pathname === '/create'
                        ? 'Creating new decks and question cards'
                        : 'Full site control tools available'}
                    </span>
                  </div>
                  {pathname === '/study' && currentQuestion?.type === 'code' && (
                    <button
                      type="button"
                      className={styles.judgeCodeBtn}
                      onClick={handleQuickJudgeCode}
                      disabled={isJudgingCode}
                      title="Judge my code objectively"
                    >
                      {isJudgingCode ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                      <span>Judge My Code</span>
                    </button>
                  )}
                </div>

                {/* Conversation Scroll Area */}
                <div className={styles.chatStreamContainer}>
                  <div className={styles.messagesWrap}>
                    {messages.length === 0 ? (
                      <div className={styles.chatPlaceholder}>
                        <span className={styles.placeholderIcon}>✨</span>
                        <p>
                          {pathname === '/study' && currentQuestion?.type === 'code'
                            ? 'I inspect your code directly and report exact bugs without lecturing. Write in the editor and click "Judge My Code" or ask me directly.'
                            : pathname === '/study' && currentQuestion?.type === 'voice'
                            ? 'Speak your answer directly to me. I will evaluate your speech objectively and score your flashcard.'
                            : 'Hold Space or press the mic to talk, upload a file, or ask me to create decks, add questions, or navigate tests.'}
                        </p>
                      </div>
                    ) : (
                      messages.map((m) => (
                        <div
                          key={m.id}
                          className={cn(styles.msgRow, m.role === 'user' ? styles.user : styles.assistant)}
                        >
                          <div className={styles.msgBubble}>
                            <div dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(m.content) }} />
                            {m.role === 'assistant' && (
                              <div className={styles.msgBubbleFooter}>
                                <button
                                  type="button"
                                  className={styles.btnReadAloud}
                                  onClick={() => speakText(m.content)}
                                  title="Read message aloud"
                                >
                                  <Volume2 size={12} />
                                  <span>Listen</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                    {isJudgingCode && (
                      <div className={cn(styles.msgRow, styles.assistant, styles.thinkingRow)}>
                        <div className={styles.msgBubble}>
                          <div className={styles.thinkingWave}>
                            <span />
                            <span />
                            <span />
                          </div>
                          <span className={styles.thinkingLabel}>Evaluating code...</span>
                        </div>
                      </div>
                    )}
                    <div ref={chatBottomRef} />
                  </div>
                </div>

                {/* Bottom Command Bar: Attach, Type, Circular Mic button */}
                <footer className={styles.chatFooter}>
                  {/* Attachment Preview Chip */}
                  {attachedFile && (
                    <div className={styles.attachmentPreviewBar}>
                      <div className={styles.attachmentChip}>
                        <span className={styles.attachmentIcon}>📄</span>
                        <span className={styles.attachmentName}>{attachedFile.name}</span>
                        <span className={styles.attachmentSize}>({attachedFile.size})</span>
                        <button
                          type="button"
                          className={styles.btnRemoveAttachment}
                          onClick={handleRemoveAttachment}
                          title="Remove attachment"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}

                  <div className={styles.inputRow}>
                    {/* Manually Type Section with Attachment Tool Button */}
                    <div className={styles.typeContainer}>
                      <button
                        type="button"
                        className={styles.btnAttachClip}
                        onClick={() => fileInputRef.current?.click()}
                        title="Attach Document, Image, Audio, or Code"
                      >
                        <Paperclip size={16} strokeWidth={2.2} />
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        style={{ display: 'none' }}
                        accept="image/*,application/pdf,audio/*,video/*,.txt,.csv,.py,.js,.ts,.json"
                        onChange={handleFileSelect}
                      />

                      <textarea
                        value={inputQuery}
                        onChange={(e) => setInputQuery(e.target.value)}
                        placeholder="Ask anything, manage decks, or hold Space to talk..."
                        rows={1}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleSendMessage();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className={styles.btnSendPlane}
                        onClick={() => void handleSendMessage()}
                        disabled={!inputQuery.trim() && !attachedFile}
                        title="Send message (Enter)"
                      >
                        <Send size={15} strokeWidth={2.5} />
                      </button>
                    </div>

                    {/* Circular Mic Button (Supports Click toggle and Spacebar Push-to-Talk) */}
                    <div className={styles.micWrapper}>
                      <button
                        type="button"
                        className={cn(styles.btnMicCircle, isMicActive && styles.active)}
                        onClick={toggleMic}
                        title={isMicActive ? 'Listening... click to send' : 'Click to talk (or hold Spacebar)'}
                        aria-label="Microphone"
                      >
                        {isMicActive ? <MicOff size={20} /> : <Mic size={20} />}
                      </button>
                    </div>
                  </div>

                  <div className={styles.commandHints}>
                    <span>
                      <kbd>Space</kbd> Talk
                    </span>
                    <span className={styles.hintDot}>•</span>
                    <span>
                      <kbd>Enter</kbd> Send
                    </span>
                    <span className={styles.hintDot}>•</span>
                    <span>
                      <kbd>Shift+Enter</kbd> Line break
                    </span>
                  </div>
                </footer>
              </section>
            )}

            {/* PANEL 2: CONVERSATION HISTORY DRAWER */}
            {activePanel === 'history' && (
              <section className={cn(styles.cardPanel, styles.active)}>
                <div className={styles.panelInnerHeader}>
                  <button
                    type="button"
                    className={styles.btnBack}
                    onClick={() => setActivePanel('chat')}
                    title="Back to chat"
                  >
                    <ChevronLeft size={16} strokeWidth={2.5} />
                    <span>Back to Chat</span>
                  </button>
                  <h3 className={styles.panelTitle}>Conversation History</h3>
                  <button
                    type="button"
                    className={styles.btnActionGradient}
                    onClick={handleClearAllHistory}
                  >
                    Clear All
                  </button>
                </div>

                {/* Search Bar */}
                <div className={styles.panelSearchBar}>
                  <Search size={14} />
                  <input
                    type="text"
                    value={historySearchQuery}
                    onChange={(e) => setHistorySearchQuery(e.target.value)}
                    placeholder="Search conversations..."
                  />
                </div>

                {/* Sessions List */}
                <div className={styles.historyScrollList}>
                  {filteredSessions.length === 0 ? (
                    <div className={styles.historyEmpty}>
                      No conversations found. Start chatting to create history!
                    </div>
                  ) : (
                    filteredSessions.map((sess) => (
                      <div
                        key={sess.id}
                        className={cn(styles.historyRow, sess.id === currentSessionId && styles.active)}
                        onClick={() => handleSelectSession(sess.id)}
                      >
                        <div className={styles.historyRowContent}>
                          <span className={styles.historyRowTitle}>{sess.title}</span>
                          <span className={styles.historyRowMeta}>
                            {new Date(sess.updated_at * 1000).toLocaleDateString()} • {sess.message_count || 0} msgs
                          </span>
                        </div>
                        <div className={styles.historyRowActions}>
                          <button
                            type="button"
                            className={styles.btnShareRow}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentSessionId(sess.id);
                              setShowShareModal(true);
                            }}
                            title="Share conversation"
                          >
                            <Share2 size={13} />
                          </button>
                          <button
                            type="button"
                            className={styles.btnDeleteRow}
                            onClick={(e) => handleDeleteSession(e, sess.id)}
                            title="Delete conversation"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            )}

            {/* PANEL 3: SETTINGS & MODEL CONFIGURATION */}
            {activePanel === 'settings' && (
              <section className={cn(styles.cardPanel, styles.active)}>
                <div className={styles.panelInnerHeader}>
                  <button
                    type="button"
                    className={styles.btnBack}
                    onClick={() => setActivePanel('chat')}
                    title="Back to chat"
                  >
                    <ChevronLeft size={16} strokeWidth={2.5} />
                    <span>Back to Chat</span>
                  </button>
                  <h3 className={styles.panelTitle}>Settings</h3>
                </div>

                <div className={styles.settingsScrollBody}>
                  {/* LLM Engine Selection */}
                  <div className={styles.settingsGroup}>
                    <label>Primary Reasoning Model (Google Gemini)</label>
                    <CustomSelect
                      value={ai_model}
                      onChange={(val) => updateSetting('ai_model', val)}
                      options={AI_MODEL_OPTIONS}
                      searchable={false}
                    />
                    <small className={styles.fieldHint}>Supports automatic API key pooling with failover cooling.</small>
                  </div>

                  {/* Active Model Capabilities Card */}
                  <div className={styles.modelCapabilitiesCard}>
                    <div className={styles.modelCapHeader}>
                      <span className={styles.modelCapBadge}>{ai_model}</span>
                      <span className={styles.modelCapCost}>100% Free Tier</span>
                    </div>
                    <p className={styles.modelCapDesc}>Google AI Studio Multimodal Reasoning Engine</p>
                    <ul className={styles.modelCapList}>
                      <li>
                        <span className={styles.checkIcon}>✓</span> Full site tool manipulation (Decks, Questions, Theme)
                      </li>
                      <li>
                        <span className={styles.checkIcon}>✓</span> Native PDF OCR & Document Understanding
                      </li>
                      <li>
                        <span className={styles.checkIcon}>✓</span> Objective code judging without unprompted lecturing
                      </li>
                      <li>
                        <span className={styles.checkIcon}>✓</span> 33-shader WebGL Godray Orb visualizer
                      </li>
                      <li>
                        <span className={styles.checkIcon}>✓</span> LiveKit WebRTC Voice Pipeline with English lock
                      </li>
                    </ul>
                  </div>

                  {/* Multimodal OCR Checkbox */}
                  <div className={styles.settingsGroup}>
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                      <span>Multimodal OCR & Vision</span>
                      <input
                        type="checkbox"
                        checked={ocrEnabled}
                        onChange={(e) => setOcrEnabled(e.target.checked)}
                        style={{ width: '18px', height: '18px', accentColor: '#4F46E5', cursor: 'pointer' }}
                      />
                    </label>
                    <small className={styles.fieldHint}>Native Gemini vision for document parsing and image extraction.</small>
                  </div>

                  {/* Speech-to-Text Pipeline */}
                  <div className={styles.settingsGroup}>
                    <label>Speech-to-Text (STT) — English Only</label>
                    <CustomSelect
                      value={sttEngine}
                      onChange={(val) => setSttEngine(val)}
                      options={STT_OPTIONS}
                      searchable={false}
                    />
                    <small className={styles.fieldHint}>Acoustic turn-end detection and diarization.</small>
                  </div>

                  {/* Voice Synthesis Pipeline */}
                  <div className={styles.settingsGroup}>
                    <label>Text-to-Speech (TTS) — English Only</label>
                    <CustomSelect
                      value={ttsEngine}
                      onChange={(val) => setTtsEngine(val)}
                      options={TTS_OPTIONS}
                      searchable={false}
                    />
                    <small className={styles.fieldHint}>Ultra-low latency natural voice synthesis.</small>
                  </div>

                  {/* Persona / Voice Changer */}
                  <div className={styles.settingsGroup}>
                    <label>Assistant Persona / Voice Profile</label>
                    <CustomSelect
                      value={voicePersona}
                      onChange={(val) => setVoicePersona(val)}
                      options={VOICE_OPTIONS}
                      searchable={false}
                    />
                  </div>

                  {/* Diagnostics Box */}
                  <div className={styles.diagnosticsCard}>
                    <div className={styles.diagRow}>
                      <span>Primary LLM:</span>
                      <strong className={styles.textIndigo}>{ai_model}</strong>
                    </div>
                    <div className={styles.diagRow}>
                      <span>Multimodal OCR:</span>
                      <span className={styles.textEmerald}>{ocrEnabled ? 'Active (Gemini Vision)' : 'Disabled'}</span>
                    </div>
                    <div className={styles.diagRow}>
                      <span>Audio Transport:</span>
                      <span className={styles.textEmerald}>
                        {connectionStatus === 'connected' ? 'LiveKit WebRTC (Connected)' : 'Standby / WebRTC Ready'}
                      </span>
                    </div>
                    <div className={styles.diagRow}>
                      <span>Active Shader:</span>
                      <span className={styles.textEmerald}>{selectedShader}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className={styles.btnSaveSettings}
                    onClick={() => setActivePanel('chat')}
                  >
                    Apply & Save Settings
                  </button>
                </div>
              </section>
            )}
          </main>
        </div>
      )}

      {/* SHARE MODAL */}
      {showShareModal && (
        <div className={styles.shareModalOverlay} onClick={() => setShowShareModal(false)}>
          <div className={styles.shareModalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleWrap}>
                <div className={styles.shareIconCircle}>
                  <Share2 size={18} strokeWidth={2.2} />
                </div>
                <div>
                  <h3>Share Conversation</h3>
                  <p>{currentSessionId || 'Current Session'}</p>
                </div>
              </div>
              <button
                type="button"
                className={styles.btnCloseModal}
                onClick={() => setShowShareModal(false)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.shareOptionsGrid}>
                <div className={styles.shareCardOption}>
                  <div className={cn(styles.optIcon, styles.bgIndigo)}>
                    <Download size={20} />
                  </div>
                  <div className={styles.optText}>
                    <h4>Export Standalone Webpage (.html)</h4>
                    <p>Download a self-contained HTML file viewable offline in any browser.</p>
                  </div>
                  <button
                    type="button"
                    className={cn(styles.optActionBtn, styles.primary)}
                    onClick={handleDownloadHtml}
                  >
                    Download
                  </button>
                </div>

                <div className={styles.shareCardOption}>
                  <div className={cn(styles.optIcon, styles.bgEmerald)}>
                    <Share2 size={20} />
                  </div>
                  <div className={styles.optText}>
                    <h4>Shareable Web Viewer Link</h4>
                    <p>Open or share direct link to this conversation in read-only UI viewer.</p>
                    <input
                      type="text"
                      className={styles.shareLinkInput}
                      readOnly
                      value={typeof window !== 'undefined' ? `${window.location.origin}/study?agent_session=${currentSessionId}` : ''}
                    />
                  </div>
                  <button
                    type="button"
                    className={styles.optActionBtn}
                    onClick={handleCopyShareLink}
                  >
                    Copy Link
                  </button>
                </div>

                <div className={styles.shareCardOption}>
                  <div className={cn(styles.optIcon, styles.bgCyan)}>
                    <Copy size={20} />
                  </div>
                  <div className={styles.optText}>
                    <h4>Copy Full Transcript Markdown</h4>
                    <p>Copy formatted markdown for documentation, notes, or chat apps.</p>
                  </div>
                  <button
                    type="button"
                    className={styles.optActionBtn}
                    onClick={handleCopyMarkdown}
                  >
                    Copy Text
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ACCOUNT & SPEAKER PROFILE MODAL */}
      {showAccountModal && (
        <div className={styles.accountModalOverlay} onClick={() => setShowAccountModal(false)}>
          <div className={styles.accountModalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleWrap}>
                <div className={styles.shareIconCircle}>
                  <User size={18} strokeWidth={2.2} />
                </div>
                <div>
                  <h3>Account & Voice Biometrics</h3>
                  <p>Primary Owner (S1) Resonance Profile</p>
                </div>
              </div>
              <button
                type="button"
                className={styles.btnCloseModal}
                onClick={() => setShowAccountModal(false)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.settingsGroup}>
                <label>Display Name</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Enter your name"
                />
              </div>

              <div className={styles.settingsGroup} style={{ marginTop: '12px' }}>
                <label>Select Avatar Icon</label>
                <div className={styles.avatarPickerGrid}>
                  {AVATAR_CHOICES.map((av) => (
                    <button
                      key={av}
                      type="button"
                      className={cn(styles.avatarChoiceBtn, userAvatar === av && styles.selected)}
                      onClick={() => setUserAvatar(av)}
                    >
                      {av}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.diagnosticsCard} style={{ marginTop: '16px' }}>
                <div className={styles.diagRow}>
                  <span>Speaker Enrollment:</span>
                  <span className={styles.profileBadge}>S1 • Verified Primary</span>
                </div>
                <div className={styles.diagRow}>
                  <span>Voiceprint Resonance:</span>
                  <span className={styles.textEmerald}>128-D Embedding (91% Confidence)</span>
                </div>
                <div className={styles.diagRow}>
                  <span>Acoustic Diarization:</span>
                  <span className={styles.textIndigo}>Active Filter</span>
                </div>
              </div>

              <button
                type="button"
                className={styles.btnSaveSettings}
                style={{ width: '100%', marginTop: '16px' }}
                onClick={handleSaveProfile}
              >
                Save Profile
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
