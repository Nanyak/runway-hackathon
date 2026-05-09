import { NextRequest } from 'next/server';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { getSession } from '@/lib/session';
import { readJsonFile, scenesFilePath, sceneImagePath } from '@/lib/utils/file-utils';
import { Scene } from '@/lib/types';
import logger from '@/lib/logger';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; sceneId: string }> }
): Promise<Response> {
  const { sessionId, sceneId } = await params;

  try {
    const session = await getSession(sessionId);
    if (!session?.moments) {
      return new Response('Session not found', { status: 404 });
    }

    for (const moment of session.moments) {
      const scenes = await readJsonFile<Scene[]>(scenesFilePath(sessionId, moment.id));
      const scene = scenes?.find((s) => s.id === sceneId);
      if (!scene) continue;

      const filePath = sceneImagePath(sessionId, moment.id, scene.indexInMoment);
      const stats = await stat(filePath);

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
          'Content-Type': 'image/png',
          'Content-Length': String(stats.size),
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    return new Response('Scene not found', { status: 404 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Image serve error', { sessionId, sceneId, error: msg });
    return new Response('Not found', { status: 404 });
  }
}
