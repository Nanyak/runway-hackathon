import { NextRequest } from 'next/server';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createSession } from '@/lib/session';
import { ensureDir, sessionDir } from '@/lib/utils/file-utils';
import { createSessionRecord } from '@/lib/db';
import logger from '@/lib/logger';
import { SessionConfig } from '@/lib/types';
import { DEFAULT_STYLE_ANCHOR, resolveStyleAnchor } from '@/lib/config/style-presets';

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
const SessionConfigSchema = z.object({
  maxMoments: z.number().int().min(1).max(10),
  imageModel: z.string().min(1).max(100).optional(),
  videoModel: z.string().min(1).max(100),
  orientation: z.enum(['vertical', 'landscape']),
  styleAnchor: z.string().max(500),
  speakerName: z.string().max(200),
  showName: z.string().max(200),
  sheetVariantCount: z.number().int().min(1).max(3).default(2),
});
const DEFAULT_CONFIG: SessionConfig = {
  maxMoments: 3,
  imageModel: 'gpt_image_2',
  videoModel: 'seedance2',
  orientation: 'vertical',
  styleAnchor: DEFAULT_STYLE_ANCHOR,
  speakerName: '',
  showName: '',
  sheetVariantCount: 2,
};

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const authSession = await getServerSession(authOptions);
    if (!authSession?.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (authSession.user as { id?: string }).id ?? '';

    const formData = await req.formData();
    const file = formData.get('file');
    const configRaw = formData.get('config');

    if (!file || !(file instanceof Blob)) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!file.type.startsWith('audio/')) {
      return Response.json({ error: 'File must be an audio file' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json({ error: 'File must be under 2 GB' }, { status: 400 });
    }

    // Parse + validate config
    let config: SessionConfig = DEFAULT_CONFIG;
    try {
      if (configRaw) {
        const parsed = SessionConfigSchema.safeParse(JSON.parse(String(configRaw)));
        if (!parsed.success) {
          return Response.json({ error: 'Invalid config', details: parsed.error.flatten() }, { status: 400 });
        }
        config = {
          ...parsed.data,
          imageModel: 'gpt_image_2',
          styleAnchor: resolveStyleAnchor(parsed.data.styleAnchor),
          sheetVariantCount: parsed.data.sheetVariantCount ?? 2,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Config parse failed', { error: msg });
      return Response.json({ error: 'Invalid config JSON' }, { status: 400 });
    }

    const sessionId = uuidv4();
    const dir = sessionDir(sessionId);
    await ensureDir(dir);

    // Determine extension from MIME type or filename
    const fileName = file instanceof File ? file.name : 'audio.mp3';
    const ext = path.extname(fileName) || '.mp3';
    const audioFilePath = path.join(dir, `original_audio${ext}`);

    await new Promise<void>((resolve, reject) => {
      const readable = Readable.fromWeb(file.stream() as import('stream/web').ReadableStream);
      const writer = createWriteStream(audioFilePath);
      readable.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
      readable.on('error', reject);
    });

    // Pass the pre-generated sessionId so the audio dir and session.json share the same UUID.
    const session = await createSession(config, audioFilePath, sessionId);

    // Record in SQLite for history
    await createSessionRecord(userId, session.id, {
      title: 'Untitled podcast',
      speakerName: config.speakerName,
      showName: config.showName,
    });

    logger.info('Audio uploaded', {
      sessionId: session.id,
      size: file.size,
      mimeType: file.type,
    });

    // Fire and forget pipeline
    setImmediate(() => {
      import('@/lib/pipeline/orchestrator')
        .then(({ runPipeline }) => runPipeline(session.id))
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Pipeline failed', { sessionId: session.id, error: msg });
        });
    });

    return Response.json({ sessionId: session.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Upload error', { error: msg });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
