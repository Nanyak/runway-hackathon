import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import { v4 as uuidv4 } from 'uuid';
import { Moment, Transcript, SessionConfig, PodcastContext } from '@/lib/types';
import { retry, RetryableError } from '@/lib/utils/retry';
import { buildViralDetectionPrompt } from './prompts';
import { MomentDetectionArraySchema } from './schema';
import { deduplicateMoments } from './deduplicator';
import logger from '@/lib/logger';

const anthropic = new AnthropicBedrock();
const MODEL = process.env.ANTHROPIC_BEDROCK_MODEL ?? 'us.anthropic.claude-sonnet-4-6';

function formatTranscriptText(transcript: Transcript[]): string {
  return transcript
    .map((seg) => `[${seg.startSec.toFixed(1)}s-${seg.endSec.toFixed(1)}s] ${seg.text}`)
    .join('\n');
}

export async function detectMoments(
  transcript: Transcript[],
  config: SessionConfig,
  onMomentDetected: (moment: Moment) => void,
  podcastContext?: PodcastContext
): Promise<Moment[]> {
  const transcriptText = formatTranscriptText(transcript);
  const prompt = buildViralDetectionPrompt(transcriptText, config.maxMoments, podcastContext);

  let extraInstruction = '';

  const rawMoments = await retry(
    async () => {
      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt + extraInstruction,
          },
        ],
      });

      const textContent = message.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new RetryableError('No text content in Claude response');
      }

      let jsonText = textContent.text.trim();
      // Strip markdown code blocks if present
      jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        extraInstruction = '\n\nReturn ONLY valid JSON, no markdown, no explanation.';
        throw new RetryableError('Claude returned invalid JSON');
      }

      // Sanitize: trim moments that exceed Seedance2's 15s max, discard those under 5s.
      const TARGET_DURATION = 15;
      const MIN_DURATION = 5;
      const sanitized = Array.isArray(parsed)
        ? (parsed as unknown[]).flatMap((m) => {
            if (typeof m !== 'object' || m === null) return [];
            const obj = m as Record<string, unknown>;
            const start = typeof obj.startSec === 'number' ? obj.startSec : null;
            const end = typeof obj.endSec === 'number' ? obj.endSec : null;
            if (start === null || end === null) return [m];
            const dur = end - start;
            if (dur > TARGET_DURATION) {
              // Round to 2 decimal places to avoid float imprecision (e.g. start + 15 = 15.000000000000002)
              const trimmedEnd = Math.round((start + TARGET_DURATION) * 100) / 100;
              logger.warn('Trimming moment to target duration', { original: dur, target: TARGET_DURATION });
              return [{ ...obj, endSec: trimmedEnd }];
            }
            if (dur < MIN_DURATION) {
              logger.warn('Discarding moment shorter than minimum', { dur });
              return [];
            }
            return [m];
          })
        : parsed;

      const validated = MomentDetectionArraySchema.safeParse(sanitized);
      if (!validated.success) {
        logger.warn('Moment schema validation failed after sanitization', { errors: validated.error.issues });
        extraInstruction = '\n\nReturn ONLY valid JSON, no markdown, no explanation.';
        throw new RetryableError('Claude response failed schema validation');
      }

      return validated.data;
    },
    { maxAttempts: 3, delayMs: 2000, backoff: 'linear' }
  );

  // Assign IDs and deduplicate
  const momentsWithIds: Moment[] = rawMoments.map((m) => ({
    ...m,
    id: uuidv4(),
  }));

  const deduplicated = deduplicateMoments(momentsWithIds);

  logger.info('Viral moments detected', { total: rawMoments.length, deduplicated: deduplicated.length });

  // Emit events
  for (const moment of deduplicated) {
    onMomentDetected(moment);
  }

  return deduplicated;
}
