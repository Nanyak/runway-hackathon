import { NextRequest } from 'next/server';
import { z } from 'zod';
import { unlink } from 'fs/promises';
import { getSession, updateSession } from '@/lib/session';
import logger from '@/lib/logger';
import { audioPath } from '@/lib/utils/file-utils';
import type { Moment } from '@/lib/types';

const MIN_CLIP_SEC = 2;

const ApproveSchema = z.object({
  approvedIds: z.array(z.string().uuid()),
  hookEdits: z.record(z.string().uuid(), z.string().max(1000)).optional().default({}),
  styleAnchors: z.record(z.string().uuid(), z.string().max(300)).optional().default({}),
  sheetVariantCount: z.number().int().min(1).max(3).default(2),
  /** Per-moment trim within the detected window (min clip length enforced server-side). */
  trimBounds: z.record(z.string().uuid(), z.object({
    startSec: z.number(),
    endSec: z.number(),
  })).optional().default({}),
});

function clampTrimToMoment(moment: Moment, t: { startSec: number; endSec: number }): { startSec: number; endSec: number } {
  const lo = moment.startSec;
  const hi = moment.endSec;
  const span = hi - lo;
  if (span < MIN_CLIP_SEC + 0.01) {
    return { startSec: lo, endSec: hi };
  }
  let start = Math.min(Math.max(t.startSec, lo), hi - MIN_CLIP_SEC);
  let end = Math.max(Math.min(t.endSec, hi), lo + MIN_CLIP_SEC);
  if (end - start < MIN_CLIP_SEC) {
    return { startSec: lo, endSec: hi };
  }
  return { startSec: start, endSec: end };
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
        { error: `Cannot approve moments in status "${session.status}"` },
        { status: 409 }
      );
    }

    const raw = await req.json();
    const parsed = ApproveSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 });
    }

    const { approvedIds, hookEdits, styleAnchors, sheetVariantCount, trimBounds } = parsed.data;
    const detectedMomentIds = new Set((session.moments ?? []).map((m) => m.id));
    for (const momentId of approvedIds) {
      if (!detectedMomentIds.has(momentId)) {
        return Response.json({ error: `Moment ${momentId} not found in detected moments` }, { status: 400 });
      }
    }

    for (const tid of Object.keys(trimBounds)) {
      if (!approvedIds.includes(tid)) {
        return Response.json({ error: `Trim entry for moment ${tid} must be for an approved moment only` }, { status: 400 });
      }
    }

    if (approvedIds.length === 0) {
      return Response.json({ error: 'At least one moment must be approved' }, { status: 400 });
    }

    const momentById = new Map((session.moments ?? []).map((m) => [m.id, m]));
    const updatedMoments = (session.moments ?? []).map((m) => {
      if (!approvedIds.includes(m.id)) return m;
      const raw = trimBounds[m.id];
      if (!raw) return m;
      const base = momentById.get(m.id);
      if (!base) return m;
      const trimmed = clampTrimToMoment(base, raw);
      return { ...m, startSec: trimmed.startSec, endSec: trimmed.endSec };
    });

    // Remove stale previews so the orchestrator re-extracts with trimmed bounds
    for (const id of approvedIds) {
      try {
        await unlink(audioPath(sessionId, id));
      } catch {
        /* missing file is fine */
      }
    }

    // Flip to 'awaiting_storyboard_review' — orchestrator proceeds to plan storyboards + generate frame images
    await updateSession(sessionId, {
      moments: updatedMoments,
      approvedMomentIds: approvedIds,
      hookEdits,
      momentStyleAnchors: styleAnchors,
      config: { ...session.config, sheetVariantCount },
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
