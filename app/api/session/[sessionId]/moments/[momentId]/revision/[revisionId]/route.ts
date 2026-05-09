import { NextRequest } from 'next/server';
import fs from 'fs';
import { revisionPath } from '@/lib/utils/file-utils';
import logger from '@/lib/logger';

interface RouteParams {
  params: Promise<{ sessionId: string; momentId: string; revisionId: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { sessionId, momentId, revisionId } = await params;

  const filePath = revisionPath(sessionId, momentId, revisionId);

  try {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const rangeHeader = req.headers.get('range');

    if (rangeHeader) {
      const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const stream = fs.createReadStream(filePath, { start, end });
      const webStream = new ReadableStream({
        start(controller) {
          stream.on('data', (chunk) => controller.enqueue(chunk));
          stream.on('end', () => controller.close());
          stream.on('error', (err) => controller.error(err));
        },
      });

      return new Response(webStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': 'video/mp4',
        },
      });
    }

    const stream = fs.createReadStream(filePath);
    const webStream = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk) => controller.enqueue(chunk));
        stream.on('end', () => controller.close());
        stream.on('error', (err) => controller.error(err));
      },
    });

    return new Response(webStream, {
      headers: {
        'Content-Length': String(fileSize),
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      },
    });
  } catch {
    logger.warn('Revision video not found', { sessionId, momentId, revisionId, filePath });
    return Response.json(
      {
        error: 'Revision not ready or file missing',
        code: 'NOT_READY',
        sessionId,
        momentId,
        revisionId,
      },
      { status: 404 }
    );
  }
}
