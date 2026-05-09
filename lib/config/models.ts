import { SessionConfig } from '@/lib/types';

// ── Image models ──────────────────────────────────────────────────────────────

export interface ImageModelConfig {
  id: string;
  label: string;
  description: string;
  /** Max promptText characters accepted by the Runway API. */
  promptLimit: number;
  /** Max referenceImages the model accepts (0 = none supported). */
  maxReferenceImages: number;
  /** Whether the model accepts a `seed` parameter. */
  supportsSeed: boolean;
  ratios: { vertical: string; landscape: string };
}

export const IMAGE_MODEL_CONFIGS: ImageModelConfig[] = [
  {
    id: 'gpt_image_2',
    label: 'GPT Image 2',
    description: 'Up to 16 reference images, 32K prompt, 4K quality',
    promptLimit: 32_000,
    maxReferenceImages: 16,
    supportsSeed: false,
    // gpt_image_2 rejects 1080:1920 — use the nearest valid 9:16 ratio
    ratios: { vertical: '1088:1920', landscape: '1920:1088' },
  },
  {
    id: 'gen4_image',
    label: 'Gen 4 Image',
    description: 'Best for character/style consistency across scenes',
    promptLimit: 1_000,
    maxReferenceImages: 3,
    supportsSeed: true,
    ratios: { vertical: '1080:1920', landscape: '1920:1080' },
  },
  {
    id: 'gen4_image_turbo',
    label: 'Gen 4 Image Turbo',
    description: 'Fast & cheap — requires at least 1 reference image',
    promptLimit: 1_000,
    maxReferenceImages: 3,
    supportsSeed: true,
    ratios: { vertical: '1080:1920', landscape: '1920:1080' },
  },
  {
    id: 'gemini_image3_pro',
    label: 'Gemini Image 3 Pro',
    description: 'Google Imagen 3 — up to 14 refs, 5500-char prompt, human/object subject types',
    promptLimit: 5_500,
    maxReferenceImages: 14,
    supportsSeed: false,
    ratios: { vertical: '768:1344', landscape: '1344:768' },
  },
  {
    id: 'gemini_2.5_flash',
    label: 'Gemini 2.5 Flash',
    description: 'Google model — fast, good for general scenes',
    promptLimit: 1_000,
    maxReferenceImages: 3,
    supportsSeed: false,
    ratios: { vertical: '768:1344', landscape: '1344:768' },
  },
];

export const DEFAULT_IMAGE_MODEL_ID = 'gpt_image_2';

export function getImageModelConfig(id: string): ImageModelConfig {
  return IMAGE_MODEL_CONFIGS.find((m) => m.id === id) ?? IMAGE_MODEL_CONFIGS[0]!;
}

export function resolveImageModel(config: SessionConfig): string {
  return config.imageModel?.trim() || DEFAULT_IMAGE_MODEL_ID;
}

// ── Video models ──────────────────────────────────────────────────────────────

export interface VideoModelConfig {
  id: string;
  label: string;
  description: string;
  /** Max promptText characters accepted by the Runway API. */
  promptLimit: number;
  /** Max referenceImages (images) for text_to_video (0 = not supported). */
  maxReferenceImages: number;
  /** Max referenceAudio clips accepted (0 = not supported). */
  maxReferenceAudio: number;
  durationRange: { min: number; max: number };
  ratios: { vertical: string; landscape: string };
}

export const VIDEO_MODEL_CONFIGS: VideoModelConfig[] = [
  {
    id: 'seedance2',
    label: 'Seedance 2',
    description: 'Multi-image + audio reference, 5–15s, highest quality',
    promptLimit: 1_000,
    maxReferenceImages: 9,
    maxReferenceAudio: 3,
    durationRange: { min: 5, max: 15 },
    ratios: { vertical: '720:1280', landscape: '1280:720' },
  },
  {
    id: 'gen4.5',
    label: 'Gen 4.5',
    description: 'Recommended — strong motion, fast generation',
    promptLimit: 1_000,
    maxReferenceImages: 0,
    maxReferenceAudio: 0,
    durationRange: { min: 5, max: 10 },
    ratios: { vertical: '720:1280', landscape: '1280:720' },
  },
  {
    id: 'veo3.1_fast',
    label: 'Veo 3.1 Fast',
    description: 'Google Veo — fast variant',
    promptLimit: 1_000,
    maxReferenceImages: 0,
    maxReferenceAudio: 0,
    durationRange: { min: 5, max: 8 },
    ratios: { vertical: '720:1280', landscape: '1280:720' },
  },
  {
    id: 'veo3.1',
    label: 'Veo 3.1',
    description: 'Google Veo — full quality',
    promptLimit: 1_000,
    maxReferenceImages: 0,
    maxReferenceAudio: 0,
    durationRange: { min: 5, max: 8 },
    ratios: { vertical: '720:1280', landscape: '1280:720' },
  },
  {
    id: 'veo3',
    label: 'Veo 3',
    description: 'Google Veo — original',
    promptLimit: 1_000,
    maxReferenceImages: 0,
    maxReferenceAudio: 0,
    durationRange: { min: 5, max: 8 },
    ratios: { vertical: '720:1280', landscape: '1280:720' },
  },
];

export const DEFAULT_VIDEO_MODEL_ID = 'seedance2';

export function getVideoModelConfig(id: string): VideoModelConfig {
  return VIDEO_MODEL_CONFIGS.find((m) => m.id === id) ?? VIDEO_MODEL_CONFIGS[0]!;
}
