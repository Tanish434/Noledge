import { NextRequest, NextResponse } from 'next/server';
import { AGENT_BACKEND_URL, getAgentEnv } from '@/lib/agentServer';

interface JudgeVoicePayload {
  spoken_answer?: string;
  question?: {
    id?: string;
    type?: string;
    content?: string;
    answer?: string | string[];
    explanation?: string;
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as JudgeVoicePayload;
    const spoken_answer = (body.spoken_answer || '').trim();
    const question = body.question;

    if (!spoken_answer) {
      return NextResponse.json({
        success: true,
        is_correct: false,
        score: 0.0,
        feedback: 'No spoken response detected.',
      });
    }

    // 1. Try Python Agent Server
    try {
      const resp = await fetch(`${AGENT_BACKEND_URL}/api/study/judge-voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spoken_answer, question }),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const data = await resp.json();
        return NextResponse.json(data);
      }
    } catch {
      // Fallback
    }

    // 2. Direct server-side Gemini fallback (bounded: 1 key, 2 models)
    const env = getAgentEnv();
    const apiKey = env['GEMINI_API_KEY'] || env['GOOGLE_API_KEY'];

    if (apiKey) {
      const systemPrompt =
        'You are an objective spoken answer evaluator in the Noledge flashcard platform. ' +
        'Evaluate whether the user spoken answer correctly answers the question conceptually.\n' +
        'STRICT CONSTRAINTS:\n' +
        '1. Be objective, concise, and direct.\n' +
        '2. Minor speech-to-text slips or phrasing variations should be graded correct if the core concept is right.\n' +
        '3. Do NOT lecture or give unsolicited tutorials. State whether it is correct or incorrect and why in 1-2 sentences.\n' +
        '4. Return JSON only with keys: is_correct (boolean), score (float 0.0 to 1.0), and feedback (string).';

      const expectedAnswer = Array.isArray(question?.answer)
        ? question.answer.join(', ')
        : String(question?.answer || '');

      const userPrompt =
        `Question:\n${question?.content || ''}\n\n` +
        `Target Answer:\n${expectedAnswer}\n\n` +
        `Explanation / Key Points:\n${question?.explanation || ''}\n\n` +
        `User Spoken Answer:\n"${spoken_answer}"\n\n` +
        'Evaluate the spoken answer. Return JSON only:';

      const models = ['gemini-3.5-flash-lite', 'gemini-3.5-flash'];
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
                feedback: String(parsed.feedback || (parsed.is_correct ? 'Spoken answer is correct.' : 'Incorrect.')),
              });
            }
          }
        } catch {
          // Try next model
        }
      }
    }

    // 3. Fallback: normalized substring match
    const expected = (
      Array.isArray(question?.answer) ? question.answer.join(' ') : String(question?.answer || '')
    )
      .toLowerCase()
      .trim();
    const given = spoken_answer.toLowerCase().trim();
    const isCorrect = expected.includes(given) || given.includes(expected);

    return NextResponse.json({
      success: true,
      is_correct: isCorrect,
      score: isCorrect ? 1.0 : 0.0,
      feedback: isCorrect
        ? 'Spoken answer is correct.'
        : 'Spoken answer did not match the expected answer.',
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
