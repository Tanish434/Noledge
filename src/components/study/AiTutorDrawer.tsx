'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Sparkles,
  X,
  Send,
  HelpCircle,
  Lightbulb,
  BookOpen,
  Settings as SettingsIcon,
  Key,
  ExternalLink,
  RotateCcw,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  Copy,
  type LucideIcon,
} from 'lucide-react';
import { useQuestionStore } from '@/stores/questionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { queryAiTutor, DEFAULT_MODELS, type ChatMessage, type AiTutorConfig } from '@/lib/aiTutor';
import { cn } from '@/utils/cn';
import styles from './AiTutorDrawer.module.css';

export default function AiTutorDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Settings store
  const { ai_provider, ai_api_key, ai_model, ai_custom_endpoint, updateSetting } = useSettingsStore();

  // Local config form state
  const [provider, setProvider] = useState(ai_provider || 'gemini');
  const [apiKey, setApiKey] = useState(ai_api_key || '');
  const [model, setModel] = useState(ai_model || 'gemini-2.0-flash');
  const [customEndpoint, setCustomEndpoint] = useState(ai_custom_endpoint || '');
  const [showKey, setShowKey] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Question context
  const { getCurrentQuestion, currentCardIndex, activeSession } = useQuestionStore();
  const currentQuestion = getCurrentQuestion();
  const prevQuestionIdRef = useRef<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const quickPromptsRef = useRef<HTMLDivElement>(null);
  const isDraggingPromptRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);

  const handlePromptMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!quickPromptsRef.current) return;
    isDraggingPromptRef.current = true;
    startXRef.current = e.pageX - quickPromptsRef.current.offsetLeft;
    scrollLeftRef.current = quickPromptsRef.current.scrollLeft;
  };

  const handlePromptMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingPromptRef.current || !quickPromptsRef.current) return;
    e.preventDefault();
    const x = e.pageX - quickPromptsRef.current.offsetLeft;
    const walk = (x - startXRef.current) * 1.5;
    quickPromptsRef.current.scrollLeft = scrollLeftRef.current - walk;
  };

  const handlePromptMouseUpOrLeave = () => {
    isDraggingPromptRef.current = false;
  };

  const handlePromptWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!quickPromptsRef.current) return;
    if (e.deltaY !== 0) {
      quickPromptsRef.current.scrollLeft += e.deltaY;
    }
  };

  // Sync config state when settings change
  useEffect(() => {
    setProvider(ai_provider || 'gemini');
    setApiKey(ai_api_key || '');
    setModel(ai_model || 'gemini-2.0-flash');
    setCustomEndpoint(ai_custom_endpoint || '');
  }, [ai_provider, ai_api_key, ai_model, ai_custom_endpoint]);

  // Open drawer event listener from FlashCard or other components
  useEffect(() => {
    const handleOpenAi = () => {
      setIsOpen(true);
    };
    window.addEventListener('noledge_open_ai_tutor', handleOpenAi);
    return () => {
      window.removeEventListener('noledge_open_ai_tutor', handleOpenAi);
    };
  }, []);

  // Sync data-ai-drawer-open attribute to document and notify AppShell
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('noledge-ai-drawer-state', { detail: { open: isOpen } }));
    }
    if (typeof document !== 'undefined') {
      if (isOpen) {
        document.documentElement.setAttribute('data-ai-drawer-open', 'true');
        document.body.setAttribute('data-ai-drawer-open', 'true');
      } else {
        document.documentElement.removeAttribute('data-ai-drawer-open');
        document.body.removeAttribute('data-ai-drawer-open');
      }
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('noledge-ai-drawer-state', { detail: { open: false } }));
      }
      if (typeof document !== 'undefined') {
        document.documentElement.removeAttribute('data-ai-drawer-open');
        document.body.removeAttribute('data-ai-drawer-open');
      }
    };
  }, [isOpen]);

  // When active question changes during a study session, notify or clean thread if desired
  useEffect(() => {
    if (currentQuestion && currentQuestion.id !== prevQuestionIdRef.current) {
      prevQuestionIdRef.current = currentQuestion.id;
      setErrorMessage(null);
    }
  }, [currentQuestion]);

  // Auto-scroll to latest message
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isThinking]);

  // Save AI Settings
  const handleSaveConfig = (e?: React.FormEvent) => {
    e?.preventDefault();
    updateSetting('ai_provider', provider);
    updateSetting('ai_api_key', apiKey.trim());
    updateSetting('ai_model', model);
    updateSetting('ai_custom_endpoint', customEndpoint.trim());
    setSavedSuccess(true);
    setErrorMessage(null);
    setTimeout(() => {
      setSavedSuccess(false);
      setShowConfig(false);
    }, 900);
  };

  // Provider changed in config form
  const handleProviderChange = (newProvider: 'gemini' | 'openai' | 'groq' | 'openrouter' | 'custom') => {
    setProvider(newProvider);
    const models = DEFAULT_MODELS[newProvider];
    if (models && models.length > 0) {
      setModel(models[0]!.id);
    }
  };

  // Send prompt to AI
  const handleSendPrompt = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || isThinking) return;

    const currentKey = (apiKey || ai_api_key || '').trim();
    if (!currentKey && provider !== 'custom') {
      setShowConfig(true);
      setErrorMessage(`Please enter your ${provider.toUpperCase()} API key below to start chatting with AI Tutor.`);
      return;
    }

    setErrorMessage(null);
    const updatedMessages: ChatMessage[] = [...messages, { sender: 'user', text: trimmed }];
    setMessages(updatedMessages);
    setQuery('');
    setIsThinking(true);

    const config: AiTutorConfig = {
      provider,
      apiKey: currentKey,
      model: model || (DEFAULT_MODELS[provider]?.[0]?.id ?? 'default'),
      customEndpoint,
    };

    try {
      const reply = await queryAiTutor(
        currentQuestion,
        messages,
        trimmed,
        config
      );
      setMessages([...updatedMessages, { sender: 'ai', text: reply }]);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Failed to get response from AI Tutor.';
      setErrorMessage(msg);
      setMessages([
        ...updatedMessages,
        {
          sender: 'ai',
          text: `⚠️ **AI Tutor Error:**\n${msg}\n\n*Click the Settings gear at the top right to verify or update your API key.*`,
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleClearHistory = () => {
    setMessages([]);
    setErrorMessage(null);
  };

  const currentModels = DEFAULT_MODELS[provider] || [];

  return (
    <>
      {/* Floating AI Tutor Toggle Button */}
      {!isOpen && (
        <button
          type="button"
          className={styles.floatingAiBtn}
          onClick={() => setIsOpen(true)}
          aria-label="Open AI Tutor"
          title="Ask AI Tutor (Current Question Context)"
        >
          <Bot size={18} />
          <span className={styles.aiBtnText}>AI Tutor</span>
          <Sparkles size={14} className={styles.sparkleIcon} />
        </button>
      )}

      {/* AI Tutor Opaque Drawer Panel */}
      {isOpen && (
        <aside className={styles.drawerOverlay} onClick={() => setIsOpen(false)}>
          <div className={styles.drawerCard} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <header className={styles.drawerHeader}>
              <div className={styles.headerTitleGroup}>
                <div className={styles.botAvatar}>
                  <Bot size={20} />
                </div>
                <div>
                  <h3 className={styles.drawerTitle}>AI Tutor Studio</h3>
                  <span className={styles.drawerSubtitle}>
                    {provider.toUpperCase()} · {model}
                  </span>
                </div>
              </div>
              <div className={styles.headerActionBtns}>
                <button
                  type="button"
                  className={cn(styles.headerIconBtn, showConfig && styles.activeIconBtn)}
                  onClick={() => setShowConfig((prev) => !prev)}
                  aria-label="AI Settings & API Key"
                  title="Configure AI API Key & Model"
                >
                  <SettingsIcon size={17} />
                </button>
                <button
                  type="button"
                  className={styles.headerIconBtn}
                  onClick={handleClearHistory}
                  aria-label="Clear chat history"
                  title="Reset conversation"
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  type="button"
                  className={cn(styles.headerIconBtn, styles.closeCrossBtn)}
                  onClick={() => setIsOpen(false)}
                  aria-label="Close AI Tutor"
                  title="Close AI Tutor (Esc)"
                >
                  <X size={20} strokeWidth={2.2} />
                </button>
              </div>
            </header>

            {/* Current Question Context Badge */}
            {currentQuestion ? (
              <div className={styles.questionContextBadge}>
                <span className={styles.contextTypeTag}>
                  {currentQuestion.type.toUpperCase()}
                </span>
                <span className={styles.contextQuestionText}>
                  {currentQuestion.content}
                </span>
              </div>
            ) : (
              <div className={styles.questionContextBadge}>
                <span className={styles.contextTypeTag}>GENERAL</span>
                <span className={styles.contextQuestionText}>
                  No question active — General AI Learning Assistant
                </span>
              </div>
            )}

            {/* Content Area: Config View OR Chat View */}
            {showConfig ? (
              <div className={styles.configContainer}>
                <div className={styles.configHeader}>
                  <Key size={18} className={styles.configHeaderIcon} />
                  <div>
                    <h4 className={styles.configTitle}>AI Provider & API Key</h4>
                    <p className={styles.configDesc}>
                      Connect your own free API key. Keys are stored locally on your device only.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSaveConfig} className={styles.configForm}>
                  {/* Provider Selection */}
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Provider</label>
                    <div className={styles.providerGrid}>
                      {(['gemini', 'openai', 'groq', 'openrouter', 'custom'] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={cn(styles.providerChoiceBtn, provider === p && styles.selectedProvider)}
                          onClick={() => handleProviderChange(p)}
                        >
                          {p === 'gemini' && 'Google Gemini'}
                          {p === 'openai' && 'OpenAI'}
                          {p === 'groq' && 'Groq (Ultra-Fast)'}
                          {p === 'openrouter' && 'OpenRouter'}
                          {p === 'custom' && 'Custom (Local / Ollama)'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Model Selection */}
                  {provider !== 'custom' && (
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>Model</label>
                      <select
                        className={styles.selectInput}
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                      >
                        {currentModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Custom Endpoint */}
                  {provider === 'custom' && (
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>Endpoint URL</label>
                      <input
                        type="text"
                        className={styles.textInput}
                        placeholder="http://localhost:11434/v1/chat/completions"
                        value={customEndpoint}
                        onChange={(e) => setCustomEndpoint(e.target.value)}
                      />
                    </div>
                  )}

                  {/* API Key Input */}
                  {provider !== 'custom' && (
                    <div className={styles.fieldGroup}>
                      <div className={styles.fieldHeaderWithLink}>
                        <label className={styles.fieldLabel}>API Key</label>
                        {provider === 'gemini' && (
                          <a
                            href="https://aistudio.google.com/app/apikey"
                            target="_blank"
                            rel="noreferrer"
                            className={styles.getKeyLink}
                          >
                            Get Free Gemini Key <ExternalLink size={11} />
                          </a>
                        )}
                        {provider === 'openai' && (
                          <a
                            href="https://platform.openai.com/api-keys"
                            target="_blank"
                            rel="noreferrer"
                            className={styles.getKeyLink}
                          >
                            OpenAI API Keys <ExternalLink size={11} />
                          </a>
                        )}
                        {provider === 'groq' && (
                          <a
                            href="https://console.groq.com/keys"
                            target="_blank"
                            rel="noreferrer"
                            className={styles.getKeyLink}
                          >
                            Free Groq Keys <ExternalLink size={11} />
                          </a>
                        )}
                        {provider === 'openrouter' && (
                          <a
                            href="https://openrouter.ai/keys"
                            target="_blank"
                            rel="noreferrer"
                            className={styles.getKeyLink}
                          >
                            OpenRouter Keys <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                      <div className={styles.keyInputWrap}>
                        <input
                          type={showKey ? 'text' : 'password'}
                          className={styles.textInput}
                          placeholder={`Enter your ${provider.toUpperCase()} API key`}
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                        />
                        <button
                          type="button"
                          className={styles.eyeBtn}
                          onClick={() => setShowKey((v) => !v)}
                          aria-label={showKey ? 'Hide key' : 'Show key'}
                        >
                          {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Submit Button */}
                  <div className={styles.configActions}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowConfig(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      style={{ gap: 6 }}
                    >
                      {savedSuccess ? (
                        <>
                          <Check size={15} /> Saved & Connected!
                        </>
                      ) : (
                        <>
                          <Key size={15} /> Save & Connect
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <>
                {/* Quick Action Prompt Chips */}
                <div
                  ref={quickPromptsRef}
                  className={styles.quickPrompts}
                  onWheel={handlePromptWheel}
                  onMouseDown={handlePromptMouseDown}
                  onMouseMove={handlePromptMouseMove}
                  onMouseUp={handlePromptMouseUpOrLeave}
                  onMouseLeave={handlePromptMouseUpOrLeave}
                  role="region"
                  aria-label="Quick AI prompt tags"
                >
                  <button
                    type="button"
                    className={styles.promptChip}
                    onClick={() => handleSendPrompt("Explain this question conceptually in simple terms")}
                  >
                    <Lightbulb size={13} /> Explain simply
                  </button>
                  <button
                    type="button"
                    className={styles.promptChip}
                    onClick={() => handleSendPrompt("Give me a clever mnemonic to remember this answer")}
                  >
                    <Sparkles size={13} /> Give mnemonic
                  </button>
                  <button
                    type="button"
                    className={styles.promptChip}
                    onClick={() => handleSendPrompt("What makes the wrong options tricky or incorrect?")}
                  >
                    <HelpCircle size={13} /> Why are others wrong?
                  </button>
                  <button
                    type="button"
                    className={styles.promptChip}
                    onClick={() => handleSendPrompt("Give a practical real-world production example")}
                  >
                    <BookOpen size={13} /> Real-world example
                  </button>
                  <button
                    type="button"
                    className={styles.promptChip}
                    onClick={() => handleSendPrompt("Give me a subtle Socratic hint without spoiling the answer")}
                  >
                    <Lightbulb size={13} /> Give hint
                  </button>
                </div>

                {/* Chat Message Body */}
                <div className={styles.chatBody}>
                  {messages.length === 0 ? (
                    <div className={styles.emptyAiState}>
                      <div className={styles.emptyIconRing}>
                        <Sparkles size={28} />
                      </div>
                      <h4 className={styles.emptyTitle}>Ask AI Tutor Anything</h4>
                      <p className={styles.emptyDesc}>
                        The AI Tutor is tuned to <strong>this specific question</strong>. Ask for clarification, step-by-step logic, code breakdown, or memory aids!
                      </p>
                      {(!ai_api_key && provider !== 'custom') && (
                        <button
                          type="button"
                          className={styles.setupKeyPromptBtn}
                          onClick={() => setShowConfig(true)}
                        >
                          <Key size={14} /> Connect API Key to Start
                        </button>
                      )}
                    </div>
                  ) : (
                    messages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          styles.chatBubble,
                          msg.sender === 'user' ? styles.userBubble : styles.aiBubble
                        )}
                      >
                        <div className={styles.bubbleSenderRow}>
                          <span className={styles.bubbleSenderName}>
                            {msg.sender === 'user' ? 'You' : 'AI Tutor'}
                          </span>
                        </div>
                        <div className={styles.bubbleContent}>
                          {msg.text.split('\n').map((line, lIdx) => (
                            <p key={lIdx} style={{ margin: line ? '0.25rem 0' : '0.5rem 0' }}>
                              {line}
                            </p>
                          ))}
                        </div>
                      </div>
                    ))
                  )}

                  {isThinking && (
                    <div className={cn(styles.chatBubble, styles.aiBubble, styles.thinkingBubble)}>
                      <div className={styles.typingIndicator}>
                        <span className={styles.typingDot} />
                        <span className={styles.typingDot} />
                        <span className={styles.typingDot} />
                      </div>
                      <span className={styles.thinkingText}>AI Tutor is analyzing question...</span>
                    </div>
                  )}

                  <div ref={chatBottomRef} />
                </div>

                {/* Input Bar */}
                <form
                  className={styles.inputBar}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleSendPrompt(query);
                  }}
                >
                  <input
                    type="text"
                    className={styles.chatInput}
                    placeholder={
                      currentQuestion
                        ? `Ask anything about this question...`
                        : `Ask AI Tutor a question...`
                    }
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={isThinking}
                  />
                  <button
                    type="submit"
                    className={styles.sendBtn}
                    disabled={!query.trim() || isThinking}
                    aria-label="Send query"
                  >
                    <Send size={16} />
                  </button>
                </form>
              </>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
