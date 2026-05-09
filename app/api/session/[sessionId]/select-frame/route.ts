import { NextRequest } from 'next/server';

/**
 * @deprecated This endpoint is no longer used.
 * Frame selection has been replaced by the storyboard review flow.
 * Use POST /api/session/{sessionId}/approve-storyboard instead.
 */
export async function POST(
  _req: NextRequest,
  _ctx: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  return Response.json(
    { error: 'This endpoint is deprecated. Use /approve-storyboard instead.' },
    { status: 410 }
  );
}
