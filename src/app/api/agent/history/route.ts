import { NextRequest, NextResponse } from 'next/server';
import { AGENT_BACKEND_PORT } from '@/lib/agentServer';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q');
    const endpoint = q
      ? `http://localhost:${AGENT_BACKEND_PORT}/api/history/search?q=${encodeURIComponent(q)}`
      : `http://localhost:${AGENT_BACKEND_PORT}/api/history/sessions`;

    const res = await fetch(endpoint, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {
    // Graceful fallback to client/localStorage
  }

  return NextResponse.json({ success: true, sessions: [] });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`http://localhost:${AGENT_BACKEND_PORT}/api/history/sessions/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {
    // Fallback
  }

  const sid = `sess_${Math.floor(Date.now() / 1000)}_${Math.random().toString(36).substring(2, 8)}`;
  return NextResponse.json({
    success: true,
    session: {
      id: sid,
      title: 'New Discussion',
      created_at: Date.now() / 1000,
      updated_at: Date.now() / 1000,
      message_count: 0,
    },
  });
}

export async function DELETE() {
  try {
    const res = await fetch(`http://localhost:${AGENT_BACKEND_PORT}/api/history/clear`, {
      method: 'DELETE',
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {
    // Fallback
  }

  return NextResponse.json({ success: true });
}
