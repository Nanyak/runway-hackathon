import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  deleteUserSessionByFileId,
  getSessionRecordByFileId,
  updateSessionDisplayName,
} from '@/lib/db';
import { getSession } from '@/lib/session';
import logger from '@/lib/logger';
import { removeSessionDir } from '@/lib/utils/file-utils';

const PatchBodySchema = z.object({
  displayName: z.string().trim().min(1).max(200),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const { sessionId } = await params;

  try {
    const session = await getSession(sessionId);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const authSession = await getServerSession(authOptions);
    const userId = (authSession?.user as { id?: string } | undefined)?.id ?? '';
    let listMeta: { displayName: string | null } | undefined;
    if (userId) {
      const rec = await getSessionRecordByFileId(sessionId);
      if (rec && rec.user_id === userId) {
        const dn = rec.display_name?.trim();
        listMeta = { displayName: dn ? dn : null };
      }
    }

    return Response.json({ session, ...(listMeta !== undefined ? { listMeta } : {}) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Error fetching session', { sessionId, error: msg });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const { sessionId } = await params;

  try {
    const authSession = await getServerSession(authOptions);
    if (!authSession?.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (authSession.user as { id?: string }).id ?? '';

    const body = await req.json().catch(() => null);
    const parsed = PatchBodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 });
    }

    const rec = await getSessionRecordByFileId(sessionId);
    if (!rec || rec.user_id !== userId) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const ok = await updateSessionDisplayName(userId, sessionId, parsed.data.displayName);
    if (!ok) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    return Response.json({
      ok: true,
      listMeta: { displayName: parsed.data.displayName },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Error patching session', { sessionId, error: msg });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const { sessionId } = await params;

  try {
    const authSession = await getServerSession(authOptions);
    if (!authSession?.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (authSession.user as { id?: string }).id ?? '';

    const rec = await getSessionRecordByFileId(sessionId);
    if (!rec || rec.user_id !== userId) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    await removeSessionDir(sessionId);
    await deleteUserSessionByFileId(userId, sessionId);

    logger.info('Session deleted by user', { sessionId, userId });
    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Error deleting session', { sessionId, error: msg });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
