import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import { z } from 'zod';
import { Transcript, PodcastContext } from '@/lib/types';
import { retry, RetryableError } from '@/lib/utils/retry';
import logger from '@/lib/logger';

const anthropic = new AnthropicBedrock();
const MODEL = process.env.ANTHROPIC_BEDROCK_MODEL ?? 'us.anthropic.claude-sonnet-4-6';

const PodcastContextSchema = z.object({
  topic: z.string().min(1).max(300),
  genre: z.string().min(1).max(100),
  speakers: z.array(z.string()),
  summary: z.string().min(1).max(600),
});

function buildPrompt(transcriptText: string): string {
  return `You are analyzing a podcast transcript. Extract high-level context that will help a visual director create relevant, on-topic background imagery for short clips from this episode.

TRANSCRIPT (first ~3000 chars):
${transcriptText.substring(0, 3000)}

Return a JSON object with:
- topic: One sentence describing what this podcast episode is specifically about (be concrete, not generic — e.g. "The challenges of scaling a startup from 10 to 100 employees" not just "business")
- genre: The podcast genre/category (e.g. "tech startup", "personal finance", "health & fitness", "comedy", "true crime", "philosophy", "science", "self-help", "sports")
- speakers: Array of speaker names if clearly identifiable from the transcript (e.g. ["Lex Fridman", "Elon Musk"]), or [] if unclear
- summary: 2-3 sentences describing the key themes, arguments, or stories covered in this episode

Return ONLY valid JSON, no markdown:
{"topic":"...","genre":"...","speakers":[],"summary":"..."}`;
}

export async function extractPodcastContext(transcript: Transcript[]): Promise<PodcastContext> {
  // Build a readable transcript from segments — use first ~4 minutes worth (enough for context)
  const transcriptText = transcript
    .filter((seg) => seg.startSec <= 240)
    .map((seg) => `[${seg.startSec.toFixed(0)}s] ${seg.text}`)
    .join('\n');

  let extraInstruction = '';

  const result = await retry(
    async () => {
      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 512,
        messages: [{ role: 'user', content: buildPrompt(transcriptText) + extraInstruction }],
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
        throw new RetryableError('Claude returned invalid JSON for podcast context');
      }

      const validated = PodcastContextSchema.safeParse(parsed);
      if (!validated.success) {
        extraInstruction = '\n\nReturn ONLY valid JSON, no markdown, no explanation.';
        throw new RetryableError('Podcast context failed schema validation');
      }

      return validated.data;
    },
    { maxAttempts: 3, delayMs: 2000, backoff: 'linear' }
  );

  logger.info('Podcast context extracted', { topic: result.topic, genre: result.genre, speakers: result.speakers });
  return result;
}
