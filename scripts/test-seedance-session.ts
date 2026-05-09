/**
 * One-off: run Seedance image_to_video + moment referenceAudio for an existing session folder.
 * Usage: npx tsx scripts/test-seedance-session.ts [variationIndex]
 * Env: RUNWAY_API_KEY from .env.local
 */
import fs from 'fs';
import path from 'path';
import { generateVideoFromFrame } from '@/lib/modules/video-generator';
import type { FrameVariation, SessionConfig, Moment } from '@/lib/types';
import { momentVideoPath } from '@/lib/utils/file-utils';

function loadEnvLocal(): void {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) {
    console.warn('No .env.local found');
    return;
  }
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  if (!process.env.RUNWAY_API_KEY) {
    console.error('RUNWAY_API_KEY missing (set in .env.local)');
    process.exit(1);
  }

  const sessionId = 'efa0012d-3cd8-4251-adca-004e361b0139';
  const momentId = 'fa3ffd3d-e59f-41d1-afad-12e4b8074cb5';
  const sessionFile = path.join(process.cwd(), 'temp/sessions', sessionId, 'session.json');

  const sessionRaw = JSON.parse(fs.readFileSync(sessionFile, 'utf8')) as {
    config: SessionConfig;
    moments?: Moment[];
    frameSelections?: Record<string, number>;
  };

  const moment = sessionRaw.moments?.find((m) => m.id === momentId);
  if (!moment) {
    console.error('Moment not found');
    process.exit(1);
  }

  const variationsPath = path.join(
    process.cwd(),
    'temp/sessions',
    sessionId,
    'moments',
    momentId,
    'variations.json'
  );
  const variations = JSON.parse(fs.readFileSync(variationsPath, 'utf8')) as FrameVariation[];

  const argIdx = process.argv[2];
  const fromSession = sessionRaw.frameSelections?.[momentId];
  const pick =
    argIdx !== undefined ? Number.parseInt(argIdx, 10) : fromSession !== undefined ? fromSession : 0;

  const variation = variations.find((v) => v.index === pick) ?? variations[0];
  if (!variation?.imagePath || !fs.existsSync(variation.imagePath)) {
    console.error('Variation image missing', { pick, imagePath: variation?.imagePath });
    process.exit(1);
  }

  const audioWav = path.join(path.dirname(variationsPath), 'audio.wav');
  if (!fs.existsSync(audioWav)) {
    console.error('audio.wav missing', audioWav);
    process.exit(1);
  }

  const config: SessionConfig = {
    ...sessionRaw.config,
    videoModel: 'seedance2',
    imageModel: sessionRaw.config.imageModel ?? 'gen4_image',
  };

  const durationSec = moment.endSec - moment.startSec;
  const outVideo = momentVideoPath(sessionId, momentId);

  if (fs.existsSync(outVideo)) {
    const backup = path.join(path.dirname(outVideo), `video.backup.${Date.now()}.mp4`);
    fs.copyFileSync(outVideo, backup);
    console.log('Backed up existing video to', backup);
  }

  console.log('Running Seedance I2V', {
    sessionId,
    momentId,
    variationIndex: variation.index,
    durationSec,
    image: variation.imagePath,
    audio: audioWav,
    outVideo,
  });

  await generateVideoFromFrame(variation, momentId, sessionId, config, durationSec);
  console.log('Done:', outVideo);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
