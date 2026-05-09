import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import { z } from 'zod';
import { StoryboardPlan, StoryboardAnalysis, Moment, SessionConfig } from '@/lib/types';
import { retry, RetryableError } from '@/lib/utils/retry';
import logger from '@/lib/logger';

const anthropic = new AnthropicBedrock();
const MODEL = process.env.ANTHROPIC_BEDROCK_MODEL ?? 'us.anthropic.claude-sonnet-4-6';

const AnalysisSchema = z.object({
  framesToRegenerate: z.array(z.number().int().min(0).max(8)),
  updatedFrames: z.array(
    z.object({
      index: z.number().int().min(0).max(8),
      sceneDescription: z.string().min(10).max(300),
      imagePrompt: z.string().min(20).max(1200),
      motionContribution: z.string().min(10).max(300),
      style: z.string().min(5).max(200),
    })
  ),
  updatedMotionPrompt: z.string().min(20).max(500),
});

function buildAnalysisPrompt(
  storyboard: StoryboardPlan,
  feedback: string,
  moment: Moment,
  config: SessionConfig
): string {
  const style = config.styleAnchor || 'cinematic, muted tones, 4K, sharp focus';
  const framesJson = storyboard.frames.map((f) => ({
    index: f.index,
    sceneDescription: f.sceneDescription,
    imagePrompt: f.imagePrompt,
    motionContribution: f.motionContribution,
    style: f.style,
  }));

  return `You are a creative director refining a video storyboard based on user feedback.

MOMENT: "${moment.title}" (${moment.mood}, ${Math.round(moment.endSec - moment.startSec)}s)
HOOK: "${moment.hook}"
BASE STYLE: ${style}

CURRENT STORYBOARD (${storyboard.frames.length} frames):
${JSON.stringify(framesJson, null, 2)}

CURRENT MOTION PROMPT: "${storyboard.overallMotionPrompt}"

USER FEEDBACK: "${feedback}"

Your task:
1. Analyze the feedback and identify which specific frames need to change.
2. For frames that need changes, write improved imagePrompt, sceneDescription, motionContribution, and style.
3. For frames that are fine, keep them exactly as-is.
4. Update the overallMotionPrompt only if the feedback affects pacing or camera movement.
5. Only list frame indices that actually need new images in framesToRegenerate.

Return ONLY valid JSON:
{
  "framesToRegenerate": [0, 2],
  "updatedFrames": [
    {
      "index": 0,
      "sceneDescription": "...",
      "imagePrompt": "...",
      "motionContribution": "...",
      "style": "..."
    }
  ],
  "updatedMotionPrompt": "..."
}

updatedFrames must contain ALL ${storyboard.frames.length} frames (both changed and unchanged).
framesToRegenerate lists only the indices whose imagePrompt changed and need a new image generated.`;
}

/**
 * Analyzes user feedback on a storyboard and returns which frames to regenerate + updated prompts.
 */
export async function analyzeStoryboardFeedback(
  storyboard: StoryboardPlan,
  feedback: string,
  moment: Moment,
  config: SessionConfig
): Promise<StoryboardAnalysis> {
  const prompt = buildAnalysisPrompt(storyboard, feedback, moment, config);
  let extraInstruction = '';

  const analysis = await retry(
    async () => {
      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
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
        throw new RetryableError('Claude returned invalid JSON for storyboard analysis');
      }

      const validated = AnalysisSchema.safeParse(parsed);
      if (!validated.success) {
        logger.warn('Storyboard analysis schema validation failed', {
          errors: validated.error.issues,
          momentId: moment.id,
        });
        extraInstruction = '\n\nReturn ONLY valid JSON with framesToRegenerate (array of ints), updatedFrames (all frames), and updatedMotionPrompt (string).';
        throw new RetryableError('Storyboard analysis failed schema validation');
      }

      return validated.data;
    },
    { maxAttempts: 3, delayMs: 2000, backoff: 'linear' }
  );

  logger.info('Storyboard analysis complete', {
    momentId: moment.id,
    framesToRegenerate: analysis.framesToRegenerate,
  });

  return {
    framesToRegenerate: analysis.framesToRegenerate,
    updatedFrames: analysis.updatedFrames,
    updatedMotionPrompt: analysis.updatedMotionPrompt,
  };
}
