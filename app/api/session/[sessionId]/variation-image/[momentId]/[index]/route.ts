import { NextRequest } from 'next/server';
import fs from 'fs';
import { storyboardFrameImagePath, variationImagePath } from '@/lib/utils/file-utils';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; momentId: string; index: string }> }
): Promise<Response> {
  const { sessionId, momentId, index } = await params;
  const idx = parseInt(index, 10);

  if (isNaN(idx)) return new Response('Invalid index', { status: 400 });

  // Try storyboard frame image first (new flow), then fall back to variation image (legacy)
  const storyboardPath = storyboardFrameImagePath(sessionId, momentId, idx);
  const variationPath = variationImagePath(sessionId, momentId, idx);

  const filePath = fs.existsSync(storyboardPath) ? storyboardPath : variationPath;

  if (!fs.existsSync(filePath)) {
    return new Response('Image not found', { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  return new Response(buffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache',
    },
  });
}
