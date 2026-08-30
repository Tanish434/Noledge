/**
 * @file lib/aiTutor.ts
 * @description AI Tutor integration service supporting Google Gemini, OpenAI, Groq, OpenRouter, and custom endpoints.
 */

import type { Question } from '@/types/question';

export interface ChatMessage {
  sender: 'user' | 'ai';
  text: string;
}

export interface AiTutorConfig {
  provider: 'gemini' | 'openai' | 'groq' | 'openrouter' | 'custom';
  apiKey: string;
  model: string;
  customEndpoint?: string;
}

export const DEFAULT_MODELS: Record<string, { id: string; name: string }[]> = {
  gemini: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Recommended)' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (Fast)' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Deep reasoning)' },
  ],
  openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast & Smart)' },
    { id: 'gpt-4o', name: 'GPT-4o (Most capable)' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Ultra-fast)' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B (Instant)' },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
  ],
  openrouter: [
    { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free tier)' },
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct' },
    { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku' },
  ],
  custom: [
    { id: 'default', name: 'Custom Model' },
  ],
};

/**
 * Format the single question context into a clear, structured prompt for the AI.
 */
export function formatQuestionContext(question: Question | null): string {
  if (!question) return 'No question is currently selected.';

  const parts: string[] = [];
  parts.push(`QUESTION PROMPT: ${question.content}`);
  parts.push(`QUESTION TYPE: ${question.type.toUpperCase()}`);
  parts.push(`DIFFICULTY: ${question.difficulty.toUpperCase()}`);

  if (question.options && question.options.length > 0) {
    const optionsFormatted = question.options
      .map((opt, idx) => {
        const letter = String.fromCharCode(65 + idx);
        const correctTag = opt.is_correct ? ' (Correct)' : '';
        return `  ${letter}. ${opt.content}${correctTag}`;
      })
      .join('\n');
    parts.push(`OPTIONS:\n${optionsFormatted}`);
  }

  if (question.answer) {
    const ansText = Array.isArray(question.answer)
      ? question.answer.join(', ')
      : String(question.answer);
    parts.push(`CORRECT ANSWER: ${ansText}`);
  }

  if (question.explanation) {
    parts.push(`OFFICIAL EXPLANATION: ${question.explanation}`);
  }

  if (question.accepted_answers && question.accepted_answers.length > 0) {
    parts.push(`ACCEPTED ANSWERS: ${question.accepted_answers.join(' | ')}`);
  }

  if (question.aliases && question.aliases.length > 0) {
    parts.push(`ALIASES / SYNONYMS: ${question.aliases.join(' | ')}`);
  }

  if (question.code_language) {
    parts.push(`CODE LANGUAGE: ${question.code_language}`);
  }

  if (question.blanks && question.blanks.length > 0) {
    const blanksFormatted = question.blanks
      .map((b, i) => `  Blank ${i + 1}: ${b.accepted_answers.join(' / ')}`)
      .join('\n');
    parts.push(`BLANKS:\n${blanksFormatted}`);
  }

  if (question.pairs && question.pairs.length > 0) {
    const pairsFormatted = question.pairs
      .map((p) => `  ${p.left} ➔ ${p.right}`)
      .join('\n');
    parts.push(`MATCHING PAIRS:\n${pairsFormatted}`);
  }

  if (question.order_items && question.order_items.length > 0) {
    const orderFormatted = question.order_items
      .map((it, i) => `  ${i + 1}. ${it}`)
      .join('\n');
    parts.push(`CORRECT SEQUENCE:\n${orderFormatted}`);
  }

  return parts.join('\n\n');
}

/**
 * Build system prompt with pedagogical guidelines for Noledge AI Tutor.
 */
function buildSystemPrompt(question: Question | null): string {
  const qContext = formatQuestionContext(question);

  return `You are Noledge AI Tutor — an expert, encouraging, pedagogical, and highly intelligent private study assistant.

CURRENT QUESTION CONTEXT:
${qContext}

TUTOR GUIDELINES:
1. You are specifically tutoring the student on the single question above.
2. If the user asks why an answer is wrong or right, provide a clear, insightful conceptual breakdown.
3. If the user asks for a hint, provide a clever guiding question or mental model without revealing the answer immediately.
4. If the user asks for a mnemonic, analogy, or real-world example, generate creative, highly memorable explanations.
5. If the user asks free-form questions or questions related to the topic, answer comprehensively and clearly.
6. Use clean GitHub-flavored markdown formatting (bold key points, bullet lists, short code snippets).
7. Keep responses engaging, supportive, and concise (avoid unnecessary fluff).`;
}

/**
 * Call Google Gemini API
 */
async function callGeminiApi(
  config: AiTutorConfig,
  systemPrompt: string,
  history: ChatMessage[],
  currentPrompt: string
): Promise<string> {
  const model = config.model || 'gemini-2.0-flash';
  const apiKey = config.apiKey.trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  // Add conversation history
  for (const msg of history) {
    contents.push({
      role: msg.sender === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }],
    });
  }

  // Add latest user prompt
  contents.push({
    role: 'user',
    parts: [{ text: currentPrompt }],
  });

  const body = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const message = errData?.error?.message || `Gemini API returned status ${res.status}`;
    throw new Error(message);
  }

  const data = await res.json();
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!reply) {
    throw new Error('No response received from Gemini model.');
  }

  return reply;
}

/**
 * Call OpenAI-compatible Chat Completions API (OpenAI, Groq, OpenRouter, Custom)
 */
async function callOpenAiCompatibleApi(
  config: AiTutorConfig,
  systemPrompt: string,
  history: ChatMessage[],
  currentPrompt: string
): Promise<string> {
  let endpoint = 'https://api.openai.com/v1/chat/completions';
  let defaultModel = 'gpt-4o-mini';

  if (config.provider === 'groq') {
    endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    defaultModel = 'llama-3.3-70b-versatile';
  } else if (config.provider === 'openrouter') {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    defaultModel = 'google/gemini-2.0-flash-exp:free';
  } else if (config.provider === 'custom') {
    endpoint = config.customEndpoint || 'http://localhost:11434/v1/chat/completions';
    defaultModel = config.model || 'default';
  }

  const model = config.model || defaultModel;
  const apiKey = config.apiKey.trim();

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  for (const msg of history) {
    messages.push({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.text,
    });
  }

  messages.push({ role: 'user', content: currentPrompt });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://noledge.app';
    headers['X-Title'] = 'Noledge AI Tutor';
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const message = errData?.error?.message || `${config.provider.toUpperCase()} API returned status ${res.status}`;
    throw new Error(message);
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content;
  if (!reply) {
    throw new Error(`No response text returned from ${config.provider} model.`);
  }

  return reply;
}

/**
 * Main query function for AI Tutor.
 */
export async function queryAiTutor(
  question: Question | null,
  history: ChatMessage[],
  prompt: string,
  config: AiTutorConfig
): Promise<string> {
  const apiKey = config.apiKey?.trim();

  if (!apiKey && config.provider !== 'custom') {
    throw new Error(
      `Please provide your ${config.provider.toUpperCase()} API key to use AI Tutor.`
    );
  }

  const systemPrompt = buildSystemPrompt(question);

  if (config.provider === 'gemini') {
    return await callGeminiApi(config, systemPrompt, history, prompt);
  }

  return await callOpenAiCompatibleApi(config, systemPrompt, history, prompt);
}
