/**
 * Seedance text_to_video with multiple reference PNGs + referenceAudio (Runway API shape).
 * Image-to-video accepts only one keyframe; multiple stills go through T2V `references` + `referenceAudio`.
 *
 * Usage: npx tsx scripts/test-seedance-t2v-refs-audio.ts
 */
import fs from 'fs';
import path from 'path';
import {
  uploadImageToRunway,
  uploadAudioToRunway,
  submitTextToVideo,
  pollAndDownload,
  clampDurationForSeedance,
} from '@/lib/modules/video-generator/runway';
import {
  prepareSeedanceReferenceAudio,
  RUNWAY_REF_AUDIO_MAX_SEC,
} from '@/lib/modules/video-generator/index';
import type { FrameVariation, SessionConfig, Moment } from '@/lib/types';
import { momentDir, audioPath } from '@/lib/utils/file-utils';

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
  if (!process.env.RUNWAY_API_KEY && !process.env.RUNWAYML_API_SECRET) {
    console.error('RUNWAY_API_KEY or RUNWAYML_API_SECRET missing (.env.local)');
    process.exit(1);
  }

  const sessionId = 'efa0012d-3cd8-4251-adca-004e361b0139';
  const momentId = 'fa3ffd3d-e59f-41d1-afad-12e4b8074cb5';
  const sessionFile = path.join(process.cwd(), 'temp/sessions', sessionId, 'session.json');

  const sessionRaw = JSON.parse(fs.readFileSync(sessionFile, 'utf8')) as {
    config: SessionConfig;
    moments?: Moment[];
  };

  const moment = sessionRaw.moments?.find((m) => m.id === momentId);
  if (!moment) {
    console.error('Moment not found');
    process.exit(1);
  }

  const variationsPath = path.join(momentDir(sessionId, momentId), 'variations.json');
  const variations = JSON.parse(fs.readFileSync(variationsPath, 'utf8')) as FrameVariation[];

  const ordered = [0, 1, 2]
    .map((i) => variations.find((v) => v.index === i))
    .filter((v): v is FrameVariation => Boolean(v?.imagePath && fs.existsSync(v.imagePath)));

  if (ordered.length === 0) {
    console.error('No variation PNGs found');
    process.exit(1);
  }

  const momentAudio = audioPath(sessionId, momentId);
  if (!fs.existsSync(momentAudio)) {
    console.error('audio.wav missing', momentAudio);
    process.exit(1);
  }

  const config: SessionConfig = {
    ...sessionRaw.config,
    videoModel: 'seedance2',
    imageModel: sessionRaw.config.imageModel ?? 'gen4_image',
  };

  const durationSec = moment.endSec - moment.startSec;
  const plannedVideoSec = clampDurationForSeedance(durationSec);
  const refTargetSec = Math.min(RUNWAY_REF_AUDIO_MAX_SEC, plannedVideoSec);

  const refWav = path.join(momentDir(sessionId, momentId), 'audio_runway_ref_t2v_test.wav');
  await prepareSeedanceReferenceAudio(momentAudio, refWav, refTargetSec);
  const audioUri = await uploadAudioToRunway(refWav);

  console.log('Uploading reference images...');
  const referenceImageUris: string[] = [];
  for (const v of ordered) {
    referenceImageUris.push(await uploadImageToRunway(v.imagePath!));
  }

  const promptVariation = ordered[0];
  const outVideo = path.join(
    momentDir(sessionId, momentId),
    `video_t2v_${referenceImageUris.length}refs_audio_${Date.now()}.mp4`
  );

  console.log('Submitting Seedance T2V (references + referenceAudio)', {
    refImages: referenceImageUris.length,
    refTargetSec,
    promptVariation: promptVariation.index,
    outVideo,
  });

  const jobId = await submitTextToVideo(promptVariation, config, refTargetSec, {
    referenceImageUris,
    referenceAudioUris: [audioUri],
  });

  await pollAndDownload(jobId, outVideo);
  console.log('Done:', outVideo);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
