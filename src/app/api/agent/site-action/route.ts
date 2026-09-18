import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action;
    const params = body.params || {};

    return NextResponse.json({
      success: true,
      action,
      params,
      message: 'Action queued for client execution.',
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Action failed' }, { status: 500 });
  }
}
