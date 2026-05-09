import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { readJsonFile, scenesFilePath } from '@/lib/utils/file-utils';
import { Scene } from '@/lib/types';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  void req;
  const { sessionId } = await params;
  const session = await getSession(sessionId);
  if (!session || !session.moments) {
    return NextResponse.json({ scenesByMoment: {} });
  }

  const scenesByMoment: Record<string, Scene[]> = {};
  for (const moment of session.moments) {
    const scenes = await readJsonFile<Scene[]>(scenesFilePath(sessionId, moment.id));
    if (scenes) {
      scenesByMoment[moment.id] = scenes;
    }
  }

  return NextResponse.json({ scenesByMoment });
}
