/**
 * @file app/api/auth/github/callback/route.ts
 * @description Next.js API route to exchange GitHub OAuth code for Access Token.
 *
 * Flow:
 * 1. User clicks "Authorize with GitHub" -> redirected to github.com/login/oauth/authorize
 * 2. GitHub redirects back to /api/auth/github/callback?code=XYZ
 * 3. Server route exchanges `code` for `access_token` via POST to https://github.com/login/oauth/access_token
 * 4. Server redirects client back to /settings?tab=import&gh_token=ACCESS_TOKEN
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const appUrl = `${url.protocol}//${url.host}`;

  if (!code) {
    return NextResponse.redirect(`${appUrl}/settings?tab=import&error=no_code`);
  }

  const clientId = (process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GITHUB_CLIENT_SECRET || '').trim();

  if (!clientId || !clientSecret) {
    // If OAuth app secret is not configured on server, redirect back with error instruction
    return NextResponse.redirect(
      `${appUrl}/settings?tab=import&error=oauth_unconfigured`
    );
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const data = await tokenRes.json() as { access_token?: string; error?: string };

    if (!data.access_token) {
      return NextResponse.redirect(
        `${appUrl}/settings?tab=import&error=${data.error || 'token_exchange_failed'}`
      );
    }

    // Successfully exchanged code for token! Redirect back to Settings Import tab with token.
    return NextResponse.redirect(
      `${appUrl}/settings?tab=import&gh_token=${data.access_token}`
    );
  } catch (err) {
    console.error('[github-oauth-callback]', err);
    return NextResponse.redirect(
      `${appUrl}/settings?tab=import&error=server_error`
    );
  }
}
