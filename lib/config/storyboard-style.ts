/**
 * Fixed visual style for storyboard sheet image generation.
 * Edit here to change the look of all storyboard images — no other file needs updating.
 */
export const STORYBOARD_SHEET_STYLE =
  'Minimal hand-drawn cinematic storyboard page, black-and-white pencil sketch style, ' +
  'rough pre-production thumbnails on white paper, multiple rectangular storyboard panels ' +
  'arranged vertically, messy graphite lines, loose ink shading, construction lines, ' +
  'handwritten shot labels ("WIDE", "CU", "OTS", "MED WIDE"), camera movement arrows, ' +
  'motion direction arrows, handwritten notes under frames, dynamic cinematic composition, ' +
  'realistic film director storyboard notebook aesthetic, raw and unfinished look, ' +
  'visible pencil smudges, professional movie previsualization style, ' +
  'energetic sketch strokes, storyboard sheet layout only, no polished illustration, no color.';

/** Seedance2 video prompt when using the storyboard sheet as reference. */
export const STORYBOARD_VIDEO_PROMPT =
  'Use the storyboard @storyboard as sequential shot guidance, not as a static image. ' +
  'Do not treat the storyboard as one image. Follow each panel as a separate beat. ' +
  'Motion follows the energy and rhythm of the spoken audio.';

/** Tag used when uploading the storyboard sheet to Runway. */
export const STORYBOARD_IMAGE_TAG = 'storyboard';
