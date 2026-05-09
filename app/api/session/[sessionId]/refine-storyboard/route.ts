import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession, updateSession, appendEvent } from '@/lib/session';
import { analyzeStoryboardFeedback } from '@/lib/modules/storyboard-analyzer';
import { regenerateStoryboardFrames } from '@/lib/modules/image-generator';
import { storyboardPath, atomicWriteJson, readJsonFile } from '@/lib/utils/file-utils';
import { StoryboardPlan } from '@/lib/types';
import logger from '@/lib/logger';

const MAX_ITERATIONS = 3;

const RefineStoryboardSchema = z.object({
  momentId: z.string().uuid(),
  feedback: z.string().min(1).max(1000),
});

async function runRefinement(
  sessionId: string,
  momentId: string,
  feedback: string,
  storyboard: StoryboardPlan,
  sessionConfig: import('@/lib/types').SessionConfig,
  moment: import('@/lib/types').Moment
): Promise<void> {
  try {
    // AI analysis: which frames to regenerate + updated prompts
    const analysis = await analyzeStoryboardFeedback(storyboard, feedback, moment, sessionConfig);

    await appendEvent(sessionId, {
      type: 'storyboard_analysis_complete',
      timestamp: new Date().toISOString(),
      data: {
        momentId,
        framesToRegenerate: analysis.framesToRegenerate,
      },
    });

    // Regenerate only the frames that changed
    let updatedFrames = analysis.updatedFrames;
    if (analysis.framesToRegenerate.length > 0) {
      updatedFrames = await regenerateStoryboardFrames(
        analysis.updatedFrames,
        analysis.framesToRegenerate,
        momentId,
        sessionId,
        sessionConfig,
        async (index, imagePath) => {
          const current = await readJsonFile<StoryboardPlan>(storyboardPath(sessionId, momentId));
          if (current) {
            const patched: StoryboardPlan = {
              ...current,
              frames: current.frames.map((f) => (f.index === index ? { ...f, imagePath } : f)),
            };
            await atomicWriteJson(storyboardPath(sessionId, momentId), patched);
          }

          await appendEvent(sessionId, {
            type: 'storyboard_frame_ready',
            timestamp: new Date().toISOString(),
            data: {
              momentId,
              index,
              imageUrl: `/api/session/${sessionId}/variation-image/${momentId}/${index}`,
            },
          });
        }
      );
    }

    // Save the final updated storyboard
    const finalStoryboard: StoryboardPlan = {
      frames: updatedFrames,
      overallMotionPrompt: analysis.updatedMotionPrompt,
    };
    await atomicWriteJson(storyboardPath(sessionId, momentId), finalStoryboard);

    // Update session storyboards map and increment iteration count
    const session = await getSession(sessionId);
    if (session) {
      const iterations = session.storyboardIterations ?? {};
      const storyboards = session.storyboards ?? {};
      await updateSession(sessionId, {
        storyboards: { ...storyboards, [momentId]: finalStoryboard },
        storyboardIterations: { ...iterations, [momentId]: (iterations[momentId] ?? 0) + 1 },
      });
    }

    await appendEvent(sessionId, {
      type: 'storyboard_ready',
      timestamp: new Date().toISOString(),
      data: { momentId },
    });

    logger.info('Storyboard refinement complete', {
      sessionId,
      momentId,
      framesRegenerated: analysis.framesToRegenerate.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Storyboard refinement failed', { sessionId, momentId, error: msg });
    await appendEvent(sessionId, {
      type: 'error',
      timestamp: new Date().toISOString(),
      data: { message: `Storyboard refinement failed: ${msg}`, momentId },
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
    if (session.status !== 'awaiting_storyboard_review') {
      return Response.json(
        { error: `Cannot refine storyboard in status "${session.status}"` },
        { status: 409 }
      );
    }

    const raw = await req.json();
    const parsed = RefineStoryboardSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 });
    }

    const { momentId, feedback } = parsed.data;

    const approvedIds = session.approvedMomentIds ?? [];
    if (!approvedIds.includes(momentId)) {
      return Response.json({ error: `Moment ${momentId} is not in the approved moments list` }, { status: 400 });
    }

    const iterations = session.storyboardIterations ?? {};
    if ((iterations[momentId] ?? 0) >= MAX_ITERATIONS) {
      return Response.json(
        { error: `Maximum refinement iterations (${MAX_ITERATIONS}) reached for this moment` },
        { status: 422 }
      );
    }

    const storyboard = await readJsonFile<StoryboardPlan>(storyboardPath(sessionId, momentId));
    if (!storyboard) {
      return Response.json({ error: 'Storyboard not found for this moment' }, { status: 404 });
    }

    const moment = (session.moments ?? []).find((m) => m.id === momentId);
    if (!moment) {
      return Response.json({ error: 'Moment not found in session' }, { status: 404 });
    }

    // Run refinement in background — respond immediately so the client can listen via SSE
    void runRefinement(sessionId, momentId, feedback, storyboard, session.config, moment);

    return Response.json({ ok: true, iterationsUsed: (iterations[momentId] ?? 0) + 1, maxIterations: MAX_ITERATIONS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Refine storyboard error', { sessionId, error: msg });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
