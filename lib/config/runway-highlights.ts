/**
 * Copy + structure for hackathon / product narrative: how Runway is used beyond a single API call.
 * Keep in sync with actual modules: image-generator, video-generator, video-reviser.
 */
export const RUNWAY_STACK_SUMMARY =
  'Gen-4 Image for keyframe concepts, Seedance 2 for image-to-video (and text-to-video fallback), and Gen-4 Aleph for video-to-video refinements — with ephemeral uploads and task polling.';

export const RUNWAY_PIPELINE_STEPS: { title: string; detail: string }[] = [
  {
    title: 'Text-to-image (Gen-4 Image)',
    detail: 'Generates cinematic stills from Claude-planned prompts before any video job runs.',
  },
  {
    title: 'Image-to-video (Seedance 2)',
    detail:
      'Animates the selected keyframe into vertical B-roll (5–15s), with optional moment audio as reference when the API allows.',
  },
  {
    title: 'Video-to-video (Gen-4 Aleph)',
    detail: 'Optional refinements: upload source MP4, transform with natural-language feedback.',
  },
];

export const PRODUCT_VALUE_PROPOSITION =
  'Podcasters and creators lose hours scrubbing for Shorts-worthy beats and matching visuals. This app finds the moment, lets you approve spend, generates Runway B-roll, then burns captions and audio into a finished vertical MP4 — in one browser flow.';
