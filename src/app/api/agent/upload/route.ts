import { NextRequest, NextResponse } from 'next/server';
import { AGENT_BACKEND_PORT, getAgentEnv } from '@/lib/agentServer';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const prompt = (formData.get('prompt') as string) || '';
    const sessionId = (formData.get('session_id') as string) || '';

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = file.type || 'application/octet-stream';

    // 1. Primary: Forward to Python Agent Backend Server (/api/analyze_file)
    try {
      const res = await fetch(`http://localhost:${AGENT_BACKEND_PORT}/api/analyze_file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: base64Data,
          mime_type: mimeType,
          filename: file.name,
          prompt,
          session_id: sessionId,
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(35000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.text) {
          return NextResponse.json(data);
        }
      }
    } catch {
      // Backend not responding or timeout; proceed to direct Gemini fallback
    }

    // 2. Fallback: Direct Google Gemini API Multimodal Processing
    const env = getAgentEnv();
    const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return NextResponse.json({
        success: true,
        text: `Attached file **${file.name}** (${Math.round(file.size / 1024)} KB) received. Ask any questions about it!`,
        spoken_summary: `I received your file ${file.name}. What would you like to review?`,
        filename: file.name,
      });
    }

    const modelsToTry = [
      'gemini-3.5-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
    ];

    let lastErr: any = null;
    for (const model of modelsToTry) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const defaultPrompt = mimeType.includes('pdf')
          ? `Please analyze this PDF document '${file.name}'. Provide a clear executive summary and extract key details, findings, and formulas in clean Markdown.`
          : mimeType.includes('image')
          ? `Please perform OCR and visual analysis on this image '${file.name}'. Extract all readable text, describe diagrams/charts, and detail key findings in Markdown.`
          : mimeType.includes('audio')
          ? `Please transcribe and analyze this audio file '${file.name}'. Provide a transcript and summarize main points.`
          : mimeType.includes('video')
          ? `Please analyze this video '${file.name}'. Summarize visual timeline actions and key content.`
          : `Analyze this file '${file.name}' and extract all pertinent details and insights.`;

        const payload = {
          systemInstruction: {
            parts: [
              {
                text:
                  "You are aliph1, an elite Executive AI Assistant.\n" +
                  "Analyze the provided document, image, audio, or video thoroughly with crisp Markdown.\n" +
                  "MANDATORY SPOKEN SUMMARY BLOCK:\n" +
                  "At the very end of your response, ALWAYS include:\n" +
                  "<<<SPOKEN_SUMMARY>>>\n" +
                  "[A natural, conversational 1-2 sentence spoken summary suitable for Text-to-Speech audio output. Address the user directly.]\n" +
                  "<<<END_SPOKEN_SUMMARY>>>",
              },
            ],
          },
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType, data: base64Data } },
                { text: prompt.trim() ? prompt : defaultPrompt },
              ],
            },
          ],
        };

        const gRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000),
        });

        if (gRes.ok) {
          const gData = await gRes.json();
          let text = gData.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';

          let spokenSummary = `I've analyzed your file ${file.name}. What would you like to explore next?`;
          const spokenMatch = text.match(/<{2,3}\s*(?:SPOKEN_SUMMARY|SUMMARY)?\s*>{2,3}([\s\S]*?)<{2,3}\s*(?:END_SPOKEN_SUMMARY|END_SUMMARY)?\s*>{2,3}/i);
          if (spokenMatch && spokenMatch[1]) {
            spokenSummary = spokenMatch[1].trim();
            text = text.replace(spokenMatch[0], '').trim();
          }

          return NextResponse.json({
            success: true,
            text,
            spoken_summary: spokenSummary,
            filename: file.name,
            file_type: file.type,
            model_used: model,
          });
        }
      } catch (err) {
        lastErr = err;
      }
    }

    return NextResponse.json(
      { success: false, error: lastErr ? String(lastErr) : 'Failed to analyze file with Gemini' },
      { status: 500 }
    );
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Upload failed' }, { status: 500 });
  }
}
