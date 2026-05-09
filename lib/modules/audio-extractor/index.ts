import ffmpeg from 'fluent-ffmpeg';
// eslint-disable-next-line
const ffmpegStatic = require('ffmpeg-static') as string;
import { Moment } from '@/lib/types';
import { ensureDir } from '@/lib/utils/file-utils';
import path from 'path';
import logger from '@/lib/logger';

ffmpeg.setFfmpegPath(ffmpegStatic);

export async function extractMomentAudio(
  srcPath: string,
  moment: Moment,
  outPath: string
): Promise<void> {
  await ensureDir(path.dirname(outPath));

  const duration = moment.endSec - moment.startSec;

  return new Promise((resolve, reject) => {
    ffmpeg(srcPath)
      .setStartTime(moment.startSec)
      .setDuration(duration)
      .audioFilters('loudnorm=I=-14')
      .audioFrequency(48000)
      .audioChannels(2)
      .format('wav')
      .output(outPath)
      .on('end', () => {
        logger.debug('Moment audio extracted', { momentId: moment.id, outPath });
        resolve();
      })
      .on('error', (err) => {
        logger.error('Audio extraction failed', { momentId: moment.id, error: err.message });
        reject(err);
      })
      .run();
  });
}
