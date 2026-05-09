import { NextRequest } from 'next/server';
import fs from 'fs';
import { momentVideoPath } from '@/lib/utils/file-utils';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; momentId: string }> }
): Promise<Response> {
  const { sessionId, momentId } = await params;
  const filePath = momentVideoPath(sessionId, momentId);

  if (!fs.existsSync(filePath)) {
    return new Response('Video not found', { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const rangeHeader = req.headers.get('range');
  const asDownload = req.nextUrl.searchParams.get('download') === '1';
  const attachmentName = `moment_${momentId.slice(0, 8)}.mp4`;

  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(filePath, { start, end });
    const headers: Record<string, string> = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(chunkSize),
      'Content-Type': 'video/mp4',
    };
    if (asDownload) {
      headers['Content-Disposition'] = `attachment; filename="${attachmentName}"`;
    }
    return new Response(stream as unknown as ReadableStream, {
      status: 206,
      headers,
    });
  }

  const stream = fs.createReadStream(filePath);
  const headers: Record<string, string> = {
    'Content-Type': 'video/mp4',
    'Content-Length': String(fileSize),
    'Accept-Ranges': 'bytes',
  };
  if (asDownload) {
    headers['Content-Disposition'] = `attachment; filename="${attachmentName}"`;
  }
  return new Response(stream as unknown as ReadableStream, {
    headers,
  });
}
