/**
 * @file app/api/auth/github/device/route.ts
 * @description Next.js API route to proxy GitHub Device Flow requests (bypasses CORS).
 *
 * Endpoints:
 * 1. POST /api/auth/github/device { action: 'code' }
 *    -> Requests device_code, user_code, and verification_uri from GitHub.
 * 2. POST /api/auth/github/device { action: 'poll', device_code }
 *    -> Polls GitHub for completed access_token.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { action: 'code' | 'poll'; device_code?: string };
    const clientId = (process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || '').trim();

    if (body.action === 'code') {
      const res = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          scope: 'repo read:user',
        }),
      });

      const data = await res.json();
      return NextResponse.json(data);
    }

    if (body.action === 'poll' && body.device_code) {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          device_code: body.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });

      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('[api/auth/github/device]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
