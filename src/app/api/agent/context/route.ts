import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { AGENT_BACKEND_URL } from '@/lib/agentServer';

const ACTIVE_CONTEXT_PATH = path.join(process.cwd(), 'agent', 'src', 'active_context.json');

function readLocalContext(): Record<string, any> {
  try {
    if (fs.existsSync(ACTIVE_CONTEXT_PATH)) {
      const data = fs.readFileSync(ACTIVE_CONTEXT_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Ignore error
  }
  return { question: null, code_buffer: '', deck_name: '', card_index: 0 };
}

function writeLocalContext(ctx: Record<string, any>) {
  try {
    const dir = path.dirname(ACTIVE_CONTEXT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ACTIVE_CONTEXT_PATH, JSON.stringify(ctx, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[agent/context] Could not write active_context.json:', err);
  }
}

export async function GET() {
  // 1. Try agent server first
  try {
    const resp = await fetch(`${AGENT_BACKEND_URL}/api/study/context`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok) {
      const data = await resp.json();
      return NextResponse.json(data);
    }
  } catch {
    // Fallback to local file
  }

  const local = readLocalContext();
  return NextResponse.json({ success: true, context: local });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 1. Sync to local file immediately
    const current = readLocalContext();
    const merged = { ...current, ...(body || {}) };
    writeLocalContext(merged);

    // 2. Also notify Python server if running
    try {
      await fetch(`${AGENT_BACKEND_URL}/api/study/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      // Python server might not be active, local file is sufficient
    }

    return NextResponse.json({ success: true, context: merged });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
