import path from 'path';
import fs from 'fs/promises';
import ffmpeg from 'fluent-ffmpeg';
// eslint-disable-next-line
const ffmpegStatic = require('ffmpeg-static') as string;
import { AudioMetadata } from '@/lib/types';
import { PermanentError } from '@/lib/utils/retry';
import { ensureDir } from '@/lib/utils/file-utils';
import { getAudioMetadata } from './ffprobe';
import logger from '@/lib/logger';

ffmpeg.setFfmpegPath(ffmpegStatic);

const MAX_DURATION_SECONDS = 180 * 60; // 180 minutes
const MAX_CHUNK_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const CHUNK_OVERLAP_SECONDS = 2;

const VALID_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.mp4'];

export async function validateAudio(filePath: string): Promise<AudioMetadata> {
  // Check file exists
  try {
    await fs.access(filePath);
  } catch {
    throw new PermanentError(`Audio file not found: ${filePath}`);
  }

  // Check extension
  const ext = path.extname(filePath).toLowerCase();
  if (!VALID_AUDIO_EXTENSIONS.includes(ext)) {
    throw new PermanentError(`Unsupported audio format: ${ext}`);
  }

  const metadata = await getAudioMetadata(filePath);

  if (metadata.duration > MAX_DURATION_SECONDS) {
    throw new PermanentError(
      `Audio too long: ${Math.round(metadata.duration / 60)} min (max 180 min)`
    );
  }

  logger.info('Audio validated', {
    duration: metadata.duration,
    format: metadata.format,
    size: metadata.size,
  });

  return metadata;
}

export interface AudioChunk {
  path: string;
  offsetSec: number;
}

export async function rechunkAudio(filePath: string, outDir: string): Promise<AudioChunk[]> {
  await ensureDir(outDir);
  const metadata = await getAudioMetadata(filePath);

  // At 16kHz mono WAV: ~32 KB/s, so 20 MB ≈ 625 seconds
  const targetChunkDuration = 600; // 10 minutes per chunk (safe margin)
  const totalDuration = metadata.duration;
  const chunks: AudioChunk[] = [];

  let startSec = 0;
  let chunkIndex = 0;

  while (startSec < totalDuration) {
    const duration = Math.min(targetChunkDuration, totalDuration - startSec);
    const outPath = path.join(outDir, `chunk_${chunkIndex.toString().padStart(3, '0')}.wav`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(filePath)
        .setStartTime(startSec)
        .setDuration(duration)
        .audioChannels(1)
        .audioFrequency(16000)
        .audioCodec('pcm_s16le')
        .format('wav')
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    chunks.push({ path: outPath, offsetSec: startSec });
    logger.debug('Audio chunk created', { chunkIndex, startSec, duration, outPath });

    chunkIndex++;
    const advance = duration - CHUNK_OVERLAP_SECONDS;
    if (advance <= 0) break;
    startSec += advance;

    if (startSec >= totalDuration) break;
  }

  logger.info('Audio rechunked', { totalChunks: chunks.length, filePath });
  return chunks;

  // Suppress unused var warning — MAX_CHUNK_SIZE_BYTES used for documentation
  void MAX_CHUNK_SIZE_BYTES;
}
