import { createReadStream } from 'fs';
import OpenAI from 'openai';
import { Transcript, TranscriptWord } from '@/lib/types';
import logger from '@/lib/logger';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  words?: WhisperWord[];
}

interface WhisperVerboseResponse {
  segments?: WhisperSegment[];
  words?: WhisperWord[];
}

export async function transcribeChunk(chunkPath: string): Promise<Transcript[]> {
  logger.debug('Transcribing chunk', { chunkPath });

  const response = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: createReadStream(chunkPath),
    response_format: 'verbose_json',
    timestamp_granularities: ['word', 'segment'],
  });

  const verboseResponse = response as unknown as WhisperVerboseResponse;
  const segments = verboseResponse.segments ?? [];
  // Whisper returns words at the top level, not nested inside segments
  const allWords: TranscriptWord[] = (verboseResponse.words ?? []).map((w) => ({
    word: w.word,
    startSec: w.start,
    endSec: w.end,
  }));

  const transcripts: Transcript[] = segments.map((seg) => {
    // Assign top-level words to this segment by time range
    const segWords = seg.words
      ? seg.words.map((w) => ({ word: w.word, startSec: w.start, endSec: w.end }))
      : allWords.filter((w) => w.startSec >= seg.start && w.endSec <= seg.end + 0.1);

    return {
      startSec: seg.start,
      endSec: seg.end,
      text: seg.text.trim(),
      words: segWords,
    };
  });

  logger.debug('Chunk transcribed', { segments: transcripts.length, chunkPath });
  return transcripts;
}
