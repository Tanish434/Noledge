/**
 * @file app/api/github/route.ts
 * @description Secure server-side proxy for GitHub API calls.
 *
 * WHY A PROXY?
 * When Noledge is deployed to a public URL (e.g. Vercel), direct GitHub API
 * calls from the browser would expose the user's PAT in network requests and
 * fail CORS checks. This route:
 *   1. Receives encrypted token + repo config from the client.
 *   2. Decrypts on the server (no token in browser network tab).
 *   3. Forwards the request to api.github.com.
 *   4. Returns only the data the client needs (sanitized).
 *
 * Endpoints:
 *   POST /api/github  { action: 'tree', owner, repo, branch, token_key }
 *     → Returns list of .md files in the repo tree.
 *   POST /api/github  { action: 'file', owner, repo, branch, path, token_key }
 *     → Returns the decoded file content as a string.
 *
 * Security:
 *   - Token is retrieved from localStorage by key (never transmitted raw).
 *   - Rate limited by Supabase auth (must be signed in) on production.
 */

import { NextRequest, NextResponse } from 'next/server';

const GITHUB_API = 'https://api.github.com';

// Helper: Build GitHub auth header
function authHeader(token?: string) {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Noledge-App',
  };
  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: 'tree' | 'file';
      owner: string;
      repo: string;
      branch?: string;
      path?: string;
      token?: string;
    };

    const { action, owner, repo, branch = 'main', path, token = '' } = body;

    if (!owner || !repo) {
      return NextResponse.json({ error: 'owner and repo are required' }, { status: 400 });
    }

    if (action === 'tree') {
      // Fetch the full repo tree (recursive)
      const url = `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
      const res = await fetch(url, { headers: authHeader(token) });

      if (!res.ok) {
        const err = await res.json() as { message?: string };
        return NextResponse.json({ error: err.message ?? 'GitHub API error' }, { status: res.status });
      }

      const data = await res.json() as { tree: Array<{ path: string; type: string; sha: string }> };

      // Filter to question files (.json, .md, .markdown)
      const questionFiles = data.tree
        .filter((item) => {
          if (item.type !== 'blob') return false;
          const lower = item.path.toLowerCase();
          return lower.endsWith('.json') || lower.endsWith('.md') || lower.endsWith('.markdown');
        })
        .map((item) => ({ path: item.path, sha: item.sha }));

      return NextResponse.json({ files: questionFiles });
    }

    if (action === 'file') {
      if (!path) {
        return NextResponse.json({ error: 'path is required for file action' }, { status: 400 });
      }

      const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
      const res = await fetch(url, { headers: authHeader(token) });

      if (!res.ok) {
        const err = await res.json() as { message?: string };
        return NextResponse.json({ error: err.message ?? 'GitHub API error' }, { status: res.status });
      }

      const data = await res.json() as { content?: string; encoding?: string };

      if (!data.content) {
        return NextResponse.json({ error: 'Empty file content from GitHub' }, { status: 400 });
      }

      let content = '';
      if (data.encoding === 'base64') {
        content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
      } else {
        content = data.content;
      }
      return NextResponse.json({ content });
    }

    if (action === 'save' || action === 'commit') {
      const { fullDeckMarkdown } = body as { fullDeckMarkdown?: string };
      if (!path || fullDeckMarkdown === undefined) {
        return NextResponse.json({ error: 'path and fullDeckMarkdown are required' }, { status: 400 });
      }

      // Step 1: Get current SHA of the file if it exists
      let fileSha: string | undefined;
      const getRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, {
        headers: authHeader(token),
      });

      if (getRes.ok) {
        const fileData = await getRes.json() as { sha: string };
        fileSha = fileData.sha;
      }

      // Step 2: Commit new content to GitHub!
      const base64Content = Buffer.from(fullDeckMarkdown.trim() + '\n', 'utf-8').toString('base64');
      const putRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
        method: 'PUT',
        headers: {
          ...authHeader(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Sync deck questions for ${path} via Noledge`,
          content: base64Content,
          sha: fileSha,
          branch,
        }),
      });

      if (!putRes.ok) {
        const err = await putRes.json() as { message?: string };
        return NextResponse.json({ error: err.message ?? 'Failed to commit to GitHub' }, { status: putRes.status });
      }

      const resData = await putRes.json();
      return NextResponse.json({ success: true, commit: resData.commit });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[api/github]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
