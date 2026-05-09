import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession, updateSession } from '@/lib/session';
import logger from '@/lib/logger';

const ApproveSchema = z.object({
  approvedIds: z.array(z.string().uuid()),
  hookEdits: z.record(z.string().uuid(), z.string().max(1000)).optional().default({}),
  styleAnchors: z.record(z.string().uuid(), z.string().max(300)).optional().default({}),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const { sessionId } = await params;

  try {
    const session = await getSession(sessionId);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    if (session.status !== 'awaiting_approval') {
      return Response.json(
        { error: `Cannot approve moments in status "${session.status}"` },
        { status: 409 }
      );
    }

    const raw = await req.json();
    const parsed = ApproveSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 });
    }

    const { approvedIds, hookEdits, styleAnchors } = parsed.data;
    const detectedMomentIds = new Set((session.moments ?? []).map((m) => m.id));
    for (const momentId of approvedIds) {
      if (!detectedMomentIds.has(momentId)) {
        return Response.json({ error: `Moment ${momentId} not found in detected moments` }, { status: 400 });
      }
    }

    if (approvedIds.length === 0) {
      return Response.json({ error: 'At least one moment must be approved' }, { status: 400 });
    }

    // Flip to 'awaiting_storyboard_review' — orchestrator proceeds to plan storyboards + generate frame images
    await updateSession(sessionId, {
      approvedMomentIds: approvedIds,
      hookEdits,
      momentStyleAnchors: styleAnchors,
      status: 'awaiting_storyboard_review',
    });

    logger.info('Moments approved', { sessionId, count: approvedIds.length });
    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Approve error', { sessionId, error: msg });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
