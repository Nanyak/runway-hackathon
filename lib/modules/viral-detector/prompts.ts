import { PodcastContext } from '@/lib/types';

export function buildViralDetectionPrompt(
  transcript: string,
  maxMoments: number,
  context?: PodcastContext
): string {
  const contextBlock = context
    ? `
PODCAST CONTEXT:
- Topic: ${context.topic}
- Genre: ${context.genre}
- Speakers: ${context.speakers.length > 0 ? context.speakers.join(', ') : 'Unknown'}
- Episode summary: ${context.summary}

Use this context to judge what will resonate with the audience of THIS specific podcast.
`
    : '';

  return `You are a viral content strategist specializing in short-form video (TikTok, Instagram Reels, YouTube Shorts).

Analyze the following podcast transcript and identify up to ${maxMoments} viral-worthy moments.
${contextBlock}
SELECTION CRITERIA:
- Emotional intensity: Does it evoke strong emotion (inspiration, humor, surprise, empathy)?
- Standalone clarity: Does it make sense without context?
- Quotability: Is it memorable and shareable?
- Hook potential: Does it have a strong opening hook that stops scrolling?
- Each moment should be 5–15 seconds long — Seedance2 supports up to 15s and longer clips can tell a fuller story
- Prefer natural sentence boundaries: a 8–12s clip with clean start/end beats a perfect 10s clip that cuts mid-thought
- If a moment's natural end falls at 14–15s, include it fully rather than trimming to 10s
- Moments must NOT overlap each other
- Moments must NOT start or end mid-sentence
- Moments should have a clear beginning and end
- Do NOT extend a moment past its natural end just to fill time

SCORING (0-100):
- 90-100: Extremely viral, will definitely perform
- 70-89: High potential, strong hook
- 50-69: Moderate potential, good content
- Below 50: Skip

TRANSCRIPT:
${transcript}

Return a JSON array of moment objects. Each object must have:
- title: string (5-10 word descriptive title)
- startSec: number (start time in seconds, aligned to sentence boundary)
- endSec: number (end time in seconds, aligned to sentence boundary, ideally startSec + 8 to 15)
- viralScore: number (0-100)
- reason: string (2-3 sentences explaining viral potential)
- hook: string (compelling first line for the video, max 100 chars)
- mood: "inspiring" | "funny" | "educational" | "controversial" | "emotional"
- clipType: "one-liner" | "story-arc" | "insight" | "reaction"
- suggestedStyle: string (3-5 comma-separated visual style descriptors matching the mood — lighting, color palette, atmosphere, framing. Max 150 chars. Examples by mood:
  - inspiring → "cinematic, golden hour lighting, wide angle, epic scale, warm tones"
  - funny → "bright, high saturation, sharp focus, comedic close-up framing"
  - emotional → "warm tones, shallow depth of field, soft film grain, intimate framing"
  - educational → "clean, neutral tones, documentary style, sharp detail, soft daylight"
  - controversial → "high contrast, dramatic shadows, desaturated, tense tight framing")

Return ONLY a valid JSON array, no markdown, no explanation. Example:
[{"title":"...","startSec":45.2,"endSec":54.1,"viralScore":87,"reason":"...","hook":"...","mood":"inspiring","clipType":"insight","suggestedStyle":"cinematic, golden hour lighting, wide angle, epic scale"}]`;
}
