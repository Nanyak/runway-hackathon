import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { finalPath, ensureLocalFile } from '@/lib/utils/file-utils';
import fs from 'fs';
import archiver from 'archiver';
import { Readable } from 'stream';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  void req;
  const { sessionId } = await params;
  const session = await getSession(sessionId);
  if (!session) {
    return new NextResponse('Session not found', { status: 404 });
  }

  const approvedIds = session.approvedMomentIds ?? [];
  const moments = (session.moments ?? []).filter((m) => approvedIds.includes(m.id));

  const readyMoments: typeof moments = [];
  for (const m of moments) {
    const fp = finalPath(sessionId, m.id);
    const available = fs.existsSync(fp) || await ensureLocalFile(fp);
    if (available) readyMoments.push(m);
  }

  if (readyMoments.length === 0) {
    return new NextResponse('No videos ready', { status: 404 });
  }

  const archive = archiver('zip', { zlib: { level: 6 } });

  for (const moment of readyMoments) {
    const fp = finalPath(sessionId, moment.id);
    const filename = `${moment.title.replace(/[^a-z0-9]/gi, '_').substring(0, 40)}_${moment.id.substring(0, 8)}.mp4`;
    archive.file(fp, { name: filename });
  }

  archive.finalize();

  // Convert Node.js Readable to Web ReadableStream
  const webStream = Readable.toWeb(archive as unknown as import('stream').Readable) as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="viral_clips_${sessionId.substring(0, 8)}.zip"`,
    },
  });
}
