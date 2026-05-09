import { NextRequest } from 'next/server';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { finalPath } from '@/lib/utils/file-utils';
import logger from '@/lib/logger';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; momentId: string }> }
): Promise<Response> {
  const { sessionId, momentId } = await params;

  const filePath = finalPath(sessionId, momentId);

  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      return new Response('Not found', { status: 404 });
    }

    const stream = createReadStream(filePath);
    const readable = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk) => controller.enqueue(chunk));
        stream.on('end', () => controller.close());
        stream.on('error', (err) => controller.error(err));
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(stats.size),
        'Content-Disposition': `attachment; filename="moment_${momentId.slice(0, 8)}.mp4"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Download error', { sessionId, momentId, error: msg });
    return new Response('Not found', { status: 404 });
  }
}
