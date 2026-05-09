export interface StylePreset {
  id: string;
  label: string;
  value: string;
  description: string;
}

export const DEFAULT_STYLE_ANCHOR = 'cinematic, muted tones, 4K, sharp focus';

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'cinematic',
    label: 'Cinematic',
    value: DEFAULT_STYLE_ANCHOR,
    description: 'Balanced film look with controlled contrast and detail.',
  },
  {
    id: 'documentary',
    label: 'Documentary',
    value: 'documentary realism, natural light, handheld texture, true-to-life color',
    description: 'Authentic and grounded visual language.',
  },
  {
    id: 'dreamy',
    label: 'Dreamy',
    value: 'dreamy, soft glow, pastel palette, diffused light, atmospheric haze',
    description: 'Soft, emotive mood with gentle highlights.',
  },
  {
    id: 'neon',
    label: 'Neon Noir',
    value: 'neon noir, high contrast, saturated magenta and cyan, reflective surfaces',
    description: 'Stylized high-energy palette with dramatic lighting.',
  },
  {
    id: 'retro-film',
    label: 'Retro Film',
    value: 'retro film, warm grain, analog texture, faded highlights, subtle vignette',
    description: 'Nostalgic analog tone and texture.',
  },
  {
    id: 'minimal-editorial',
    label: 'Minimal Editorial',
    value: 'minimal editorial, clean composition, neutral palette, crisp edges, modern',
    description: 'Clean, modern framing with restrained color.',
  },
];

export function resolveStyleAnchor(input: string): string {
  const normalized = input.trim();
  return normalized.length > 0 ? normalized : DEFAULT_STYLE_ANCHOR;
}

const MOOD_TO_PRESET_ID: Record<string, string> = {
  inspiring: 'cinematic',
  funny: 'minimal-editorial',
  educational: 'documentary',
  emotional: 'dreamy',
  controversial: 'neon',
};

export function suggestedStyleToPresetId(suggestedStyle?: string, mood?: string): string {
  if (suggestedStyle) {
    const lower = suggestedStyle.toLowerCase();
    for (const preset of STYLE_PRESETS) {
      if (lower.includes(preset.label.toLowerCase()) || lower.includes(preset.id.replace('-', ' '))) {
        return preset.id;
      }
    }
  }
  if (mood && MOOD_TO_PRESET_ID[mood]) {
    return MOOD_TO_PRESET_ID[mood];
  }
  return 'cinematic';
}

export function resolveToPresetValue(suggestedStyle?: string, mood?: string): string {
  const id = suggestedStyleToPresetId(suggestedStyle, mood);
  return STYLE_PRESETS.find((p) => p.id === id)?.value ?? DEFAULT_STYLE_ANCHOR;
}
