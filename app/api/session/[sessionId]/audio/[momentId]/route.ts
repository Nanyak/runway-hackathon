import { NextRequest } from 'next/server';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { audioPath } from '@/lib/utils/file-utils';
import logger from '@/lib/logger';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; momentId: string }> }
): Promise<Response> {
  const { sessionId, momentId } = await params;

  const filePath = audioPath(sessionId, momentId);

  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      return new Response('Not found', { status: 404 });
    }

    const stream = createReadStream(filePath);
    const readable = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk) => {
          try { controller.enqueue(chunk as Uint8Array); } catch { stream.destroy(); }
        });
        stream.on('end', () => {
          try { controller.close(); } catch { /* already closed */ }
        });
        stream.on('error', (err) => {
          try { controller.error(err); } catch { /* already closed */ }
        });
      },
      cancel() { stream.destroy(); },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(stats.size),
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Audio serve error', { sessionId, momentId, error: msg });
    return new Response('Not found', { status: 404 });
  }
}
