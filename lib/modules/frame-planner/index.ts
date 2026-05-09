import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import { Moment, Transcript, SessionConfig, PodcastContext, FrameVariation } from '@/lib/types';
import { retry, RetryableError } from '@/lib/utils/retry';
import { buildFramePlannerPrompt } from './prompts';
import { FramePlanSchema } from './schema';
import logger from '@/lib/logger';

const anthropic = new AnthropicBedrock();
const MODEL = process.env.ANTHROPIC_BEDROCK_MODEL ?? 'us.anthropic.claude-sonnet-4-6';

function getTranscriptSegment(transcript: Transcript[], startSec: number, endSec: number): string {
  return transcript
    .filter((seg) => seg.startSec >= startSec - 2 && seg.endSec <= endSec + 2)
    .map((seg) => seg.text)
    .join(' ');
}

/**
 * Plans 3 frame variation concepts for a moment.
 * Returns FrameVariation[] without imagePaths (images generated separately).
 */
export async function planFrameVariations(
  moment: Moment,
  transcript: Transcript[],
  config: SessionConfig,
  podcastContext?: PodcastContext
): Promise<FrameVariation[]> {
  const transcriptText = getTranscriptSegment(transcript, moment.startSec, moment.endSec);
  const prompt = buildFramePlannerPrompt(moment, transcriptText, config, podcastContext);

  let extraInstruction = '';

  const rawVariations = await retry(
    async () => {
      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt + extraInstruction }],
      });

      const textContent = message.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new RetryableError('No text content in Claude response');
      }

      let jsonText = textContent.text.trim();
      jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        extraInstruction = '\n\nReturn ONLY a valid JSON array, no markdown, no explanation.';
        throw new RetryableError('Claude returned invalid JSON');
      }

      // #region agent log
      {
        const rows = Array.isArray(parsed)
          ? parsed.map((item, i) => {
            if (!item || typeof item !== 'object') {
              return { i, motionLen: null as number | null, imageLen: null as number | null, styleLen: null as number | null };
            }
            const o = item as Record<string, unknown>;
            const motion = o.motionPrompt;
            const image = o.imagePrompt;
            const style = o.style;
            return {
              i,
              motionLen: typeof motion === 'string' ? motion.length : null,
              imageLen: typeof image === 'string' ? image.length : null,
              styleLen: typeof style === 'string' ? style.length : null,
            };
          })
          : [];
        void fetch('http://127.0.0.1:7570/ingest/3a9cd1a8-33be-4b39-8bb9-96494a38aed4', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '0df394' },
          body: JSON.stringify({
            sessionId: '0df394',
            runId: 'pre-fix',
            hypothesisId: 'H1-H4',
            location: 'lib/modules/frame-planner/index.ts:afterJsonParse',
            message: 'Frame plan parsed field lengths',
            data: { momentId: moment.id, rows, extraInstructionLen: extraInstruction.length },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
      }
      // #endregion

      const validated = FramePlanSchema.safeParse(parsed);
      if (!validated.success) {
        logger.warn('Frame plan schema validation failed', {
          errors: validated.error.issues,
          momentId: moment.id,
        });
        // #region agent log
        {
          const motionIssue = validated.error.issues.find(
            (iss) => Array.isArray(iss.path) && iss.path[1] === 'motionPrompt'
          );
          void fetch('http://127.0.0.1:7570/ingest/3a9cd1a8-33be-4b39-8bb9-96494a38aed4', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '0df394' },
            body: JSON.stringify({
              sessionId: '0df394',
              runId: 'pre-fix',
              hypothesisId: 'H2-H4',
              location: 'lib/modules/frame-planner/index.ts:schemaFail',
              message: 'Frame plan Zod failure',
              data: {
                momentId: moment.id,
                issues: validated.error.issues.map((i) => ({ path: i.path, code: i.code, message: i.message })),
                motionIssuePath: motionIssue?.path ?? null,
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
        }
        // #endregion
        extraInstruction = '\n\nReturn ONLY a valid JSON array of exactly 3 objects with imagePrompt, motionPrompt, style.';
        throw new RetryableError('Frame plan failed schema validation');
      }

      return validated.data;
    },
    { maxAttempts: 3, delayMs: 2000, backoff: 'linear' }
  );

  const variations: FrameVariation[] = rawVariations.map((v, i) => ({
    index: i,
    imagePrompt: v.imagePrompt,
    motionPrompt: v.motionPrompt,
    style: v.style,
  }));

  logger.info('Frame variations planned', { momentId: moment.id, count: variations.length });
  return variations;
}
