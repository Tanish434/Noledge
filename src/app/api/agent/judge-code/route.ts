import { NextRequest, NextResponse } from 'next/server';
import { AGENT_BACKEND_URL, getAgentEnv } from '@/lib/agentServer';

interface JudgeCodePayload {
  code?: string;
  question?: {
    id?: string;
    type?: string;
    content?: string;
    answer?: string | string[];
    explanation?: string;
    code_language?: string;
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as JudgeCodePayload;
    const code = (body.code || '').trim();
    const question = body.question;

    if (!code) {
      return NextResponse.json({
        success: true,
        is_correct: false,
        score: 0.0,
        feedback: 'No code submitted in the editor.',
      });
    }

    // 1. First try Python Agent Server
    try {
      const resp = await fetch(`${AGENT_BACKEND_URL}/api/study/judge-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, question }),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const data = await resp.json();
        return NextResponse.json(data);
      }
    } catch {
      // Fallback to server-side Gemini call
    }

    // 2. Direct server-side Gemini fallback using standard fetch
    const env = getAgentEnv();
    const apiKey = env['GEMINI_API_KEY'] || env['GOOGLE_API_KEY'];

    if (apiKey) {
      const systemPrompt =
        'You are an objective, authoritative automated code evaluator in the Noledge flashcard platform. ' +
        'Your role is to strictly evaluate whether the user code solves the question and produces the required behavior or output.\n' +
        'STRICT CONSTRAINTS:\n' +
        '1. Direct & Concise: State if the code is correct or incorrect.\n' +
        '2. No lecturing: Do NOT preach, do NOT explain basic concepts unless there is a bug, do NOT give unsolicited tutorials or tell the user how to learn.\n' +
        '3. Focus on bugs/logic: If incorrect, state precisely what is broken, missing, or buggy.\n' +
        '4. You must output valid JSON with keys: is_correct (boolean), score (float 0.0 to 1.0), and feedback (string).';

      const userPrompt =
        `Language: ${question?.code_language || 'python'}\n` +
        `Problem Statement:\n${question?.content || ''}\n\n` +
        `Expected Reference / Solution:\n${Array.isArray(question?.answer) ? question?.answer.join('\n') : String(question?.answer || '')}\n\n` +
        `Explanation / Context:\n${question?.explanation || ''}\n\n` +
        `User Submitted Code:\n\`\`\`\n${code}\n\`\`\`\n\n` +
        'Evaluate the code. Return JSON only:';

      const models = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-2.5-flash'];
      for (const m of models) {
        try {
          const gResp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: {
                  temperature: 0.1,
                  responseMimeType: 'application/json',
                },
              }),
              signal: AbortSignal.timeout(6000),
            }
          );
          if (gResp.ok) {
            const gData = await gResp.json();
            const text = gData?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              const parsed = JSON.parse(text.trim());
              return NextResponse.json({
                success: true,
                is_correct: Boolean(parsed.is_correct),
                score: typeof parsed.score === 'number' ? parsed.score : parsed.is_correct ? 1.0 : 0.0,
                feedback: String(parsed.feedback || (parsed.is_correct ? 'Code is correct.' : 'Code has bugs.')),
              });
            }
          }
        } catch {
          // Try next model
        }
      }
    }

    // 3. Fallback: Whitespace-normalized comparison
    const normalize = (c: string) =>
      c
        .split('\n')
        .map((l) => l.trimEnd())
        .join('\n')
        .trim();

    const expectedAnswer = Array.isArray(question?.answer)
      ? question.answer.join('\n')
      : String(question?.answer || '');
    const isCorrect = normalize(code) === normalize(expectedAnswer);

    return NextResponse.json({
      success: true,
      is_correct: isCorrect,
      score: isCorrect ? 1.0 : 0.0,
      feedback: isCorrect
        ? 'Code is correct!'
        : 'Code does not match expected output or solution logic. Check indentation and syntax.',
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        is_correct: false,
        score: 0.0,
        feedback: `Evaluation error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      },
      { status: 500 }
    );
  }
}
