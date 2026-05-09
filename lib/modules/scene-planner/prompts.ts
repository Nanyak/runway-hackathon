import { Moment, SessionConfig, PodcastContext } from '@/lib/types';

const MOOD_VISUAL_MAP: Record<string, string> = {
  inspiring: 'warm golden-hour light, upward energy, expansive framing that feels limitless',
  funny: 'bright even lighting, playful color pops, slightly exaggerated compositions',
  educational: 'clean neutral light, sharp clarity, structured geometric framing',
  controversial: 'high-contrast dramatic light, deep shadows, tense close crops',
  emotional: 'soft diffused light, intimate close framing, muted desaturated palette',
};

export function buildScenePlannerPrompt(
  moment: Moment,
  transcriptText: string,
  config: SessionConfig,
  podcastContext?: PodcastContext
): string {
  const durationSec = moment.endSec - moment.startSec;
  const stylePrefix = config.styleAnchor ? `${config.styleAnchor}, ` : 'cinematic, muted tones, 4K, ';

  // Moments are capped at 15s — always 1 scene. One image, one motion clip, fully coherent.
  const numScenes = durationSec <= 20 ? 1 : durationSec <= 45 ? 2 : 3;
  const targetDuration = (durationSec / numScenes).toFixed(1);

  const moodVisual = MOOD_VISUAL_MAP[moment.mood] ?? 'cinematic neutral lighting';

  const contextBlock = podcastContext
    ? `
PODCAST CONTEXT (use this to make visuals relevant to this specific show):
- Topic: ${podcastContext.topic}
- Genre: ${podcastContext.genre}
- Speakers: ${podcastContext.speakers.length > 0 ? podcastContext.speakers.join(', ') : 'Unknown'}
- Episode: ${podcastContext.summary}
`
    : '';

  return `You are a visual director creating background visuals for a short-form podcast clip (TikTok/Reels/Shorts). The podcast audio plays over your visuals — the speaker's words are the star; your visuals provide atmosphere and reinforce meaning.
${contextBlock}
CLIP DETAILS:
- Title: ${moment.title}
- Duration: ${durationSec.toFixed(1)} seconds
- Mood: ${moment.mood} → Visual feel: ${moodVisual}
- Hook: ${moment.hook}

TRANSCRIPT (what the speaker says):
${transcriptText}

━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — DEFINE THE VISUAL CONCEPT (do this mentally before writing scenes)

Pick ONE specific real-world setting that is DIRECTLY RELATED to what the speaker is actually talking about. The visual must feel like it belongs in the same world as the words.

Examples:
- Speaker talks about building a startup → A person coding at a cluttered desk with coffee, golden hour through blinds
- Speaker talks about fear of failure → A lone climber on a rock face, storm clouds gathering below
- Speaker talks about mindset → Abstract: neurons firing, or literal: a person meditating in early morning light

DO NOT pick abstract textures, random nature footage, or generic "cinematic" scenes that have no connection to the topic.

━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — PLAN ${numScenes} SCENE${numScenes > 1 ? 'S' : ''}

IMPORTANT: Visuals are generated with a TEXT-TO-VIDEO AI — there is no image step. Your prompts go directly to the video model.

For each scene:
- captionText: The exact transcript words spoken during this scene (max 80 chars, no ellipsis)
- imagePrompt: The FULL text-to-video prompt. This is what the AI video model sees directly. Write it as a rich, vivid description of the video clip: setting, subject, lighting, color, and any key visual elements. Start with: "${stylePrefix}". Must be DIRECTLY related to what the speaker is saying. Do NOT describe camera motion here — that goes in videoMotionPrompt.
- videoMotionPrompt: Camera motion only — slow push in, gentle pan left, subtle drift upward, etc. Keep it cinematic and smooth. For multiple scenes, vary the motion so each scene feels distinct.
- brollType: MUST be "literal" if the visual directly depicts what is spoken, "metaphor" only if abstract connection, never "abstract"
- transitionType: "cut" for energy, "fade" for emotional beats, "zoom" for emphasis
- startSec: offset from clip start (first scene = 0)
- endSec: offset from clip start (last scene = ${durationSec.toFixed(1)})

Scene timing:
- Exactly ${numScenes} scene${numScenes > 1 ? 's' : ''}
- First scene startSec = 0, last scene endSec = ${durationSec.toFixed(1)}
- No gaps or overlaps

Return ONLY a valid JSON array, no markdown, no explanation:
[{"captionText":"...","imagePrompt":"${stylePrefix}...","videoMotionPrompt":"Slow push in toward the subject","brollType":"literal","transitionType":"cut","startSec":0,"endSec":${targetDuration}}]`;
}
