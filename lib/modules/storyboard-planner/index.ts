import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import { Moment, Transcript, SessionConfig, PodcastContext, StoryboardPlan } from '@/lib/types';
import { retry, RetryableError } from '@/lib/utils/retry';
import { buildStoryboardPlannerPrompt } from './prompts';
import { StoryboardPlanSchema } from './schema';
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
 * Plans a highly detailed sequential visual storyboard (4–16 frames) for a moment.
 * Claude decides the frame count based on narrative richness — no fixed count is imposed.
 * All frame descriptions are rendered into a single storyboard sheet image used by Seedance2.
 */
export async function planStoryboard(
  moment: Moment,
  transcript: Transcript[],
  config: SessionConfig,
  podcastContext?: PodcastContext,
  styleAnchor?: string
): Promise<StoryboardPlan> {
  const transcriptText = getTranscriptSegment(transcript, moment.startSec, moment.endSec);
  const prompt = buildStoryboardPlannerPrompt(moment, transcriptText, config, podcastContext, styleAnchor);

  let extraInstruction = '';

  const plan = await retry(
    async () => {
      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8192,
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
        extraInstruction = '\n\nReturn ONLY valid JSON, no markdown, no explanation.';
        throw new RetryableError('Claude returned invalid JSON for storyboard plan');
      }

      const validated = StoryboardPlanSchema.safeParse(parsed);
      if (!validated.success) {
        logger.warn('Storyboard schema validation failed', {
          errors: validated.error.issues,
          momentId: moment.id,
        });
        extraInstruction = '\n\nReturn ONLY valid JSON. frames must be an array of 4–16 objects each with index (0-based integer), sceneDescription (string), imagePrompt (string, max 900 chars), motionContribution (string), style (string). Include overallMotionPrompt string (max 800 chars).';
        throw new RetryableError('Storyboard plan failed schema validation');
      }

      // Ensure frame indices are sequential starting at 0
      const frames = validated.data.frames.map((f, i) => ({ ...f, index: i }));
      return { frames, overallMotionPrompt: validated.data.overallMotionPrompt };
    },
    { maxAttempts: 3, delayMs: 2000, backoff: 'linear' }
  );

  logger.info('Storyboard planned', { momentId: moment.id, frameCount: plan.frames.length });
  return plan;
}
