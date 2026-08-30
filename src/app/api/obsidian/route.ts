/**
 * @file app/api/obsidian/route.ts
 * @description Secure server-side proxy for the Obsidian Local REST API.
 *
 * WHY A PROXY?
 * The Obsidian Local REST API runs at https://127.0.0.1:27123 with a self-signed
 * certificate. When Noledge is hosted on a public URL (e.g. Vercel), the browser
 * will block all requests to localhost from a non-localhost page (mixed content +
 * CORS). This server-side proxy:
 *   1. Receives the vault URL, path, and token from the client.
 *   2. Forwards the request from the server (not the browser) to the local vault.
 *   3. Returns the file content back to the client.
 *
 * NOTE: This only works when Noledge is running locally (localhost:3000 → localhost:27123).
 * When deployed to Vercel, the server cannot reach the user's local machine —
 * in that case, the sync falls back to the client-side direct API call (same origin).
 *
 * Endpoints:
 *   POST /api/obsidian  { action: 'list', vault_url, token }
 *     → Returns list of .md files in the vault root.
 *   POST /api/obsidian  { action: 'file', vault_url, path, token }
 *     → Returns the file content as a string.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: 'list' | 'file';
      vault_url?: string;
      path?: string;
      token: string;
    };

    const { action, vault_url = 'https://127.0.0.1:27123', path, token } = body;

    if (!token) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 });
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    if (action === 'list') {
      // List all files in the vault root
      const res = await fetch(`${vault_url}/vault/`, { headers });

      if (!res.ok) {
        return NextResponse.json({ error: `Obsidian API error: ${res.status}` }, { status: res.status });
      }

      const data = await res.json() as { files: string[] };

      const mdFiles = (data.files ?? []).filter((f: string) => f.endsWith('.md'));
      return NextResponse.json({ files: mdFiles });
    }

    if (action === 'file') {
      if (!path) {
        return NextResponse.json({ error: 'path is required for file action' }, { status: 400 });
      }

      const encodedPath = encodeURIComponent(path);
      const res = await fetch(`${vault_url}/vault/${encodedPath}`, { headers });

      if (!res.ok) {
        return NextResponse.json({ error: `Obsidian API error: ${res.status}` }, { status: res.status });
      }

      const content = await res.text();
      return NextResponse.json({ content });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[api/obsidian]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
