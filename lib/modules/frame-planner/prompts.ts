import { Moment, PodcastContext, SessionConfig } from '@/lib/types';

export function buildFramePlannerPrompt(
  moment: Moment,
  transcriptText: string,
  config: SessionConfig,
  podcastContext?: PodcastContext
): string {
  const contextBlock = podcastContext
    ? `PODCAST: "${podcastContext.topic}" (${podcastContext.genre})\n`
    : '';

  const style = config.styleAnchor || 'cinematic, muted tones, 4K, sharp focus';
  const orientation = config.orientation === 'vertical' ? '9:16 vertical (TikTok/Reels/Shorts)' : '16:9 landscape';
  const duration = Math.round(moment.endSec - moment.startSec);

  return `You are a creative director generating B-roll visual concepts for a short-form podcast clip.

${contextBlock}MOMENT:
- Title: "${moment.title}"
- Mood: ${moment.mood} / ${moment.clipType}
- Duration: ${duration}s
- Hook: "${moment.hook}"
- Transcript: "${transcriptText}"

BASE STYLE: ${style}
FORMAT: ${orientation}

Generate exactly 3 distinct visual concepts (variations) for this moment's ${duration}-second video.
Each variation is a different visual approach — the user will pick the one they like best.

RULES FOR EACH VARIATION:
- imagePrompt: A vivid, self-contained scene description for text-to-image generation.
  Must be rich with: composition (wide shot / close-up / POV), lighting, color palette, texture, atmosphere.
  No text, logos, or UI in the frame. Pure cinematic image.
- motionPrompt: How the camera moves to animate this image into a ${duration}s video.
  Examples: "slow dolly forward into the scene", "gentle upward crane reveal", "subtle parallax drift left"
- style: Visual style tags specific to this variation (different emphasis per variation)

VARIATION STRATEGY — make each distinctly different:
- Variation 0: Literal / concrete — a real-world scene that matches the moment's topic
- Variation 1: Abstract / metaphorical — a symbolic image that captures the emotion
- Variation 2: Atmospheric / mood-first — pure mood, texture, light (no narrative)

Return ONLY a JSON array of exactly 3 objects:
[
  { "imagePrompt": "...", "motionPrompt": "...", "style": "..." },
  { "imagePrompt": "...", "motionPrompt": "...", "style": "..." },
  { "imagePrompt": "...", "motionPrompt": "...", "style": "..." }
]`;
}
