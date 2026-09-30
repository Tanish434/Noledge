import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAgentEnv } from '@/lib/agentServer';

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

export async function POST(req: NextRequest) {
  try {
    let base64Audio = '';
    let mimeType = 'audio/webm';

    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('audio') as File | null;
      if (!file) {
        return NextResponse.json({ success: false, error: 'No audio file provided' }, { status: 400 });
      }
      const buffer = await file.arrayBuffer();
      base64Audio = Buffer.from(buffer).toString('base64');
      mimeType = file.type || 'audio/webm';
    } else {
      const body = await req.json();
      base64Audio = body.audio || body.data || '';
      mimeType = body.mimeType || 'audio/webm';
    }

    // Clean base64 header if present
    if (base64Audio.includes(',')) {
      base64Audio = base64Audio.split(',')[1];
    }

    if (!base64Audio.trim()) {
      return NextResponse.json({ success: false, error: 'Empty audio data' }, { status: 400 });
    }

    const apiKeys = getAllGeminiKeys().slice(0, 2);
    const modelsToTry = [
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
    ];

    for (const key of apiKeys) {
      for (const model of modelsToTry) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
          const gRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      inlineData: {
                        mimeType: mimeType.split(';')[0],
                        data: base64Audio,
                      },
                    },
                    {
                      text: 'Transcribe the spoken audio verbatim in English (or the spoken language). Return ONLY the transcription text, nothing else. If unintelligible or empty silence, return empty string.',
                    },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 256,
              },
            }),
            signal: AbortSignal.timeout(10000),
          });

          if (gRes.ok) {
            const data = await gRes.json();
            const parts = data.candidates?.[0]?.content?.parts || [];
            const textPart = parts.find((p: any) => typeof p.text === 'string' && !p.thought) || parts.find((p: any) => typeof p.text === 'string');
            let transcription = (textPart ? textPart.text : '').trim().replace(/^["']|["']$/g, '');

            // Judgment filter: reject hallucinated junk (e.g. timestamps like "0:00", placeholder text).
            if (transcription && (/^\d{1,2}:\d{2}([.:]\d+)?$/.test(transcription) || transcription.length < 2 || !/[a-zA-Z0-9]/.test(transcription))) {
              transcription = '';
            }

            return NextResponse.json({
              success: true,
              text: transcription,
              model_used: model,
            });
          }
        } catch (err) {
          console.warn(`[transcribe] Gemini ${model} failed with key:`, err);
        }
      }
    }

    return NextResponse.json({
      success: false,
      error: 'Audio transcription failed on all keys',
    }, { status: 502 });
  } catch (err: any) {
    console.error('[transcribe] error:', err);
    return NextResponse.json({ success: false, error: err.message || 'Server error' }, { status: 500 });
  }
}
