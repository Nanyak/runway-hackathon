import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import { Moment, Transcript, SessionConfig, PodcastContext, StoryboardPlan } from '@/lib/types';
import { retry, RetryableError, sleep } from '@/lib/utils/retry';
import { buildStoryboardPlannerPrompt } from './prompts';
import { StoryboardPlanSchema } from './schema';
import { getVideoModelConfig } from '@/lib/config/models';
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
 *
 * onThinking is called with live status messages so the UI can show AI progress.
 */
export async function planStoryboard(
  moment: Moment,
  transcript: Transcript[],
  config: SessionConfig,
  podcastContext?: PodcastContext,
  styleAnchor?: string,
  onThinking?: (msg: string) => void,
  onChunk?: (chunk: string, done: boolean) => void
): Promise<StoryboardPlan> {
  const transcriptText = getTranscriptSegment(transcript, moment.startSec, moment.endSec);
  const prompt = buildStoryboardPlannerPrompt(moment, transcriptText, config, podcastContext, styleAnchor);

  let extraInstruction = '';
  let attempt = 0;

  onThinking?.('Analyzing transcript and building storyboard brief…');

  const plan = await retry(
    async () => {
      attempt++;
      if (attempt > 1) {
        onThinking?.(`Retrying storyboard plan (attempt ${attempt})…`);
      } else {
        onThinking?.('Sending storyboard brief to Claude…');
      }

      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt + extraInstruction }],
      });

      // Stream text chunks in batches of ~60 chars so the UI feels responsive
      let chunkBuf = '';
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          chunkBuf += event.delta.text;
          if (chunkBuf.length >= 60) {
            onChunk?.(chunkBuf, false);
            chunkBuf = '';
          }
        }
      }
      if (chunkBuf) onChunk?.(chunkBuf, false);
      onChunk?.('', true);

      onThinking?.('Claude responded — parsing frame plan…');

      const message = await stream.finalMessage();
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

      // Truncate overallMotionPrompt to the video model's prompt limit before validation
      const promptLimit = getVideoModelConfig(config.videoModel).promptLimit;
      if (parsed && typeof (parsed as Record<string, unknown>).overallMotionPrompt === 'string') {
        (parsed as Record<string, unknown>).overallMotionPrompt = (
          (parsed as Record<string, unknown>).overallMotionPrompt as string
        ).slice(0, promptLimit);
      }

      onThinking?.('Validating storyboard schema…');

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

  // Reveal each frame as a human-readable message with a small stagger
  for (const frame of plan.frames) {
    const shotMatch = frame.sceneDescription.match(/^\[([^\]]+)\]/);
    const shotLabel = shotMatch ? shotMatch[1] : `Frame ${frame.index + 1}`;
    const desc = frame.sceneDescription.replace(/^\[[^\]]+\]\s*/, '');
    const truncated = desc.length > 120 ? desc.slice(0, 120) + '…' : desc;
    onThinking?.(`${shotLabel} — ${truncated}`);
    await sleep(120);
  }
  onThinking?.(`${plan.frames.length} frames planned ✓`);

  logger.info('Storyboard planned', { momentId: moment.id, frameCount: plan.frames.length });
  return plan;
}
