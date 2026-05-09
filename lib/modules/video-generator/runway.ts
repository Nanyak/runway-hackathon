import fs from 'fs';
import RunwayML from '@runwayml/sdk';
import { FrameVariation, SessionConfig } from '@/lib/types';
import { retry, RetryableError, PermanentError, sleep } from '@/lib/utils/retry';
import { downloadFile } from '@/lib/utils/file-utils';
import logger from '@/lib/logger';

const RUNWAY_BASE_URL = 'https://api.dev.runwayml.com';
const RUNWAY_VERSION = '2024-11-06';

let runwaySdk: RunwayML | null = null;

/** Shared Runway SDK client (uploads, image/video/text tasks, revisions). */
export function getRunwaySdk(): RunwayML {
  if (!runwaySdk) {
    const apiKey = process.env.RUNWAY_API_KEY ?? process.env.RUNWAYML_API_SECRET ?? '';
    if (!apiKey) {
      throw new PermanentError('RUNWAY_API_KEY or RUNWAYML_API_SECRET is not set');
    }
    runwaySdk = new RunwayML({ apiKey, runwayVersion: RUNWAY_VERSION });
  }
  return runwaySdk;
}

export function mapRunwaySdkError(err: unknown, endpointLabel: string): never {
  if (err instanceof RunwayML.RateLimitError) {
    throw new RetryableError('Rate limited (429)');
  }
  if (err instanceof RunwayML.APIError) {
    const st = err.status;
    if (st === 401 || st === 403) {
      throw new PermanentError(`Auth error: ${st}`);
    }
    if (st !== undefined && st >= 500) {
      throw new RetryableError(`${endpointLabel} failed: ${st} ${err.message}`);
    }
    throw new RetryableError(`${endpointLabel} failed: ${st ?? 'unknown'} ${err.message}`);
  }
  throw err;
}

const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 60;

function getHeaders(): Record<string, string> {
  const key = process.env.RUNWAY_API_KEY ?? process.env.RUNWAYML_API_SECRET ?? '';
  return {
    Authorization: `Bearer ${key}`,
    'X-Runway-Version': RUNWAY_VERSION,
    'Content-Type': 'application/json',
  };
}

interface RunwayPollResponse {
  status: 'PENDING' | 'RUNNING' | 'THROTTLED' | 'SUCCEEDED' | 'FAILED';
  output?: string[];
  failure?: string;
}

interface RunwayUploadSlotResponse {
  uploadUrl: string;
  fields: Record<string, string>;
  runwayUri: string;
}

const SEEDANCE_DURATION_MIN = 5;
const SEEDANCE_DURATION_MAX = 15;
const LEGACY_TTV_DURATION_MAX = 10;

/** Seedance 2 image/text-to-video duration bounds (see Runway Seedance guide). */
export function clampDurationForSeedance(durationSec: number): number {
  return Math.min(
    SEEDANCE_DURATION_MAX,
    Math.max(SEEDANCE_DURATION_MIN, Math.round(durationSec))
  );
}

function clampDurationForTextToVideoModel(model: string, durationSec: number): number {
  if (model === 'seedance2') {
    return clampDurationForSeedance(durationSec);
  }
  return Math.min(LEGACY_TTV_DURATION_MAX, Math.max(5, Math.round(durationSec)));
}

async function createUploadSlot(filename: string): Promise<RunwayUploadSlotResponse> {
  return retry(
    async () => {
      const res = await fetch(`${RUNWAY_BASE_URL}/v1/uploads`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ filename, type: 'ephemeral' }),
      });
      if (res.status === 401 || res.status === 403) throw new PermanentError(`Auth error: ${res.status}`);
      if (!res.ok) throw new RetryableError(`Upload slot failed: ${res.status} ${await res.text()}`);
      return res.json() as Promise<RunwayUploadSlotResponse>;
    },
    { maxAttempts: 3, delayMs: 2000, backoff: 'exponential' }
  );
}

async function postToPresignedSlot(
  slot: RunwayUploadSlotResponse,
  fileBuffer: Buffer,
  filename: string,
  blobMime: string
): Promise<void> {
  const form = new FormData();
  for (const [k, v] of Object.entries(slot.fields)) form.append(k, v);
  form.append('file', new Blob([new Uint8Array(fileBuffer)], { type: blobMime }), filename);
  const uploadRes = await fetch(slot.uploadUrl, { method: 'POST', body: form });
  if (!uploadRes.ok) throw new RetryableError(`Presigned upload failed: ${uploadRes.status}`);
}

/**
 * Upload a local PNG to Runway ephemeral storage → runway:// URI.
 */
export async function uploadImageToRunway(imagePath: string): Promise<string> {
  const filename = imagePath.split('/').pop() ?? 'image.png';
  const slot = await createUploadSlot(filename);
  const fileBuffer = fs.readFileSync(imagePath);
  await postToPresignedSlot(slot, fileBuffer, filename, 'image/png');
  logger.info('Image uploaded to Runway', { uri: slot.runwayUri.slice(0, 30) });
  return slot.runwayUri;
}

/**
 * Upload a local audio file (e.g. WAV) for Seedance referenceAudio.
 */
export async function uploadAudioToRunway(audioPath: string): Promise<string> {
  const filename = audioPath.split('/').pop() ?? 'audio.wav';
  const slot = await createUploadSlot(filename);
  const fileBuffer = fs.readFileSync(audioPath);
  const mime = filename.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
  await postToPresignedSlot(slot, fileBuffer, filename, mime);
  logger.info('Audio uploaded to Runway', { uri: slot.runwayUri.slice(0, 30) });
  return slot.runwayUri;
}

export interface ImageToVideoOptions {
  /** runway:// URI from uploadAudioToRunway; combined ref length must be ≤15s (API limit). */
  referenceAudioUri?: string;
}

/**
 * Submit image_to_video with Seedance 2: first-frame keyframe, 5–15s duration,
 * optional referenceAudio (moment clip) for audio-synced motion.
 */
export async function submitImageToVideo(
  runwayUri: string,
  variation: FrameVariation,
  config: SessionConfig,
  durationSec: number,
  options: ImageToVideoOptions = {}
): Promise<string> {
  const ratio = config.orientation === 'vertical' ? '720:1280' : '1280:720';
  const duration = clampDurationForSeedance(durationSec);

  const body: Record<string, unknown> = {
    model: 'seedance2',
    promptImage: [{ uri: runwayUri, position: 'first' }],
    promptText: variation.motionPrompt,
    duration,
    ratio,
  };

  if (options.referenceAudioUri) {
    body.referenceAudio = [{ type: 'audio', uri: options.referenceAudioUri }];
  }

  // Official SDK posts the same JSON as curl/docs; `seedance2` + `referenceAudio` are not in the OpenAPI union yet.
  const response = await retry(
    async () => {
      try {
        const created = await getRunwaySdk().imageToVideo.create(
          body as unknown as RunwayML.ImageToVideoCreateParams
        );
        const { id } = await created;
        return { id };
      } catch (err) {
        mapRunwaySdkError(err, 'image_to_video');
      }
    },
    { maxAttempts: 3, delayMs: 5000, backoff: 'exponential' }
  );

  logger.info('image_to_video job submitted', {
    jobId: response.id,
    duration,
    withAudioRef: Boolean(options.referenceAudioUri),
  });
  return response.id;
}

export interface TextToVideoOptions {
  /** Up to 9 reference images (HTTPS or runway://). Seedance T2V only. */
  referenceImageUris?: string[];
  /**
   * Up to 3 reference clips (HTTPS or runway://), combined duration max 15s per API.
   * Seedance T2V only — same shape as curl `referenceVideos`.
   */
  referenceVideoUris?: string[];
  /**
   * Up to 3 audio refs (HTTPS or runway://); each 2–15s, combined max 15s.
   * Seedance T2V only — requires at least one image or video reference (API).
   */
  referenceAudioUris?: string[];
}

/**
 * Submit text_to_video (fallback path). For `seedance2`, optional `references` match the SDK / curl shape.
 */
export async function submitTextToVideo(
  variation: FrameVariation,
  config: SessionConfig,
  durationSec: number,
  options: TextToVideoOptions = {}
): Promise<string> {
  const ratio = config.orientation === 'vertical' ? '720:1280' : '1280:720';
  const duration = clampDurationForTextToVideoModel(config.videoModel, durationSec);
  const promptText = `${variation.imagePrompt}. ${variation.motionPrompt}. Style: ${variation.style}`.trim();

  const body: Record<string, unknown> = {
    model: config.videoModel,
    promptText,
    duration,
    ratio,
  };

  if (config.videoModel === 'seedance2' && options.referenceImageUris?.length) {
    body.references = options.referenceImageUris.slice(0, 9).map((uri) => ({ uri }));
  }

  if (config.videoModel === 'seedance2' && options.referenceVideoUris?.length) {
    body.referenceVideos = options.referenceVideoUris
      .slice(0, 3)
      .map((uri) => ({ type: 'video' as const, uri }));
  }

  const hasVisualReference =
    (options.referenceImageUris?.length ?? 0) > 0 || (options.referenceVideoUris?.length ?? 0) > 0;
  if (
    config.videoModel === 'seedance2' &&
    options.referenceAudioUris?.length &&
    hasVisualReference
  ) {
    body.referenceAudio = options.referenceAudioUris
      .slice(0, 3)
      .map((uri) => ({ type: 'audio' as const, uri }));
  }

  const response = await retry(
    async () => {
      try {
        const created = await getRunwaySdk().textToVideo.create(
          body as unknown as RunwayML.TextToVideoCreateParams
        );
        const { id } = await created;
        return { id };
      } catch (err) {
        mapRunwaySdkError(err, 'text_to_video');
      }
    },
    { maxAttempts: 3, delayMs: 5000, backoff: 'exponential' }
  );

  logger.info('text_to_video job submitted (fallback)', {
    jobId: response.id,
    model: config.videoModel,
    referenceImages: options.referenceImageUris?.length ?? 0,
    referenceVideos: options.referenceVideoUris?.length ?? 0,
    referenceAudio: body.referenceAudio ? (body.referenceAudio as unknown[]).length : 0,
  });
  return response.id;
}

export async function pollAndDownload(jobId: string, destPath: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const res = await fetch(`${RUNWAY_BASE_URL}/v1/tasks/${jobId}`, { headers: getHeaders() });
    if (!res.ok) throw new RetryableError(`Polling failed: ${res.status}`);

    const result = await res.json() as RunwayPollResponse;

    if (result.status === 'THROTTLED') {
      logger.info('Job throttled (queued)', { jobId, attempt });
      continue;
    }

    logger.debug('Polling video task', { jobId, status: result.status, attempt });

    if (result.status === 'SUCCEEDED') {
      const url = result.output?.[0];
      if (!url) throw new RetryableError('SUCCEEDED but no output URL');
      await downloadFile(url, destPath);
      logger.info('Video downloaded', { jobId, destPath });
      return;
    }

    if (result.status === 'FAILED') {
      throw new RetryableError(`Video job failed: ${result.failure ?? 'unknown'}`);
    }
  }

  throw new RetryableError(`Video job timed out after ${MAX_POLL_ATTEMPTS} attempts`);
}
