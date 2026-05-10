import pLimit from 'p-limit';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getSession,
  updateSession,
  appendEvent,
  loadCheckpoint,
  saveCheckpoint,
} from '@/lib/session';
import { detectMoments } from '@/lib/modules/viral-detector';
import { extractMomentAudio } from '@/lib/modules/audio-extractor';
import { audioPath, momentDir, ensureDir } from '@/lib/utils/file-utils';
import { Moment, Transcript, PodcastContext, SessionConfig } from '@/lib/types';
import logger from '@/lib/logger';

const RedetectBodySchema = z
  .object({
    maxMoments: z.number().int().min(1).max(20).optional(),
    minDurationSec: z.number().min(0).optional(),
  })
  .optional();

async function runRedetection(
  sessionId: string,
  transcript: Transcript[],
  config: SessionConfig,
  audioFilePath: string,
  podcastContext: PodcastContext | undefined
): Promise<void> {
  try {
    const moments = await detectMoments(
      transcript,
      config,
      async (moment) => {
        await appendEvent(sessionId, {
          type: 'moment_detected',
          timestamp: new Date().toISOString(),
          data: { moment },
        });
      },
      podcastContext
    );

    await saveCheckpoint(sessionId, 'moments', moments);

    await updateSession(sessionId, {
      moments,
      // Clear all downstream state so the user starts fresh from Gate 1
      approvedMomentIds: undefined,
      storyboards: undefined,
      storyboardApprovals: undefined,
      storyboardIterations: undefined,
      hookEdits: undefined,
      momentStyleAnchors: undefined,
    });

    // Pre-extract audio for Gate 1 previews (idempotent: skips already-extracted clips)
    const preLimit = pLimit(3);
    await Promise.all(
      moments.map((m: Moment) =>
        preLimit(async () => {
          const out = audioPath(sessionId, m.id);
          try {
            const { stat } = await import('fs/promises');
            await stat(out);
          } catch {
            await ensureDir(momentDir(sessionId, m.id));
            await extractMomentAudio(audioFilePath, m, out);
          }
        })
      )
    );

    await appendEvent(sessionId, {
      type: 'gate',
      timestamp: new Date().toISOString(),
      data: { gate: 1, message: 'Pick which moments to generate', moments },
    });

    logger.info('Re-detection complete', { sessionId, momentCount: moments.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Re-detection failed', { sessionId, error: msg });
    await appendEvent(sessionId, {
      type: 'error',
      timestamp: new Date().toISOString(),
      data: { message: `Re-detection failed: ${msg}` },
    }).catch(() => undefined);
  }
}

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
        {
          error: `Re-detection is only available in "awaiting_approval" status. Current: "${session.status}"`,
        },
        { status: 409 }
      );
    }

    let body: { maxMoments?: number; minDurationSec?: number } = {};
    try {
      const raw: unknown = await req.json();
      const parsed = RedetectBodySchema.safeParse(raw);
      if (parsed.success && parsed.data) body = parsed.data;
    } catch {
      // empty or non-JSON body is fine — all fields are optional
    }

    const transcript = await loadCheckpoint<Transcript[]>(sessionId, 'transcript');
    if (!transcript) {
      return Response.json({ error: 'Transcription not complete.' }, { status: 400 });
    }

    const podcastContext = await loadCheckpoint<PodcastContext>(sessionId, 'podcast_context');

    const config: SessionConfig = {
      ...session.config,
      ...(body.maxMoments !== undefined ? { maxMoments: body.maxMoments } : {}),
    };

    // Fire re-detection in background — client listens via SSE for moment_detected + gate events
    void runRedetection(sessionId, transcript, config, session.audioPath, podcastContext ?? undefined);

    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Redetect route error', { sessionId, error: msg });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
