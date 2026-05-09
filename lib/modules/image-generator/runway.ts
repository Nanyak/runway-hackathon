import { SessionConfig } from '@/lib/types';
import { retry, RetryableError, PermanentError } from '@/lib/utils/retry';
import { downloadFile } from '@/lib/utils/file-utils';
import { sleep } from '@/lib/utils/retry';
import { resolveImageModel, getImageModelConfig } from '@/lib/config/models';
import logger from '@/lib/logger';

const RUNWAY_BASE_URL = 'https://api.dev.runwayml.com';
const RUNWAY_VERSION = '2024-11-06';
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 120;

function getHeaders(): Record<string, string> {
  const key = process.env.RUNWAY_API_KEY ?? process.env.RUNWAYML_API_SECRET ?? '';
  if (!key) {
    throw new PermanentError('RUNWAY_API_KEY or RUNWAYML_API_SECRET is not set');
  }
  return {
    Authorization: `Bearer ${key}`,
    'X-Runway-Version': RUNWAY_VERSION,
    'Content-Type': 'application/json',
  };
}

interface RunwayTaskResponse {
  id: string;
}

interface RunwayPollResponse {
  status: 'PENDING' | 'RUNNING' | 'THROTTLED' | 'SUCCEEDED' | 'FAILED';
  output?: string[];
  failure?: string;
  error?: string;
}

export interface ImageReference {
  /** Short identifier used as @tag in the prompt (e.g. "style" → "@style"). */
  tag: string;
  /** runway:// URI from a prior upload, or an HTTPS image URL. */
  uri: string;
}


async function submitTextToImage(
  prompt: string,
  ratio: string,
  imageModel: string,
  referenceImages?: ImageReference[],
  outputCount?: number
): Promise<string> {
  const modelCfg = getImageModelConfig(imageModel);
  const payload: Record<string, unknown> = {
    model: imageModel,
    promptText: prompt.slice(0, modelCfg.promptLimit),
    ratio,
  };
  if (modelCfg.supportsSeed) {
    payload.seed = Math.floor(Math.random() * 2_147_483_647);
  }
  if (outputCount && outputCount > 1) {
    payload.outputCount = outputCount;
  }
  if (referenceImages?.length) {
    payload.referenceImages = referenceImages.map(({ tag, uri }) => ({ tag, uri }));
  }

  const response = await fetch(`${RUNWAY_BASE_URL}/v1/text_to_image`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });

  if (response.status === 429) {
    throw new RetryableError('RunwayML rate limited (429)');
  }

  if (!response.ok) {
    const text = await response.text();
    if (response.status >= 400 && response.status < 500) {
      throw new PermanentError(`RunwayML text_to_image failed: ${response.status} ${text}`);
    }
    throw new RetryableError(`RunwayML text_to_image failed: ${response.status} ${text}`);
  }

  const data = await response.json() as RunwayTaskResponse;
  return data.id;
}

async function pollTask(jobId: string): Promise<RunwayPollResponse> {
  const response = await fetch(`${RUNWAY_BASE_URL}/v1/tasks/${jobId}`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new RetryableError(`Polling failed: ${response.status}`);
  }

  return await response.json() as RunwayPollResponse;
}

export async function textToImage(
  prompt: string,
  config: SessionConfig,
  destPath: string,
  referenceImages?: ImageReference[]
): Promise<void> {
  const imageModel = resolveImageModel(config);
  const modelCfg = getImageModelConfig(imageModel);
  const ratio = config.orientation === 'vertical' ? modelCfg.ratios.vertical : modelCfg.ratios.landscape;

  const jobId = await retry(
    () => submitTextToImage(prompt, ratio, imageModel, referenceImages),
    { maxAttempts: 3, delayMs: 5000, backoff: 'exponential' }
  );

  logger.info('Text-to-image job submitted', {
    jobId,
    ratio,
    imageModel,
    referenceCount: referenceImages?.length ?? 0,
  });

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const result = await pollTask(jobId);
    logger.debug('Polling image task', { jobId, status: result.status, attempt });

    if (result.status === 'THROTTLED') {
      logger.info('Image job throttled (queued)', { jobId, attempt });
      continue;
    }

    if (result.status === 'SUCCEEDED') {
      const outputUrl = result.output?.[0];
      if (!outputUrl) {
        throw new RetryableError('RunwayML returned SUCCEEDED but no output URL');
      }
      await downloadFile(outputUrl, destPath);
      logger.info('Image downloaded', { jobId, destPath });
      return;
    }

    if (result.status === 'FAILED') {
      throw new RetryableError(
        `RunwayML image job failed: ${result.failure ?? result.error ?? 'unknown'}`
      );
    }
  }

  throw new RetryableError(`RunwayML image job timed out after ${MAX_POLL_ATTEMPTS} attempts`);
}

/**
 * Generates multiple image variants in a single API call using outputCount.
 * Only supported by gpt_image_2. destPaths.length determines how many variants to request.
 * Each output URL is downloaded to the corresponding destPath in order.
 */
export async function textToImageMulti(
  prompt: string,
  config: SessionConfig,
  destPaths: string[],
  referenceImages?: ImageReference[]
): Promise<void> {
  const imageModel = resolveImageModel(config);
  const modelCfg = getImageModelConfig(imageModel);
  const ratio = config.orientation === 'vertical' ? modelCfg.ratios.vertical : modelCfg.ratios.landscape;
  const count = destPaths.length;

  const jobId = await retry(
    () => submitTextToImage(prompt, ratio, imageModel, referenceImages, count),
    { maxAttempts: 3, delayMs: 5000, backoff: 'exponential' }
  );

  logger.info('Text-to-image multi job submitted', { jobId, ratio, imageModel, outputCount: count });

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const result = await pollTask(jobId);
    logger.debug('Polling multi-image task', { jobId, status: result.status, attempt });

    if (result.status === 'THROTTLED') continue;

    if (result.status === 'SUCCEEDED') {
      const outputs = result.output ?? [];
      if (outputs.length === 0) {
        throw new RetryableError('RunwayML returned SUCCEEDED but no output URLs');
      }
      // Download each output to its corresponding dest path in parallel
      await Promise.all(
        destPaths.map(async (destPath, i) => {
          const url = outputs[i] ?? outputs[0]; // fallback to first if fewer outputs than expected
          await downloadFile(url, destPath);
          logger.info('Multi-image variant downloaded', { jobId, variant: i, destPath });
        })
      );
      return;
    }

    if (result.status === 'FAILED') {
      throw new RetryableError(
        `RunwayML image job failed: ${result.failure ?? result.error ?? 'unknown'}`
      );
    }
  }

  throw new RetryableError(`RunwayML image job timed out after ${MAX_POLL_ATTEMPTS} attempts`);
}
