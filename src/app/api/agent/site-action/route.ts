import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_ACTIONS = new Set([
  'create_deck', 'delete_deck', 'get_decks', 'sort_deck',
  'add_question', 'edit_question', 'delete_question', 'move_question', 'change_question_type',
  'navigate_to', 'change_theme',
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action || '').trim();
    const params = (body.params && typeof body.params === 'object' ? body.params : {}) as Record<string, unknown>;

    if (!action) {
      return NextResponse.json({ success: false, error: 'action is required' }, { status: 400 });
    }
    if (!ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json({ success: false, error: `Unknown site action: "${action}".` }, { status: 400 });
    }
    // Navigation allowlist (prevent open-redirect).
    if (action === 'navigate_to') {
      const path = String((params as Record<string, unknown>).path || '');
      if (!['/', '/study', '/manage', '/create', '/settings'].includes(path)) {
        return NextResponse.json({ success: false, error: `Refused unsafe navigation to "${path}".` }, { status: 400 });
      }
    }

    // Execution happens in the browser via executeSiteAction(); server only validates + echoes.
    return NextResponse.json({
      success: true,
      action,
      params,
      message: 'Action validated for client execution.',
    });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Action failed' }, { status: 500 });
  }
}
