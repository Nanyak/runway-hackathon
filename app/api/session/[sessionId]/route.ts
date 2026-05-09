import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import logger from '@/lib/logger';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const { sessionId } = await params;

  try {
    const session = await getSession(sessionId);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    return Response.json({ session });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Error fetching session', { sessionId, error: msg });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
