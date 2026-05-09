import { NextRequest } from 'next/server';
import { getSession, appendEvent } from '@/lib/session';
import { momentVideoPath, audioPath, finalPath } from '@/lib/utils/file-utils';
import { assembleMoment } from '@/lib/modules/assembler';
import { loadRevisions } from '@/lib/modules/video-reviser';
import logger from '@/lib/logger';
import fs from 'fs/promises';

/**
 * Finalizes one moment: picks the latest ready video (raw or revision),
 * merges the moment audio track via FFmpeg, saves final.mp4.
 * Fires SSE render_complete event on success.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; momentId: string }> }
): Promise<Response> {
  const { sessionId, momentId } = await params;

  try {
    const session = await getSession(sessionId);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

    if (session.status !== 'awaiting_feedback') {
      return Response.json({ error: `Cannot finalize in status "${session.status}"` }, { status: 409 });
    }

    const moment = session.moments?.find((m) => m.id === momentId);
    if (!moment) return Response.json({ error: 'Moment not found' }, { status: 404 });

    // Find the best source video: latest ready revision, or the raw video
    let sourceVideoPath = momentVideoPath(sessionId, momentId);
    const revisions = await loadRevisions(sessionId, momentId);
    const latestReady = [...revisions].reverse().find((r) => r.status === 'ready');
    if (latestReady?.videoPath) {
      try {
        await fs.stat(latestReady.videoPath);
        sourceVideoPath = latestReady.videoPath;
      } catch {
        // fallback to raw video
      }
    }

    const outFinalPath = finalPath(sessionId, momentId);
    const outAudioPath = audioPath(sessionId, momentId);

    // Fire-and-forget — client listens on SSE stream for render_complete
    (async () => {
      try {
        await assembleMoment(sourceVideoPath, outAudioPath, outFinalPath);

        await appendEvent(sessionId, {
          type: 'render_complete',
          timestamp: new Date().toISOString(),
          data: {
            momentId,
            downloadUrl: `/api/download/${sessionId}/${momentId}`,
          },
        });

        logger.info('Moment finalized', { sessionId, momentId, outFinalPath });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Finalize failed', { sessionId, momentId, error: msg });
        await appendEvent(sessionId, {
          type: 'error',
          timestamp: new Date().toISOString(),
          data: { momentId, message: `Finalize failed: ${msg}` },
        });
      }
    })();

    return Response.json({ ok: true, message: 'Finalizing — listen on SSE stream' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Finalize error', { sessionId, momentId, error: msg });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
