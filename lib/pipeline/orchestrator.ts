import pLimit from 'p-limit';
import { Moment, StoryboardPlan } from '@/lib/types';
import { getSession, updateSession, appendEvent, saveCheckpoint, loadCheckpoint } from '@/lib/session';
import { updateSessionStatus } from '@/lib/db';
import {
  audioPath,
  storyboardPath,
  storyboardFrameImagePath,
  chunkDir,
  atomicWriteJson,
  readJsonFile,
  momentDir,
  ensureDir,
} from '@/lib/utils/file-utils';
import { validateAudio, rechunkAudio } from '@/lib/modules/ingestion';
import { transcribeAll, stitchTranscripts } from '@/lib/modules/transcription';
import { extractPodcastContext } from '@/lib/modules/podcast-context';
import { detectMoments } from '@/lib/modules/viral-detector';
import { planStoryboard } from '@/lib/modules/storyboard-planner';
import { generateStoryboardSheet } from '@/lib/modules/image-generator';
import { generateVideoFromStoryboard, videoExists } from '@/lib/modules/video-generator';
import { extractMomentAudio } from '@/lib/modules/audio-extractor';
import { sleep } from '@/lib/utils/retry';
import logger from '@/lib/logger';

const POLL_MS = 2000;

// ─── Thinking event helper ────────────────────────────────────────────────────

async function emitThinking(
  sessionId: string,
  message: string,
  phase: 'planning' | 'imaging'
): Promise<void> {
  await appendEvent(sessionId, {
    type: 'storyboard_thinking',
    timestamp: new Date().toISOString(),
    data: { message, phase },
  });
}

async function emitThinkingChunk(
  sessionId: string,
  chunk: string,
  done: boolean,
  phase: 'planning' | 'imaging'
): Promise<void> {
  await appendEvent(sessionId, {
    type: 'storyboard_thinking',
    timestamp: new Date().toISOString(),
    data: { chunk, streaming: !done, phase },
  });
}

// ─── Gate helpers ─────────────────────────────────────────────────────────────

async function waitForApproval(
  sessionId: string
): Promise<{ approvedIds: string[]; hookEdits: Record<string, string> }> {
  while (true) {
    const session = await getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    // approve/route.ts transitions to 'awaiting_storyboard_review' after Gate 1
    if (session.status === 'awaiting_storyboard_review') {
      return { approvedIds: session.approvedMomentIds ?? [], hookEdits: session.hookEdits ?? {} };
    }
    if (session.status === 'error') throw new Error('Session errored while waiting for moment approval');
    await sleep(POLL_MS);
  }
}

async function waitForStoryboardApprovals(sessionId: string, momentIds: string[]): Promise<void> {
  while (true) {
    const session = await getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status === 'error') throw new Error('Session errored while waiting for storyboard approvals');
    const approvals = session.storyboardApprovals ?? {};
    if (momentIds.every((id) => approvals[id] === true)) return;
    await sleep(POLL_MS);
  }
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runPipeline(sessionId: string): Promise<void> {
  try {
    logger.info('Pipeline started', { sessionId });

    const session = await getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // ── Step 1: Ingestion ──────────────────────────────────────────────────
    await updateSession(sessionId, { status: 'transcribing' });
    await appendEvent(sessionId, {
      type: 'progress',
      timestamp: new Date().toISOString(),
      data: { step: 'transcribe', message: 'Validating audio…', pct: 0 },
    });

    const metadata = await validateAudio(session.audioPath);

    // ── Step 2: Transcription (checkpoint) ────────────────────────────────
    let transcript = await loadCheckpoint<ReturnType<typeof stitchTranscripts>>(sessionId, 'transcript');

    if (!transcript) {
      const chunks = await rechunkAudio(session.audioPath, chunkDir(sessionId));
      await appendEvent(sessionId, {
        type: 'progress',
        timestamp: new Date().toISOString(),
        data: { step: 'transcribe', message: `Transcribing ${chunks.length} chunk(s)…`, pct: 5 },
      });

      const rawTranscripts = await transcribeAll(chunks, async (pct) => {
        await appendEvent(sessionId, {
          type: 'progress',
          timestamp: new Date().toISOString(),
          data: { step: 'transcribe', message: `Transcribing… ${pct}%`, pct: Math.round(5 + pct * 0.4) },
        });
      });

      transcript = stitchTranscripts(rawTranscripts);
      await saveCheckpoint(sessionId, 'transcript', transcript);
    }

    await updateSession(sessionId, { transcript });

    // ── Step 3a: Podcast context (checkpoint) ─────────────────────────────
    await appendEvent(sessionId, {
      type: 'progress',
      timestamp: new Date().toISOString(),
      data: { step: 'detect', message: 'Analyzing podcast content…', pct: 46 },
    });

    let podcastContext = await loadCheckpoint<import('@/lib/types').PodcastContext>(sessionId, 'podcast_context');
    if (!podcastContext) {
      podcastContext = await extractPodcastContext(transcript);
      await saveCheckpoint(sessionId, 'podcast_context', podcastContext);
    }
    await updateSession(sessionId, { podcastContext });

    // ── Step 3b: Viral moment detection (checkpoint) ──────────────────────
    await updateSession(sessionId, { status: 'detecting' });
    await appendEvent(sessionId, {
      type: 'progress',
      timestamp: new Date().toISOString(),
      data: { step: 'detect', message: 'Detecting viral moments…', pct: 50 },
    });

    let moments = await loadCheckpoint<Moment[]>(sessionId, 'moments');
    if (!moments) {
      moments = await detectMoments(
        transcript,
        session.config,
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
    }
    await updateSession(sessionId, { moments });

    // Pre-extract audio for Gate 1 previews
    const preLimit = pLimit(3);
    await Promise.all(
      moments.map((m) =>
        preLimit(async () => {
          const out = audioPath(sessionId, m.id);
          try {
            const { stat } = await import('fs/promises');
            await stat(out);
          } catch {
            await ensureDir(momentDir(sessionId, m.id));
            await extractMomentAudio(session.audioPath, m, out);
          }
        })
      )
    );

    // ── Gate 1: Moment approval ────────────────────────────────────────────
    await updateSession(sessionId, { status: 'awaiting_approval' });
    await appendEvent(sessionId, {
      type: 'gate',
      timestamp: new Date().toISOString(),
      data: { gate: 1, message: 'Pick which moments to generate', moments },
    });

    const { approvedIds, hookEdits } = await waitForApproval(sessionId);
    logger.info('Moments approved', { sessionId, count: approvedIds.length });

    // Re-read session to pick up config changes written by the approve route (e.g. sheetVariantCount)
    const approvedSession = (await getSession(sessionId)) ?? session;

    const approvedMoments = moments
      .filter((m) => approvedIds.includes(m.id))
      .map((m) => ({ ...m, hook: hookEdits[m.id] ?? m.hook }));

    // ── Step 4: Plan storyboards + extract audio (parallel) ───────────────
    await appendEvent(sessionId, {
      type: 'progress',
      timestamp: new Date().toISOString(),
      data: { step: 'plan', message: 'Planning visual storyboards…', pct: 55 },
    });

    const planLimit = pLimit(3);

    await Promise.all(
      approvedMoments.map((moment) =>
        planLimit(async () => {
          let storyboard = await readJsonFile<StoryboardPlan>(storyboardPath(sessionId, moment.id));

          if (!storyboard) {
            const styleAnchor = approvedSession.momentStyleAnchors?.[moment.id];
            await emitThinking(sessionId, `Planning storyboard for "${moment.title}"…`, 'planning');
            storyboard = await planStoryboard(
              moment,
              transcript!,
              approvedSession.config,
              podcastContext ?? undefined,
              styleAnchor,
              (msg) => void emitThinking(sessionId, msg, 'planning'),
              (chunk, done) => void emitThinkingChunk(sessionId, chunk, done, 'planning')
            );
            await ensureDir(momentDir(sessionId, moment.id));
            await atomicWriteJson(storyboardPath(sessionId, moment.id), storyboard);
          }

          // Extract moment audio (idempotent)
          const out = audioPath(sessionId, moment.id);
          try {
            const { stat } = await import('fs/promises');
            await stat(out);
          } catch {
            await extractMomentAudio(session.audioPath, moment, out);
          }
        })
      )
    );

    // ── Step 5: Generate storyboard sheet (one image per moment, parallel) ──
    await appendEvent(sessionId, {
      type: 'progress',
      timestamp: new Date().toISOString(),
      data: { step: 'plan', message: 'Generating storyboard sheets…', pct: 60 },
    });

    const imageLimit = pLimit(3);
    const allStoryboards: Record<string, StoryboardPlan> = {};

    await Promise.all(
      approvedMoments.map((moment) =>
        imageLimit(async () => {
          const storyboard = await readJsonFile<StoryboardPlan>(storyboardPath(sessionId, moment.id));
          if (!storyboard) return;

          const sheetPath = storyboardFrameImagePath(sessionId, moment.id, 0);
          const sheetExists = await import('fs/promises').then((f) => f.stat(sheetPath).then(() => true).catch(() => false));

          if (sheetExists) {
            // Sheets already on disk — fire ready events for all existing variants
            const { stat: fsStat } = await import('fs/promises');
            const variantCount = storyboard.sheetVariantCount ?? 1;
            for (let i = 0; i < variantCount; i++) {
              const vPath = storyboardFrameImagePath(sessionId, moment.id, i);
              const exists = await fsStat(vPath).then(() => true).catch(() => false);
              if (exists) {
                await appendEvent(sessionId, {
                  type: 'storyboard_frame_ready',
                  timestamp: new Date().toISOString(),
                  data: {
                    momentId: moment.id,
                    index: i,
                    imageUrl: `/api/session/${sessionId}/variation-image/${moment.id}/${i}`,
                  },
                });
              }
            }
            allStoryboards[moment.id] = storyboard;
            return;
          }

          const variantCount = Math.min(Math.max(approvedSession.config.sheetVariantCount ?? 2, 1), 3);
          await emitThinking(
            sessionId,
            `Generating ${variantCount} storyboard variant${variantCount > 1 ? 's' : ''} with GPT Image-2…`,
            'imaging'
          );

          const variantPaths = await generateStoryboardSheet(
            storyboard,
            moment.id,
            sessionId,
            approvedSession.config,
            async (_imagePath, variantIndex) => {
              await emitThinking(
                sessionId,
                `Variant ${variantIndex + 1} of ${variantCount} ready`,
                'imaging'
              );
              await appendEvent(sessionId, {
                type: 'storyboard_frame_ready',
                timestamp: new Date().toISOString(),
                data: {
                  momentId: moment.id,
                  index: variantIndex,
                  imageUrl: `/api/session/${sessionId}/variation-image/${moment.id}/${variantIndex}`,
                },
              });
            }
          );

          // Persist variant count in storyboard so the UI knows how many to show
          {
            const current = await readJsonFile<StoryboardPlan>(storyboardPath(sessionId, moment.id)) ?? storyboard;
            await atomicWriteJson(storyboardPath(sessionId, moment.id), {
              ...current,
              sheetVariantCount: variantPaths.length,
            });
          }

          const finalStoryboard = await readJsonFile<StoryboardPlan>(storyboardPath(sessionId, moment.id)) ?? storyboard;
          allStoryboards[moment.id] = finalStoryboard;
        })
      )
    );

    // Fill in any moments whose sheets were already cached
    for (const moment of approvedMoments) {
      if (!allStoryboards[moment.id]) {
        const s = await readJsonFile<StoryboardPlan>(storyboardPath(sessionId, moment.id));
        if (s) allStoryboards[moment.id] = s;
      }
    }

    // ── Gate 1.5: Storyboard review ───────────────────────────────────────
    await updateSession(sessionId, { storyboards: allStoryboards });
    await appendEvent(sessionId, {
      type: 'gate',
      timestamp: new Date().toISOString(),
      data: {
        gate: 'storyboard_review',
        message: 'Review the storyboard for each moment. Approve or give feedback to refine.',
        storyboards: allStoryboards,
      },
    });

    await waitForStoryboardApprovals(sessionId, approvedMoments.map((m) => m.id));
    logger.info('All storyboards approved', { sessionId });

    // ── Step 6: Generate videos ───────────────────────────────────────────
    await updateSession(sessionId, { status: 'generating_video' });
    await appendEvent(sessionId, {
      type: 'progress',
      timestamp: new Date().toISOString(),
      data: { step: 'generate', message: 'Generating videos…', pct: 70 },
    });

    const videoLimit = pLimit(2);

    await Promise.all(
      approvedMoments.map((moment) =>
        videoLimit(async () => {
          if (await videoExists(sessionId, moment.id)) {
            logger.info('Video already exists, skipping', { momentId: moment.id });
            await appendEvent(sessionId, {
              type: 'video_ready',
              timestamp: new Date().toISOString(),
              data: { momentId: moment.id, videoUrl: `/api/session/${sessionId}/video/${moment.id}` },
            });
            return;
          }

          // Load the latest storyboard from disk (may have been updated by refine-storyboard)
          const storyboard = await readJsonFile<StoryboardPlan>(storyboardPath(sessionId, moment.id));
          if (!storyboard) {
            logger.error('No storyboard found for moment', { momentId: moment.id });
            return;
          }

          const durationSec = moment.endSec - moment.startSec;
          await generateVideoFromStoryboard(storyboard, moment.id, sessionId, approvedSession.config, durationSec);

          await appendEvent(sessionId, {
            type: 'video_ready',
            timestamp: new Date().toISOString(),
            data: { momentId: moment.id, videoUrl: `/api/session/${sessionId}/video/${moment.id}` },
          });

          logger.info('Moment video ready', { momentId: moment.id });
        })
      )
    );

    // ── Done — hand off to per-moment feedback loop ───────────────────────
    await updateSession(sessionId, { status: 'awaiting_feedback' });
    updateSessionStatus(sessionId, 'complete');
    await appendEvent(sessionId, {
      type: 'complete',
      timestamp: new Date().toISOString(),
      data: { message: 'Videos ready — refine or finalize each moment' },
    });

    logger.info('Pipeline complete', { sessionId });
    void metadata;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Pipeline error', { sessionId, error: msg });
    updateSessionStatus(sessionId, 'error');
    await updateSession(sessionId, { status: 'error', error: msg }).catch(() => undefined);
    await appendEvent(sessionId, {
      type: 'error',
      timestamp: new Date().toISOString(),
      data: { message: msg },
    }).catch(() => undefined);
  }
}
