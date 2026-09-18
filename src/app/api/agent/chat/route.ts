import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { AGENT_BACKEND_PORT, getAgentEnv } from '@/lib/agentServer';

const AVATAR_MAP: Record<string, string> = {
  earth: '🌍',
  world: '🌍',
  globe: '🌎',
  sword: '⚔️',
  swords: '⚔️',
  shield: '🛡️',
  lightning: '⚡',
  thunder: '⚡',
  bolt: '⚡',
  crystal: '🔮',
  magic: '🔮',
  orb: '🔮',
  brain: '🧠',
  mind: '🧠',
  rocket: '🚀',
  space: '🌌',
  target: '🎯',
  diamond: '💎',
  gem: '💎',
  fox: '🦊',
  star: '⭐',
  fire: '🔥',
  flame: '🔥',
  cat: '🐱',
  robot: '🤖',
};

function getAllGeminiKeys(): string[] {
  const keys: string[] = [];
  const env = getAgentEnv();
  if (env.GEMINI_API_KEY) keys.push(env.GEMINI_API_KEY);
  if (env.GOOGLE_API_KEY && !keys.includes(env.GOOGLE_API_KEY)) keys.push(env.GOOGLE_API_KEY);

  try {
    const keysJsonPath = path.join(process.cwd(), 'agent', 'src', 'gemini_keys.json');
    if (fs.existsSync(keysJsonPath)) {
      const data = JSON.parse(fs.readFileSync(keysJsonPath, 'utf-8'));
      if (data.keys) {
        Object.values(data.keys).forEach((item: any) => {
          if (item?.api_key && item.status === 'active' && !keys.includes(item.api_key)) {
            keys.push(item.api_key);
          }
        });
      }
    }
  } catch {
    // Ignore error
  }
  return keys;
}

// Full Gemini Function Declarations matching site capabilities and memory.py
const GEMINI_FUNCTION_DECLARATIONS = [
  {
    name: 'clear_chat_history',
    description: 'Permanently delete, wipe, and clear all past conversation sessions from history. Use this whenever the user asks to delete past sessions, delete all chats, clear history, or wipe sessions.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'delete_chat_session',
    description: 'Delete a specific conversation session or the current chat session.',
    parameters: {
      type: 'OBJECT',
      properties: {
        session_id: { type: 'STRING', description: 'Session ID to delete. If omitted, deletes the active session.' },
      },
    },
  },
  {
    name: 'create_deck',
    description: 'Create a new flashcard deck for studying.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Name of the deck' },
        description: { type: 'STRING', description: 'Short description of deck topics' },
      },
      required: ['name'],
    },
  },
  {
    name: 'delete_deck',
    description: 'Delete a card deck by its name or ID.',
    parameters: {
      type: 'OBJECT',
      properties: {
        deck_id: { type: 'STRING', description: 'Deck ID or deck name to delete' },
      },
      required: ['deck_id'],
    },
  },
  {
    name: 'get_decks',
    description: 'List all existing flashcard study decks and card counts.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'add_question',
    description: 'Add a new flashcard/question to a deck.',
    parameters: {
      type: 'OBJECT',
      properties: {
        content: { type: 'STRING', description: 'Question prompt text' },
        answer: { type: 'STRING', description: 'Correct answer' },
        type: { type: 'STRING', description: 'Question type: mcq, tf, code, open, blank' },
        explanation: { type: 'STRING', description: 'Explanation' },
        options: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Options if MCQ' },
      },
      required: ['content', 'answer'],
    },
  },
  {
    name: 'delete_question',
    description: 'Delete a flashcard/question from the current deck by question ID.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'Question ID to remove' },
      },
      required: ['id'],
    },
  },
  {
    name: 'change_avatar',
    description: 'Change user avatar emoji (e.g. 🌍, 🛡️, ⚔️, ⚡, 🔮, 🧠, 🚀, 🔥, ⭐, 🤖).',
    parameters: {
      type: 'OBJECT',
      properties: {
        avatar: { type: 'STRING', description: 'Avatar emoji' },
      },
      required: ['avatar'],
    },
  },
  {
    name: 'change_name',
    description: 'Change user display name.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'New username' },
      },
      required: ['name'],
    },
  },
  {
    name: 'navigate_to',
    description: 'Navigate to any page on the website (/study, /manage, /create, /settings).',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Target route path: /study, /manage, /create, /settings' },
      },
      required: ['path'],
    },
  },
  {
    name: 'change_theme',
    description: 'Switch between dark theme and light theme.',
    parameters: {
      type: 'OBJECT',
      properties: {
        theme: { type: 'STRING', description: "'dark' or 'light'" },
      },
      required: ['theme'],
    },
  },
  {
    name: 'switch_orb_shader',
    description: 'Switch the visual 3D WebGL orb shader (shdr-01 to shdr-33 or name like godrays, plasma, water).',
    parameters: {
      type: 'OBJECT',
      properties: {
        variant_or_query: { type: 'STRING', description: 'Shader key or description' },
      },
      required: ['variant_or_query'],
    },
  },
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      message = '',
      session_id = '',
      user_name = 'User',
      user_avatar = '⚔️',
      context = {},
      history: clientHistory = [],
    } = body;

    const trimmedMsg = message.trim();
    if (!trimmedMsg) {
      return NextResponse.json({ success: false, error: 'Message is empty' }, { status: 400 });
    }

    const lower = trimmedMsg.toLowerCase();

    // ── 0. FAST-PATH: New Chat / Open Fresh Session ────────────────────────
    if (
      /(?:(?:switch\s+to|open|start|create|begin)\s+(?:a\s+)?(?:brand\s+)?new\s+chat|^new\s+chat$)/i.test(lower) ||
      lower === 'new chat' ||
      lower === 'open new chat' ||
      lower === 'start new chat'
    ) {
      return NextResponse.json({
        success: true,
        action: 'create_new_chat',
        text: '✨ Opened a fresh new chat session for you.',
      });
    }

    // ── 1. FAST-PATH: Clear / Delete Past Sessions Tool ───────────────────
    const isClearAllHistory =
      /(?:delete|clear|wipe|remove|clean|reset)\s+(?:all\s+)?(?:the\s+)?(?:chat\s+)?(?:history|sess?i+ons?)/i.test(lower) ||
      (lower.includes('delete') && (lower.includes('history') || lower.includes('session') || lower.includes('chat')));

    if (isClearAllHistory && !lower.includes('this session') && !lower.includes('current session')) {
      return NextResponse.json({
        success: true,
        action: 'clear_chat_history',
        text: '🧹 All past conversation sessions have been permanently cleared. Starting a fresh session!',
      });
    }

    if (
      /(?:delete|clear|wipe|remove)\s+(?:this|current)\s+(?:chat|sess?i+on)/i.test(lower) ||
      lower === 'delete session' ||
      lower === 'delete this session' ||
      lower === 'delete this chat' ||
      lower === 'delete current session' ||
      lower === 'clear this chat'
    ) {
      return NextResponse.json({
        success: true,
        action: 'delete_chat_session',
        params: { session_id },
        text: '🗑️ This conversation session has been deleted.',
      });
    }

    // ── FAST-PATH: Change App / Switch Page Commands ─────────────────────
    if (
      lower.includes('change the app') ||
      lower.includes('switch the app') ||
      lower.includes('change app') ||
      lower.includes('switch app')
    ) {
      const target = lower.includes('study')
        ? '/study'
        : lower.includes('manage')
        ? '/manage'
        : lower.includes('create')
        ? '/create'
        : context.path === '/study'
        ? '/manage'
        : '/study';
      return NextResponse.json({
        success: true,
        action: 'navigate_to',
        params: { path: target },
        text: `🚀 Navigating to **${target === '/study' ? 'Study Mode' : target === '/manage' ? 'Deck Manager' : 'Deck Creator'}**.`,
      });
    }

    // ── 2. FAST-PATH: Avatar Change Commands ─────────────────────────────
    if (lower.includes('avatar') && (lower.includes('change') || lower.includes('set') || lower.includes('switch') || lower.includes('to'))) {
      let matchedAvatar = '';
      for (const [name, emoji] of Object.entries(AVATAR_MAP)) {
        if (lower.includes(name)) {
          matchedAvatar = emoji;
          break;
        }
      }
      const emojiMatch = trimmedMsg.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u);
      if (emojiMatch) {
        matchedAvatar = emojiMatch[0];
      }

      if (matchedAvatar) {
        return NextResponse.json({
          success: true,
          action: 'change_avatar',
          params: { avatar: matchedAvatar },
          text: `I've updated your avatar to ${matchedAvatar}!`,
        });
      }
    }

    // ── 3. FAST-PATH: Name Change Commands ───────────────────────────────
    if (
      (lower.startsWith('my name is') || lower.startsWith('call me') || lower.startsWith('change name to')) &&
      !lower.includes('?')
    ) {
      const parts = trimmedMsg.split(/(?:my name is|call me|change name to)\s+/i);
      if (parts.length > 1 && parts[1].trim()) {
        const newName = parts[1].trim().replace(/[.!,]$/g, '');
        return NextResponse.json({
          success: true,
          action: 'change_name',
          params: { name: newName },
          text: `Nice to meet you, **${newName}**! I've updated your profile.`,
        });
      }
    }

    // ── 4. FAST-PATH: Decks & Navigation Commands ────────────────────────
    if (lower.startsWith('create deck') || lower.startsWith('create a deck') || lower.includes('new deck')) {
      const match = trimmedMsg.match(/deck\s+(?:called|named)?\s*["']?([^"'\n]+)["']?/i);
      const deckName = match ? match[1].trim() : 'New Deck';
      return NextResponse.json({
        success: true,
        action: 'create_deck',
        params: { name: deckName, description: 'Created by Voice AI' },
        text: `✨ Created new deck **"${deckName}"**! You can now add flashcards or study it.`,
      });
    }

    if (lower.startsWith('delete deck') || lower.startsWith('remove deck')) {
      const match = trimmedMsg.match(/deck\s+["']?([^"'\n]+)["']?/i);
      const deckName = match ? match[1].trim() : '';
      return NextResponse.json({
        success: true,
        action: 'delete_deck',
        params: { deck_id: deckName },
        text: `🗑️ Deleted deck **"${deckName}"**.`,
      });
    }

    if (lower.includes('open study') || lower.includes('start test') || lower.includes('study mode')) {
      return NextResponse.json({
        success: true,
        action: 'navigate_to',
        params: { path: '/study' },
        text: '🚀 Navigating to **Study Test**.',
      });
    }

    if (lower.includes('open manage') || lower.includes('deck manager')) {
      return NextResponse.json({
        success: true,
        action: 'navigate_to',
        params: { path: '/manage' },
        text: '📚 Navigating to **Deck Manager**.',
      });
    }

    if (lower.includes('open create') || lower.includes('deck creator')) {
      return NextResponse.json({
        success: true,
        action: 'navigate_to',
        params: { path: '/create' },
        text: '✏️ Navigating to **Deck Creator**.',
      });
    }

    if (lower.includes('theme') && (lower.includes('dark') || lower.includes('light') || lower.includes('toggle') || lower.includes('switch'))) {
      const targetTheme = lower.includes('light') ? 'light' : 'dark';
      return NextResponse.json({
        success: true,
        action: 'change_theme',
        params: { theme: targetTheme },
        text: `🎨 Switched to **${targetTheme} theme**.`,
      });
    }

    // ── 5. Try Python Backend Server first ──────────────────────────────
    try {
      const pyRes = await fetch(`http://localhost:${AGENT_BACKEND_PORT}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmedMsg,
          session_id,
          user_name,
          context,
        }),
        signal: AbortSignal.timeout(3000),
      });

      if (pyRes.ok) {
        const pyData = await pyRes.json();
        if (pyData.success && pyData.text) {
          return NextResponse.json(pyData);
        }
      }
    } catch {
      // Backend not running or timeout; fall back to direct Gemini API with tools
    }

    // ── 6. Direct Google Gemini Call with Tools & Key Pool ───────────────
    const apiKeys = getAllGeminiKeys();
    const systemInstruction = [
      `You are Aliph1, an elite AI voice & study assistant for the Noledge learning and flashcard application.`,
      `The user's name is "${user_name}" (avatar: ${user_avatar}).`,
      `You are equipped with tools to manipulate decks, questions, history, sessions, shaders, avatars, themes, and navigation.`,
      `CRITICAL: When the user asks you to perform an action (e.g. "delete past sessions", "clear history", "create deck", "delete deck", "change avatar", "navigate to study"), ALWAYS call the relevant tool instead of explaining manual steps!`,
      `You are friendly, concise, intelligent, and helpful. Format your answers in clean, readable Markdown.`,
      context.question
        ? `CURRENT QUESTION CONTEXT:
- Type: ${context.question.type}
- Prompt: ${context.question.content}
- Answer: ${JSON.stringify(context.question.answer)}
- Explanation: ${context.question.explanation || 'None'}
- Hints: ${JSON.stringify(context.question.hints || [])}
- Active Deck: ${context.deck_name || 'Study'} (Card ${Number(context.card_index || 0) + 1})`
        : `Active screen: ${context.path || '/'} (${context.deck_name || 'Dashboard'}).`,
      `Give direct, insightful answers without unnecessary fluff.`,
    ].join('\n\n');

    const contents: any[] = [];
    if (Array.isArray(clientHistory)) {
      const recent = clientHistory.slice(-6);
      for (const m of recent) {
        if (m.content && m.role) {
          contents.push({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }],
          });
        }
      }
    }

    contents.push({
      role: 'user',
      parts: [{ text: trimmedMsg }],
    });

    const modelsToTry = [
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-flash-latest',
      'gemini-pro-latest',
    ];

    for (const key of apiKeys) {
      for (const model of modelsToTry) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
          const gRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: systemInstruction }],
              },
              contents,
              tools: [
                {
                  functionDeclarations: GEMINI_FUNCTION_DECLARATIONS,
                },
              ],
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1024,
              },
            }),
            signal: AbortSignal.timeout(12000),
          });

          if (gRes.ok) {
            const data = await gRes.json();
            const parts = data.candidates?.[0]?.content?.parts || [];

            // Check if Gemini invoked a function call tool
            const fnPart = parts.find((p: any) => p.functionCall);
            if (fnPart && fnPart.functionCall) {
              const fn = fnPart.functionCall;
              const fnName = fn.name;
              const fnArgs = fn.args || {};

              let confirmText = `Action **${fnName}** executed successfully.`;
              if (fnName === 'clear_chat_history') {
                confirmText = '🧹 All past conversation sessions have been permanently cleared. Starting a fresh session!';
              } else if (fnName === 'delete_chat_session') {
                confirmText = '🗑️ Session deleted.';
              } else if (fnName === 'create_deck') {
                confirmText = `✨ Created new deck **"${fnArgs.name || 'New Deck'}"**!`;
              } else if (fnName === 'delete_deck') {
                confirmText = `🗑️ Deleted deck **"${fnArgs.deck_id || ''}"**.`;
              } else if (fnName === 'add_question') {
                confirmText = `✨ Added new card: **"${fnArgs.content || ''}"** (Answer: ${fnArgs.answer || ''}).`;
              } else if (fnName === 'delete_question') {
                confirmText = `🗑️ Deleted card.`;
              } else if (fnName === 'change_avatar') {
                confirmText = `I've updated your avatar to ${fnArgs.avatar || '🌍'}!`;
              } else if (fnName === 'change_name') {
                confirmText = `Updated your name to **${fnArgs.name || 'Kirito'}**.`;
              } else if (fnName === 'navigate_to') {
                confirmText = `Navigating to **${fnArgs.path || '/study'}**.`;
              } else if (fnName === 'change_theme') {
                confirmText = `🎨 Switched to **${fnArgs.theme || 'dark'} theme**.`;
              } else if (fnName === 'switch_orb_shader') {
                confirmText = `🔮 Switched visual orb shader.`;
              }

              return NextResponse.json({
                success: true,
                action: fnName,
                params: fnArgs,
                text: confirmText,
                model_used: model,
              });
            }

            // Otherwise extract text response
            const partWithText = parts.find((p: any) => typeof p.text === 'string' && !p.thought) || parts.find((p: any) => typeof p.text === 'string');
            const text = partWithText ? partWithText.text : '';
            if (text) {
              return NextResponse.json({
                success: true,
                text,
                model_used: model,
              });
            }
          }
        } catch (err) {
          console.warn(`[chat] Gemini ${model} failed with key:`, err);
        }
      }
    }

    // ── 7. Graceful Fallback if offline/all keys rate-limited ────────────
    let fallbackText = `Hello **${user_name}**! `;
    if (context.question) {
      fallbackText += `Regarding this **${context.question.type.toUpperCase()}** question:\n\n> ${context.question.content}\n\n`;
      if (context.question.explanation) {
        fallbackText += `💡 **Key Insight:** ${context.question.explanation}`;
      } else {
        fallbackText += `Think about the core concepts related to this card. You can also use voice to answer, or ask me to check your code.`;
      }
    } else {
      fallbackText += `I'm ready to assist you on **${context.path === '/study' ? 'Study Mode' : context.path === '/manage' ? 'Deck Manager' : context.path === '/create' ? 'Deck Creator' : 'Dashboard'}**. You can ask questions, manage your decks, change themes, or upload files!`;
    }

    return NextResponse.json({
      success: true,
      text: fallbackText,
      fallback: true,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Chat error' }, { status: 500 });
  }
}
