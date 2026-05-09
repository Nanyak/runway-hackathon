import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
// eslint-disable-next-line
const ffmpegStatic = require('ffmpeg-static') as string;
import { ensureDir } from '@/lib/utils/file-utils';
import logger from '@/lib/logger';

ffmpeg.setFfmpegPath(ffmpegStatic);

export async function assembleMoment(
  composedVideoPath: string,
  audioFilePath: string,
  outputPath: string
): Promise<void> {
  await ensureDir(path.dirname(outputPath));

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(composedVideoPath)
      .input(audioFilePath)
      .outputOptions([
        '-map 0:v',
        '-map 1:a',
        '-c:v libx264',
        '-preset slow',
        '-crf 18',
        '-c:a aac',
        '-b:a 192k',
        '-movflags +faststart',
        '-shortest',
      ])
      .output(outputPath)
      .on('start', (cmd) => logger.debug('FFmpeg assemble started', { cmd }))
      .on('end', () => {
        logger.info('Moment assembled', { outputPath });
        resolve();
      })
      .on('error', (err) => {
        logger.error('Assembly failed', { error: err.message, composedVideoPath, audioFilePath });
        reject(err);
      })
      .run();
  });
}
