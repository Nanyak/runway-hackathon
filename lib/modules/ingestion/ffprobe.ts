import ffmpeg from 'fluent-ffmpeg';
import { AudioMetadata } from '@/lib/types';
import logger from '@/lib/logger';

// ffprobe-static has no TS declaration — import as unknown then cast
// eslint-disable-next-line
const ffprobeStatic = require('ffprobe-static') as { path: string };
ffmpeg.setFfprobePath(ffprobeStatic.path);

export async function getAudioMetadata(filePath: string): Promise<AudioMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        logger.error('ffprobe error', { filePath, error: err.message });
        reject(err);
        return;
      }

      const duration = data.format.duration ?? 0;
      const format = data.format.format_name ?? 'unknown';
      const size = data.format.size ?? 0;

      resolve({
        duration,
        format,
        size,
        path: filePath,
      });
    });
  });
}
