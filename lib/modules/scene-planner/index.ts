import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import { v4 as uuidv4 } from 'uuid';
import { Moment, Scene, Transcript, SessionConfig, PodcastContext } from '@/lib/types';
import { retry, RetryableError } from '@/lib/utils/retry';
import { buildScenePlannerPrompt } from './prompts';
import { ScenePlanArraySchema } from './schema';
import logger from '@/lib/logger';

const anthropic = new AnthropicBedrock();
const MODEL = process.env.ANTHROPIC_BEDROCK_MODEL ?? 'us.anthropic.claude-sonnet-4-6';

function getTranscriptSegment(transcript: Transcript[], startSec: number, endSec: number): string {
  return transcript
    .filter((seg) => seg.startSec >= startSec - 2 && seg.endSec <= endSec + 2)
    .map((seg) => seg.text)
    .join(' ');
}

export async function planScenesForMoment(
  moment: Moment,
  transcript: Transcript[],
  config: SessionConfig,
  podcastContext?: PodcastContext
): Promise<Scene[]> {
  const transcriptText = getTranscriptSegment(transcript, moment.startSec, moment.endSec);
  const prompt = buildScenePlannerPrompt(moment, transcriptText, config, podcastContext);

  let extraInstruction = '';

  const rawScenes = await retry(
    async () => {
      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
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
      jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        extraInstruction = '\n\nReturn ONLY valid JSON, no markdown, no explanation.';
        throw new RetryableError('Claude returned invalid JSON for scene plan');
      }

      const validated = ScenePlanArraySchema.safeParse(parsed);
      if (!validated.success) {
        logger.warn('Scene schema validation failed', { errors: validated.error.issues, momentId: moment.id });
        extraInstruction = '\n\nReturn ONLY valid JSON, no markdown, no explanation.';
        throw new RetryableError('Scene plan failed schema validation');
      }

      return validated.data;
    },
    { maxAttempts: 3, delayMs: 2000, backoff: 'linear' }
  );

  const scenes: Scene[] = rawScenes.map((s, i) => ({
    id: uuidv4(),
    momentId: moment.id,
    indexInMoment: i,
    startSec: s.startSec,
    endSec: s.endSec,
    captionText: s.captionText,
    imagePrompt: s.imagePrompt,
    videoMotionPrompt: s.videoMotionPrompt,
    brollType: s.brollType,
    transitionType: s.transitionType,
  }));

  logger.info('Scenes planned', { momentId: moment.id, sceneCount: scenes.length });
  return scenes;
}
