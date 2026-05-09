import { Moment, PodcastContext, SessionConfig } from '@/lib/types';

export function buildStoryboardPlannerPrompt(
  moment: Moment,
  transcriptText: string,
  config: SessionConfig,
  podcastContext?: PodcastContext,
  styleAnchor?: string
): string {
  const contextBlock = podcastContext
    ? `PODCAST: "${podcastContext.topic}" (${podcastContext.genre})\n`
    : '';

  const style = styleAnchor || config.styleAnchor || 'cinematic, muted tones, 4K, sharp focus';
  const orientation = config.orientation === 'vertical' ? '9:16 vertical (TikTok/Reels/Shorts)' : '16:9 landscape';
  const durationSec = Math.round(moment.endSec - moment.startSec);

  return `You are a cinematic director creating a highly detailed sequential visual storyboard for a short-form social video.

${contextBlock}MOMENT TO VISUALIZE:
- Title: "${moment.title}"
- Duration: ${durationSec}s
- Mood: ${moment.mood} / ${moment.clipType}
- Hook: "${moment.hook}"
- Transcript: "${transcriptText}"

VISUAL STYLE: ${style}
FORMAT: ${orientation}

Your task: Create as many sequential storyboard frames as necessary to fully capture every visual beat of this moment — up to 16 frames.
Do NOT limit yourself to a fixed count. Every meaningful shift in camera angle, lighting change, subject reveal, emotional beat, or narrative turn deserves its own frame.
These frames define each panel in a single hand-drawn storyboard sheet image, which Seedance2 uses to animate a ${durationSec}-second video.
The order and density of panels directly determines how cinematically rich and well-directed the final video is. More detail = better output.

RULES FOR EACH FRAME:
- sceneDescription: Begin with a shot label in brackets — [WIDE], [CU], [OTS], [MED WIDE], [ECU], [AERIAL], [POV], or [INSERT] — then describe exactly what this frame shows, WHY it belongs at this point in the story, and what emotional or narrative purpose it serves. Include a camera movement arrow (e.g. "→ push in", "↑ tilt up", "← pan left", "↻ orbit right"). Be specific about subject position, depth, foreground/background relationship. 2–3 sentences, max 600 characters.
- imagePrompt: A rich, fully self-contained scene description for text-to-image generation. Include: exact composition and framing, subject(s) and their pose/expression/action, lighting quality and direction (e.g. "soft golden backlight", "harsh side-fill neon"), color palette (name specific colors), texture and surface detail, atmospheric conditions, depth of field. No text, logos, UI, or watermarks. Max 900 characters (hard limit — Runway rejects longer prompts).
- motionContribution: Explain precisely how this frame advances the visual narrative arc and what the viewer should feel or understand after seeing it. Mention any contrast or callback to a prior frame if relevant. 1–2 sentences, max 300 characters.
- style: Specific visual style tags including genre, era, film stock, lens characteristic, color grading style. Max 200 characters.

NARRATIVE STRUCTURE — every frame must serve the arc:
- Opening (frames 0–1): Establish — hook the viewer immediately; introduce the visual world, subject, and emotional register
- Rising action (frames 2–4): Develop — build the story; introduce contrast, tension, movement, or environmental storytelling
- Core beats (frames 5 to N-2): Deepen — show each meaningful idea or emotional shift in the transcript as its own visual beat; use close-ups on reactions, insert shots of key details, wide shots to reestablish scale
- Resolution (last 1–2 frames): Close — land on an image that emotionally or visually resolves the hook; the final frame should linger

PACING GUIDANCE:
- For high-energy moods (funny, controversial): dense frames, rapid visual contrast, bold compositions
- For reflective moods (emotional, inspiring): fewer but richer frames with deliberate transitions and slower camera logic
- For educational/insight clips: alternate between wide establishing shots and tight insert shots that illustrate each key concept

OVERALL MOTION PROMPT:
- Write a single Seedance2 motion prompt for the whole video. Max 800 characters (hard limit: Runway rejects prompts over 1000 chars).
- Describe the camera's journey through all the storyboard panels in sequence
- Be specific: name shot types, transitions (cut vs. dissolve vs. whip-pan), and movement directions for key panels
- Match the mood: inspiring → slow reveal with gentle drift, funny → snappy cuts and whip-pans, emotional → subtle push with breath-like rhythm
- IMPORTANT: The moment's spoken audio will be passed as a referenceAudio to Seedance2. Explicitly describe the audio-visual sync relationship — e.g. "camera cuts sync with speech emphasis beats", "slow push mirrors the reflective narration pace", "rapid cuts match the energetic vocal delivery". This dramatically improves sync quality.

Return ONLY valid JSON:
{
  "frames": [
    {
      "index": 0,
      "sceneDescription": "...",
      "imagePrompt": "...",
      "motionContribution": "...",
      "style": "..."
    }
  ],
  "overallMotionPrompt": "..."
}`;
}
