import pLimit from 'p-limit';
import { Transcript } from '@/lib/types';
import { AudioChunk } from '@/lib/modules/ingestion';
import { transcribeChunk } from './whisper';
import logger from '@/lib/logger';

const OVERLAP_SECONDS = 2;

export async function transcribeAll(
  chunks: AudioChunk[],
  onProgress: (pct: number) => void
): Promise<Transcript[]> {
  const limit = pLimit(3);
  let completed = 0;

  const results = await Promise.all(
    chunks.map(({ path: chunkPath, offsetSec }) =>
      limit(async () => {
        const transcripts = await transcribeChunk(chunkPath);
        // Shift all timestamps to absolute positions in the original audio
        const shifted = transcripts.map((t) => ({
          ...t,
          startSec: t.startSec + offsetSec,
          endSec: t.endSec + offsetSec,
          words: t.words.map((w) => ({
            ...w,
            startSec: w.startSec + offsetSec,
            endSec: w.endSec + offsetSec,
          })),
        }));
        completed++;
        onProgress(Math.round((completed / chunks.length) * 100));
        logger.debug('Chunk transcription complete', { chunkPath, offsetSec, completed, total: chunks.length });
        return shifted;
      })
    )
  );

  return results.flat();
}

export function stitchTranscripts(transcripts: Transcript[]): Transcript[] {
  if (transcripts.length === 0) return [];

  const result: Transcript[] = [];

  for (let i = 0; i < transcripts.length; i++) {
    const current = transcripts[i];
    const next = transcripts[i + 1];

    if (!next) {
      result.push(current);
      continue;
    }

    // Find the boundary: remove words from current that overlap with next chunk's first OVERLAP_SECONDS
    const nextStart = next.startSec;
    const overlapBoundary = nextStart + OVERLAP_SECONDS;

    // Filter words from current that appear in the overlap zone (if they also appear in next)
    const nextFirstWords = new Set(
      next.words.filter((w) => w.startSec < overlapBoundary).map((w) => w.word.toLowerCase())
    );

    const filteredWords = current.words.filter((w) => {
      if (w.startSec < nextStart - OVERLAP_SECONDS) return true;
      // In the overlap zone — skip if this word appears in next chunk's beginning
      return !nextFirstWords.has(w.word.toLowerCase());
    });

    result.push({
      ...current,
      words: filteredWords,
      // Preserve original Whisper text; only reconstruct from words when they cover the segment
      text: filteredWords.length > 0 ? filteredWords.map((w) => w.word).join(' ') : current.text,
    });
  }

  return result;
}
