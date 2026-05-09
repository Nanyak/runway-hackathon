import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { createRevision, loadRevisions } from '@/lib/modules/video-reviser';
import logger from '@/lib/logger';

interface RouteParams {
  params: Promise<{ sessionId: string; momentId: string }>;
}

// POST — submit a new revision request
export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { sessionId, momentId } = await params;

  try {
    const body = await req.json() as { feedback?: string };
    const feedback = body.feedback?.trim();

    if (!feedback) {
      return Response.json({ error: 'feedback is required' }, { status: 400 });
    }

    if (feedback.length > 500) {
      return Response.json({ error: 'feedback must be under 500 characters' }, { status: 400 });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.status !== 'awaiting_feedback' && session.status !== 'complete') {
      return Response.json(
        { error: 'Session must be ready for feedback before revising' },
        { status: 409 }
      );
    }

    const moment = session.moments?.find((m) => m.id === momentId);
    if (!moment) {
      return Response.json({ error: 'Moment not found' }, { status: 404 });
    }

    const revision = await createRevision(sessionId, momentId, feedback, session.config);

    logger.info('Revision created', { sessionId, momentId, revisionId: revision.id });
    return Response.json({ revision });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Revise route error', { sessionId, momentId, error: msg });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET — list all revisions for this moment
export async function GET(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { sessionId, momentId } = await params;

  try {
    const revisions = await loadRevisions(sessionId, momentId);
    return Response.json({ revisions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Revisions list error', { sessionId, momentId, error: msg });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
