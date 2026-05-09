import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession, updateSession } from '@/lib/session';
import { storyboardPath } from '@/lib/utils/file-utils';
import { readJsonFile, atomicWriteJson } from '@/lib/utils/file-utils';
import type { StoryboardPlan } from '@/lib/types';
import logger from '@/lib/logger';

const ApproveStoryboardSchema = z.object({
  momentId: z.string().uuid(),
  selectedSheetIndex: z.number().int().min(0).max(9).optional(),
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
    if (session.status !== 'awaiting_storyboard_review') {
      return Response.json(
        { error: `Cannot approve storyboard in status "${session.status}"` },
        { status: 409 }
      );
    }

    const raw = await req.json();
    const parsed = ApproveStoryboardSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 });
    }

    const { momentId, selectedSheetIndex = 0 } = parsed.data;
    const approvedIds = session.approvedMomentIds ?? [];
    if (!approvedIds.includes(momentId)) {
      return Response.json({ error: `Moment ${momentId} is not in the approved moments list` }, { status: 400 });
    }

    // Persist the selected sheet variant index into the storyboard JSON
    const sbPath = storyboardPath(sessionId, momentId);
    const storyboard = await readJsonFile<StoryboardPlan>(sbPath);
    if (storyboard) {
      await atomicWriteJson(sbPath, { ...storyboard, selectedSheetIndex });
    }

    const currentApprovals = session.storyboardApprovals ?? {};
    const updatedApprovals = { ...currentApprovals, [momentId]: true };

    // If all approved moments now have storyboard approval, transition to generating_video
    const allApproved = approvedIds.every((id) => updatedApprovals[id] === true);

    await updateSession(sessionId, {
      storyboardApprovals: updatedApprovals,
      // Orchestrator picks up 'generating_video' transition via waitForStoryboardApprovals polling
    });

    logger.info('Storyboard approved', { sessionId, momentId, allApproved, selectedSheetIndex });
    return Response.json({ ok: true, allApproved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Approve storyboard error', { sessionId, error: msg });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
