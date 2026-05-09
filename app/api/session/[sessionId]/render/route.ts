/** @deprecated — rendering is now per-moment via /api/session/[sessionId]/finalize/[momentId] */
import { NextRequest } from 'next/server';

export async function POST(
  _req: NextRequest,
  _ctx: unknown
): Promise<Response> {
  return Response.json({ error: 'Deprecated — use /finalize/[momentId] instead' }, { status: 410 });
}
