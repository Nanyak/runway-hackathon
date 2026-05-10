import path from 'path';
import fs from 'fs/promises';
import ffmpeg from 'fluent-ffmpeg';
import RunwayML from '@runwayml/sdk';
import { VideoRevision, SessionConfig } from '@/lib/types';
import {
  revisionPath,
  revisionsMetaPath,
  ensureDir,
  momentDir,
  audioPath,
  downloadFile,
  atomicWriteJson,
  readJsonFile,
  ensureLocalFile,
} from '@/lib/utils/file-utils';
import { retry, RetryableError, PermanentError, sleep } from '@/lib/utils/retry';
import {
  getRunwaySdk,
  mapRunwaySdkError,
  clampDurationForSeedance,
  uploadAudioToRunway,
} from '@/lib/modules/video-generator/runway';
import { prepareSeedanceReferenceAudio, RUNWAY_REF_AUDIO_MAX_SEC } from '@/lib/modules/video-generator/index';
import logger from '@/lib/logger';

// eslint-disable-next-line
const ffmpegStatic = require('ffmpeg-static') as string;
// eslint-disable-next-line
const ffprobeStatic = require('ffprobe-static') as { path: string };
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

const RUNWAY_BASE_URL = 'https://api.dev.runwayml.com';
const RUNWAY_VERSION = '2024-11-06';
const POLL_INTERVAL_MS = 10_000;
// video_to_video (esp. gen4_aleph + seedance2 with reference audio) regularly
// spends time queued/throttled before running. Cap at 20 minutes total so a
// single slow refinement doesn't fail a session.
const MAX_POLL_ATTEMPTS = 120;

interface RunwayUploadSlotResponse {
  uploadUrl: string;
  fields: Record<string, string>;
  runwayUri: string;
}

function getHeaders(contentType = 'application/json'): Record<string, string> {
  const key = process.env.RUNWAY_API_KEY ?? process.env.RUNWAYML_API_SECRET ?? '';
  if (!key) {
    throw new PermanentError('RUNWAY_API_KEY or RUNWAYML_API_SECRET is not set');
  }
  return {
    Authorization: `Bearer ${key}`,
    'X-Runway-Version': RUNWAY_VERSION,
    'Content-Type': contentType,
  };
}

// ─── Step 1: Upload the source video to Runway, get a runway:// URI ───────────

async function uploadVideoToRunway(videoPath: string): Promise<string> {
  const filename = videoPath.split('/').pop() ?? 'source.mp4';

  // Create an upload slot
  const slot = await retry(
    async () => {
      const res = await fetch(`${RUNWAY_BASE_URL}/v1/uploads`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ filename, type: 'ephemeral' }),
      });

      if (res.status === 429) throw new RetryableError('Rate limited on upload create');
      if (res.status === 401 || res.status === 403) throw new PermanentError(`Auth error: ${res.status}`);
      if (!res.ok) throw new RetryableError(`Upload create failed: ${res.status} ${await res.text()}`);

      return res.json() as Promise<RunwayUploadSlotResponse>;
    },
    { maxAttempts: 3, delayMs: 3000, backoff: 'exponential' }
  );

  logger.info('Upload slot created for revision source', { filename });

  // Upload source file bytes to the presigned form endpoint.
  const fileBuffer = await fs.readFile(videoPath);
  const form = new FormData();
  for (const [k, v] of Object.entries(slot.fields)) {
    form.append(k, v);
  }
  form.append('file', new Blob([fileBuffer], { type: 'video/mp4' }), filename);

  await retry(
    async () => {
      const res = await fetch(slot.uploadUrl, { method: 'POST', body: form });

      if (!res.ok) throw new RetryableError(`Upload POST failed: ${res.status}`);
    },
    { maxAttempts: 3, delayMs: 3000, backoff: 'exponential' }
  );

  logger.info('Revision source uploaded to Runway', { uri: slot.runwayUri.slice(0, 30) });
  return slot.runwayUri;
}

async function probeVideoDurationSec(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data.format.duration ?? 0);
    });
  });
}

// ─── Step 2: Submit video_to_video job ────────────────────────────────────────

/** When set, `durationSec` is already aligned with optional reference audio (see initial I2V). */
interface SeedanceVideoToVideoOpts {
  durationSec: number;
  referenceAudioUri?: string;
}

async function submitVideoToVideo(
  runwayUri: string,
  feedback: string,
  config: SessionConfig,
  sourceVideoPath: string,
  seedanceOpts?: SeedanceVideoToVideoOpts
): Promise<string> {
  const ratio = config.orientation === 'vertical' ? '720:1280' : '1280:720';

  const response = await retry(
    async () => {
      try {
        if (config.videoModel === 'seedance2') {
          let duration: number;
          if (seedanceOpts) {
            duration = clampDurationForSeedance(seedanceOpts.durationSec);
          } else {
            let inputSec = 10;
            try {
              inputSec = await probeVideoDurationSec(sourceVideoPath);
            } catch {
              logger.debug('ffprobe failed for revision source, using default duration hint');
            }
            duration = clampDurationForSeedance(inputSec);
          }
          const body: Record<string, unknown> = {
            model: 'seedance2',
            promptVideo: runwayUri,
            promptText: feedback,
            ratio,
            duration,
          };
          if (seedanceOpts?.referenceAudioUri) {
            body.referenceAudio = [{ type: 'audio', uri: seedanceOpts.referenceAudioUri }];
          }
          const created = await getRunwaySdk().videoToVideo.create(
            body as unknown as RunwayML.VideoToVideoCreateParams
          );
          const { id } = await created;
          return { id };
        }

        const created = await getRunwaySdk().videoToVideo.create({
          model: 'gen4_aleph',
          videoUri: runwayUri,
          promptText: feedback,
          ratio,
        });
        const { id } = await created;
        return { id };
      } catch (err) {
        mapRunwaySdkError(err, 'video_to_video');
      }
    },
    { maxAttempts: 3, delayMs: 5000, backoff: 'exponential' }
  );

  logger.info('video_to_video job submitted', {
    jobId: response.id,
    model: config.videoModel === 'seedance2' ? 'seedance2' : 'gen4_aleph',
    referenceAudio: Boolean(seedanceOpts?.referenceAudioUri),
  });
  return response.id;
}

// ─── Step 3: Poll until done, download result ─────────────────────────────────

async function pollAndDownloadRevision(jobId: string, destPath: string): Promise<void> {
  interface PollResponse {
    status: 'PENDING' | 'RUNNING' | 'THROTTLED' | 'SUCCEEDED' | 'FAILED';
    output?: string[];
    failure?: string;
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const res = await fetch(`${RUNWAY_BASE_URL}/v1/tasks/${jobId}`, {
      headers: getHeaders(),
    });

    if (!res.ok) throw new RetryableError(`Polling failed: ${res.status}`);

    const result = await res.json() as PollResponse;
    logger.debug('Polling revision job', { jobId, status: result.status, attempt });

    if (result.status === 'THROTTLED') {
      logger.info('Revision job throttled (queued by Runway)', { jobId, attempt });
      continue;
    }

    if (result.status === 'SUCCEEDED') {
      const outputUrl = result.output?.[0];
      if (!outputUrl) throw new RetryableError('SUCCEEDED but no output URL');
      await downloadFile(outputUrl, destPath);
      logger.info('Revision video downloaded', { jobId, destPath });
      return;
    }

    if (result.status === 'FAILED') {
      throw new RetryableError(`video_to_video job failed: ${result.failure ?? 'unknown'}`);
    }
  }

  throw new RetryableError(`video_to_video timed out after ${MAX_POLL_ATTEMPTS} attempts`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function loadRevisions(sessionId: string, momentId: string): Promise<VideoRevision[]> {
  const data = await readJsonFile<VideoRevision[]>(revisionsMetaPath(sessionId, momentId));
  return data ?? [];
}

async function saveRevisions(sessionId: string, momentId: string, revisions: VideoRevision[]): Promise<void> {
  await atomicWriteJson(revisionsMetaPath(sessionId, momentId), revisions);
}

/**
 * Creates a new revision record (status: pending), writes it to disk, and
 * immediately kicks off the async generation. Returns the revision ID so the
 * client can start polling.
 */
export async function createRevision(
  sessionId: string,
  momentId: string,
  feedback: string,
  config: SessionConfig
): Promise<VideoRevision> {
  await ensureDir(momentDir(sessionId, momentId));

  const revisions = await loadRevisions(sessionId, momentId);
  const revisionId = String(revisions.length + 1);

  const revision: VideoRevision = {
    id: revisionId,
    momentId,
    feedback,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  revisions.push(revision);
  await saveRevisions(sessionId, momentId, revisions);

  // Run generation in background — caller does not await this
  runRevisionGeneration(sessionId, momentId, revisionId, feedback, config).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Revision generation failed', { sessionId, momentId, revisionId, error: msg });
  });

  return revision;
}

async function runRevisionGeneration(
  sessionId: string,
  momentId: string,
  revisionId: string,
  feedback: string,
  config: SessionConfig
): Promise<void> {
  const updateStatus = async (patch: Partial<VideoRevision>) => {
    const revisions = await loadRevisions(sessionId, momentId);
    const idx = revisions.findIndex((r) => r.id === revisionId);
    if (idx !== -1) {
      revisions[idx] = { ...revisions[idx], ...patch };
      await saveRevisions(sessionId, momentId, revisions);
    }
  };

  try {
    await updateStatus({ status: 'generating' });

    // Use the latest ready revision as source, falling back to the raw generated video
    const { momentVideoPath } = await import('@/lib/utils/file-utils');
    const allRevisions = await loadRevisions(sessionId, momentId);
    const previousReady = [...allRevisions]
      .reverse()
      .find((r) => r.id !== revisionId && r.status === 'ready');

    const sourcePath = previousReady?.videoPath
      ? previousReady.videoPath
      : momentVideoPath(sessionId, momentId);

    const destPath = revisionPath(sessionId, momentId, revisionId);

    // 1. Ensure source video is local (may need to pull from S3 after a redeploy)
    await ensureLocalFile(sourcePath);

    // 2. Upload source video to Runway
    const runwayUri = await uploadVideoToRunway(sourcePath);

    // 2. Submit video_to_video
    let jobId: string;
    if (config.videoModel === 'seedance2') {
      let inputSec = 10;
      try {
        inputSec = await probeVideoDurationSec(sourcePath);
      } catch {
        logger.debug('ffprobe failed for revision source, using default duration hint');
      }
      const planned = clampDurationForSeedance(inputSec);
      let durationSec = planned;
      let referenceAudioUri: string | undefined;
      try {
        const momentAudio = audioPath(sessionId, momentId);
        await fs.stat(momentAudio);
        const refWav = path.join(momentDir(sessionId, momentId), 'audio_runway_ref_v2v.wav');
        const refTargetSec = Math.min(RUNWAY_REF_AUDIO_MAX_SEC, planned);
        await prepareSeedanceReferenceAudio(momentAudio, refWav, refTargetSec);
        referenceAudioUri = await uploadAudioToRunway(refWav);
        durationSec = refTargetSec;
        logger.info('Seedance video_to_video: referenceAudio from moment audio.wav', {
          momentId,
          refTargetSec,
          runwayDurationSec: durationSec,
        });
      } catch (audioErr) {
        logger.debug('Seedance V2V: skipping referenceAudio', {
          momentId,
          reason: audioErr instanceof Error ? audioErr.message : String(audioErr),
        });
      }
      jobId = await submitVideoToVideo(runwayUri, feedback, config, sourcePath, {
        durationSec,
        referenceAudioUri,
      });
    } else {
      jobId = await submitVideoToVideo(runwayUri, feedback, config, sourcePath);
    }

    // 3. Poll + download
    await pollAndDownloadRevision(jobId, destPath);

    await updateStatus({ status: 'ready', videoPath: destPath });
    logger.info('Revision ready', { sessionId, momentId, revisionId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateStatus({ status: 'failed', error: msg });
    throw err;
  }
}

