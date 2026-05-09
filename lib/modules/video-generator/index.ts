import path from 'path';
import fs from 'fs/promises';
import ffmpeg from 'fluent-ffmpeg';
// eslint-disable-next-line
const ffmpegStatic = require('ffmpeg-static') as string;
import RunwayML from '@runwayml/sdk';
import { StoryboardPlan, FrameVariation, SessionConfig } from '@/lib/types';
import {
  momentVideoPath,
  ensureDir,
  momentDir,
  audioPath,
  storyboardFrameImagePath,
} from '@/lib/utils/file-utils';
import {
  getRunwaySdk,
  mapRunwaySdkError,
  uploadImageToRunway,
  uploadAudioToRunway,
  submitImageToVideo,
  submitTextToVideo,
  pollAndDownload,
  clampDurationForSeedance,
} from './runway';
import { STORYBOARD_VIDEO_PROMPT, STORYBOARD_IMAGE_TAG } from '@/lib/config/storyboard-style';
import { retry } from '@/lib/utils/retry';
import logger from '@/lib/logger';

ffmpeg.setFfmpegPath(ffmpegStatic);
// eslint-disable-next-line
const ffprobeStatic = require('ffprobe-static') as { path: string };
ffmpeg.setFfprobePath(ffprobeStatic.path);

/** Seedance referenceAudio: each clip 2–15s, combined max 15s (API). */
export const RUNWAY_REF_AUDIO_MAX_SEC = 15;

/**
 * Build a WAV exactly `targetSec` long (integer seconds) for Seedance referenceAudio.
 * Trims longer inputs; pads silence if shorter.
 */
export async function prepareSeedanceReferenceAudio(
  srcPath: string,
  destPath: string,
  targetSec: number
): Promise<void> {
  const dur = Math.min(RUNWAY_REF_AUDIO_MAX_SEC, Math.max(2, Math.round(targetSec)));
  return new Promise((resolve, reject) => {
    ffmpeg(srcPath)
      .audioFilters(`atrim=duration=${dur},asetpts=PTS-STARTPTS,apad=whole_dur=${dur}`)
      .outputOptions([
        `-t ${dur}`,
        '-acodec',
        'pcm_s16le',
        '-ar',
        '48000',
        '-ac',
        '2',
      ])
      .output(destPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}

/**
 * Generates a video from a storyboard using Seedance2 text_to_video.
 * All storyboard frame images are passed as reference images; moment audio is the referenceAudio.
 */
export async function generateVideoFromStoryboard(
  storyboard: StoryboardPlan,
  momentId: string,
  sessionId: string,
  config: SessionConfig,
  durationSec: number
): Promise<string> {
  await ensureDir(momentDir(sessionId, momentId));
  const destPath = momentVideoPath(sessionId, momentId);
  const ratio = config.orientation === 'vertical' ? '720:1280' : '1280:720';
  const duration = clampDurationForSeedance(durationSec);

  // Upload the selected storyboard sheet variant (defaults to index 0)
  const sheetIndex = storyboard.selectedSheetIndex ?? 0;
  const sheetPath = storyboardFrameImagePath(sessionId, momentId, sheetIndex);
  let sheetUri: string;
  try {
    await fs.stat(sheetPath);
    sheetUri = await uploadImageToRunway(sheetPath);
  } catch {
    throw new Error(`No storyboard sheet image found for moment ${momentId}`);
  }

  // Prepare and upload moment audio
  let referenceAudioUri: string | undefined;
  const refTargetSec = Math.min(RUNWAY_REF_AUDIO_MAX_SEC, duration);
  try {
    const momentAudioPath = audioPath(sessionId, momentId);
    await fs.stat(momentAudioPath);
    const refWav = path.join(momentDir(sessionId, momentId), 'audio_runway_ref.wav');
    await prepareSeedanceReferenceAudio(momentAudioPath, refWav, refTargetSec);
    referenceAudioUri = await uploadAudioToRunway(refWav);
    logger.info('Storyboard video: moment audio uploaded as referenceAudio', { momentId, refTargetSec });
  } catch (audioErr) {
    logger.warn('Storyboard video: skipping referenceAudio', {
      momentId,
      reason: audioErr instanceof Error ? audioErr.message : String(audioErr),
    });
  }

  const RUNWAY_PROMPT_MAX = 1000;
  const promptText = STORYBOARD_VIDEO_PROMPT.slice(0, RUNWAY_PROMPT_MAX);

  // Submit text_to_video with the storyboard sheet + audio
  const body: Record<string, unknown> = {
    model: 'seedance2',
    promptText,
    duration,
    ratio,
    references: [{ uri: sheetUri, tag: STORYBOARD_IMAGE_TAG }],
  };

  if (referenceAudioUri) {
    body.referenceAudio = [{ type: 'audio', uri: referenceAudioUri }];
  }

  logger.info('Submitting storyboard text_to_video', {
    momentId,
    hasAudio: Boolean(referenceAudioUri),
    duration,
  });

  const jobId = await retry(
    async () => {
      try {
        const created = await getRunwaySdk().textToVideo.create(
          body as unknown as RunwayML.TextToVideoCreateParams
        );
        const { id } = await created;
        return id;
      } catch (err) {
        mapRunwaySdkError(err, 'storyboard_text_to_video');
      }
    },
    { maxAttempts: 3, delayMs: 5000, backoff: 'exponential' }
  );

  await pollAndDownload(jobId, destPath);
  logger.info('Storyboard video generated', { momentId, destPath });
  return destPath;
}

/**
 * Check whether a moment's video already exists on disk (resume support).
 */
export async function videoExists(sessionId: string, momentId: string): Promise<boolean> {
  try {
    await fs.stat(momentVideoPath(sessionId, momentId));
    return true;
  } catch {
    return false;
  }
}

/** @deprecated Use generateVideoFromStoryboard instead. */
export async function generateVideoFromFrame(
  variation: FrameVariation,
  momentId: string,
  sessionId: string,
  config: SessionConfig,
  durationSec: number
): Promise<string> {
  await ensureDir(momentDir(sessionId, momentId));
  const destPath = momentVideoPath(sessionId, momentId);

  if (variation.imagePath) {
    let imageJobId: string | null = null;
    try {
      let referenceAudioUri: string | undefined;
      const plannedVideoSec = clampDurationForSeedance(durationSec);
      const refTargetSec = Math.min(RUNWAY_REF_AUDIO_MAX_SEC, plannedVideoSec);
      let runwayDurationSec = plannedVideoSec;

      try {
        const momentAudio = audioPath(sessionId, momentId);
        await fs.stat(momentAudio);
        const refWav = path.join(momentDir(sessionId, momentId), 'audio_runway_ref.wav');
        await prepareSeedanceReferenceAudio(momentAudio, refWav, refTargetSec);
        referenceAudioUri = await uploadAudioToRunway(refWav);
        runwayDurationSec = refTargetSec;
      } catch (audioErr) {
        logger.debug('Skipping Runway reference audio', {
          momentId,
          reason: audioErr instanceof Error ? audioErr.message : String(audioErr),
        });
      }

      const runwayUri = await uploadImageToRunway(variation.imagePath);
      imageJobId = await submitImageToVideo(runwayUri, variation, config, runwayDurationSec, {
        referenceAudioUri,
      });
    } catch (err) {
      logger.warn('image_to_video submission failed', {
        momentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (imageJobId) {
      try {
        await pollAndDownload(imageJobId, destPath);
        return destPath;
      } catch (err) {
        logger.warn('image_to_video poll failed', {
          momentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const textJobId = await submitTextToVideo(variation, config, durationSec, {});
  await pollAndDownload(textJobId, destPath);
  return destPath;
}
