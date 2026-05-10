import { NextRequest } from 'next/server';
import { getSession, updateSession, appendEvent } from '@/lib/session';
import { storyboardPath } from '@/lib/utils/file-utils';
import { readJsonFile } from '@/lib/utils/file-utils';
import { generateVideoFromStoryboard } from '@/lib/modules/video-generator';
import type { StoryboardPlan } from '@/lib/types';
import logger from '@/lib/logger';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; momentId: string }> }
): Promise<Response> {
  const { sessionId, momentId } = await params;

  try {
    const session = await getSession(sessionId);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const approvedIds = session.approvedMomentIds ?? [];
    if (!approvedIds.includes(momentId)) {
      return Response.json({ error: 'Moment is not in the approved list' }, { status: 400 });
    }

    const moment = session.moments?.find((m) => m.id === momentId);
    if (!moment) {
      return Response.json({ error: 'Moment not found' }, { status: 404 });
    }

    const storyboard = await readJsonFile<StoryboardPlan>(storyboardPath(sessionId, momentId));
    if (!storyboard) {
      return Response.json({ error: 'No storyboard found for this moment' }, { status: 400 });
    }

    // Clear the previous error for this moment
    const currentErrors = session.momentVideoErrors ?? {};
    const { [momentId]: _removed, ...remainingErrors } = currentErrors;
    await updateSession(sessionId, { momentVideoErrors: remainingErrors });

    await appendEvent(sessionId, {
      type: 'progress',
      timestamp: new Date().toISOString(),
      data: { step: 'generate', message: `Retrying video for "${moment.title}"…`, momentId },
    });

    // Run video generation in background so the API returns immediately
    const durationSec = moment.endSec - moment.startSec;
    void (async () => {
      try {
        await generateVideoFromStoryboard(storyboard, momentId, sessionId, session.config, durationSec);
        await appendEvent(sessionId, {
          type: 'video_ready',
          timestamp: new Date().toISOString(),
          data: { momentId, videoUrl: `/api/session/${sessionId}/video/${momentId}` },
        });
        logger.info('Retry video succeeded', { sessionId, momentId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Retry video failed', { sessionId, momentId, error: msg });
        await appendEvent(sessionId, {
          type: 'video_error',
          timestamp: new Date().toISOString(),
          data: { momentId, message: msg },
        });
        const current = await getSession(sessionId);
        await updateSession(sessionId, {
          momentVideoErrors: { ...(current?.momentVideoErrors ?? {}), [momentId]: msg },
        });
      }
    })();

    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Retry video route error', { sessionId, momentId, error: msg });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
