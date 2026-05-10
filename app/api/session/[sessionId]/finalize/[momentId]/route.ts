import path from 'path';
import { NextRequest } from 'next/server';
import { getSession, updateSession, appendEvent } from '@/lib/session';
import { momentVideoPath, finalPath, ensureDir, revisionPath, ensureLocalFile, syncLocalFileToS3 } from '@/lib/utils/file-utils';
import { loadRevisions } from '@/lib/modules/video-reviser';
import logger from '@/lib/logger';
import fs from 'fs/promises';

/**
 * Finalizes one moment: copies the selected Runway video (original or a ready revision) to final.mp4.
 * Body: `{ "revisionId"?: string }` — omit or empty for v0 (moment video); otherwise must be a ready revision id.
 */
export async function POST(
  req: NextRequest,
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

    let requestedRevisionId: string | undefined;
    try {
      const raw: unknown = await req.json();
      if (
        raw !== null &&
        typeof raw === 'object' &&
        'revisionId' in raw &&
        typeof (raw as { revisionId: unknown }).revisionId === 'string'
      ) {
        const id = (raw as { revisionId: string }).revisionId.trim();
        if (id.length > 0) requestedRevisionId = id;
      }
    } catch {
      /* empty or invalid JSON body → original */
    }

    let sourceVideoPath = momentVideoPath(sessionId, momentId);

    if (requestedRevisionId !== undefined) {
      const revisions = await loadRevisions(sessionId, momentId);
      const rev = revisions.find((r) => r.id === requestedRevisionId);
      if (!rev || rev.status !== 'ready') {
        return Response.json({ error: 'Revision not found or not ready' }, { status: 400 });
      }
      sourceVideoPath = revisionPath(sessionId, momentId, requestedRevisionId);
    }

    const available = await ensureLocalFile(sourceVideoPath);
    if (!available) {
      return Response.json({ error: 'Selected video file is not available' }, { status: 404 });
    }

    const outFinalPath = finalPath(sessionId, momentId);

    // Fire-and-forget — client listens on SSE stream for render_complete
    (async () => {
      try {
        await ensureDir(path.dirname(outFinalPath));
        await fs.copyFile(sourceVideoPath, outFinalPath);
        void syncLocalFileToS3(outFinalPath);

        await appendEvent(sessionId, {
          type: 'render_complete',
          timestamp: new Date().toISOString(),
          data: {
            momentId,
            downloadUrl: `/api/download/${sessionId}/${momentId}`,
          },
        });

        logger.info('Moment finalized', { sessionId, momentId, outFinalPath });

        // Check if all approved moments are now finalized; if so, transition to complete
        const latestSession = await getSession(sessionId);
        if (latestSession && latestSession.status === 'awaiting_feedback') {
          const approvedIds = latestSession.approvedMomentIds ?? [];
          if (approvedIds.length > 0) {
            const finalizedFlags = await Promise.all(
              approvedIds.map(async (id) => {
                try {
                  await fs.access(finalPath(sessionId, id));
                  return true;
                } catch {
                  return false;
                }
              })
            );
            if (finalizedFlags.every(Boolean)) {
              await updateSession(sessionId, { status: 'complete' });
              await appendEvent(sessionId, {
                type: 'complete',
                timestamp: new Date().toISOString(),
                data: { downloadUrl: `/api/download/${sessionId}/zip` },
              });
              logger.info('All moments finalized — session complete', { sessionId });
            }
          }
        }
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
