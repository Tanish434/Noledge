import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { getAgentEnv } from '@/lib/agentServer';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name') || 'Kirito';
    const room = searchParams.get('room') || 'agent-room';
    const identity = searchParams.get('identity') || name;

    const env = getAgentEnv();
    const livekitUrl = env['LIVEKIT_URL'] || process.env.LIVEKIT_URL;
    const apiKey = env['LIVEKIT_API_KEY'] || process.env.LIVEKIT_API_KEY;
    const apiSecret = env['LIVEKIT_API_SECRET'] || process.env.LIVEKIT_API_SECRET;

    if (!livekitUrl || !apiKey || !apiSecret) {
      return NextResponse.json(
        {
          error: 'LiveKit credentials not configured in .env or agent/.env',
        },
        { status: 503 }
      );
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name,
    });
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    return NextResponse.json({
      token,
      url: livekitUrl,
      room,
      identity,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error getting agent token' },
      { status: 500 }
    );
  }
}
