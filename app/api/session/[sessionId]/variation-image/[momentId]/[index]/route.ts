import { NextRequest } from 'next/server';
import fs from 'fs';
import { storyboardFrameImagePath, variationImagePath, ensureLocalFile } from '@/lib/utils/file-utils';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; momentId: string; index: string }> }
): Promise<Response> {
  const { sessionId, momentId, index } = await params;
  const idx = parseInt(index, 10);

  if (isNaN(idx)) return new Response('Invalid index', { status: 400 });

  const storyboardPath = storyboardFrameImagePath(sessionId, momentId, idx);
  const variationPath = variationImagePath(sessionId, momentId, idx);

  let filePath = fs.existsSync(storyboardPath) ? storyboardPath : variationPath;

  if (!fs.existsSync(filePath)) {
    const pulled = await ensureLocalFile(storyboardPath) || await ensureLocalFile(variationPath);
    if (!pulled) return new Response('Image not found', { status: 404 });
    filePath = fs.existsSync(storyboardPath) ? storyboardPath : variationPath;
  }

  const buffer = fs.readFileSync(filePath);
  return new Response(buffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache',
    },
  });
}
