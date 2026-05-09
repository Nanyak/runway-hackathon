import { StoryboardFrame, StoryboardPlan, FrameVariation, SessionConfig } from '@/lib/types';
import { storyboardFrameImagePath, variationImagePath, ensureDir, momentDir } from '@/lib/utils/file-utils';
import { textToImage, textToImageMulti, ImageReference } from './runway';
import { uploadImageToRunway } from '@/lib/modules/video-generator/runway';
import { resolveImageModel, getImageModelConfig } from '@/lib/config/models';
import { STORYBOARD_SHEET_STYLE } from '@/lib/config/storyboard-style';
import logger from '@/lib/logger';

function frameTag(index: number): string {
  return `frame${index}`;
}

const SHEET_VARIANT_COUNT = 3;

/**
 * Generates 3 storyboard sheet variants in a single API call using outputCount.
 * Variants are saved as frame_0.png, frame_1.png, frame_2.png.
 * onSheetReady is called for each variant as it becomes available.
 */
export async function generateStoryboardSheet(
  plan: StoryboardPlan,
  momentId: string,
  sessionId: string,
  config: SessionConfig,
  onSheetReady: (imagePath: string, variantIndex: number) => Promise<void>
): Promise<string[]> {
  await ensureDir(momentDir(sessionId, momentId));

  const panelDescriptions = plan.frames
    .map((f, i) => `Panel ${i + 1}: ${f.sceneDescription} ${f.motionContribution}`)
    .join('\n');

  const prompt = `${STORYBOARD_SHEET_STYLE}\n\nPANELS (top to bottom):\n${panelDescriptions}`;

  const destPaths = Array.from({ length: SHEET_VARIANT_COUNT }, (_, i) =>
    storyboardFrameImagePath(sessionId, momentId, i)
  );

  await textToImageMulti(prompt, config, destPaths);
  logger.info('Storyboard sheet variants generated', { momentId, panels: plan.frames.length, variants: SHEET_VARIANT_COUNT });

  // Notify caller for each variant (in parallel — all are already on disk)
  await Promise.all(
    destPaths.map((imagePath, i) => onSheetReady(imagePath, i))
  );

  return destPaths;
}

/**
 * Generates images for all storyboard frames with cascading visual consistency.
 *
 * Frames are generated sequentially. Each frame receives all previously generated
 * frames as referenceImages (up to 16), so gpt_image_2 conditions on the growing
 * visual context — character, lighting, palette, and setting stay consistent.
 */
export async function generateStoryboardImages(
  frames: StoryboardFrame[],
  momentId: string,
  sessionId: string,
  config: SessionConfig,
  onFrameReady: (index: number, imagePath: string) => Promise<void>
): Promise<StoryboardFrame[]> {
  await ensureDir(momentDir(sessionId, momentId));

  const imageModel = resolveImageModel(config);
  const maxRefs = getImageModelConfig(imageModel).maxReferenceImages;

  const sorted = [...frames].sort((a, b) => a.index - b.index);
  const results = new Map<number, StoryboardFrame>();
  const uploadedRefs: ImageReference[] = [];

  for (const frame of sorted) {
    const imagePath = storyboardFrameImagePath(sessionId, momentId, frame.index);
    const refs = uploadedRefs.slice(-maxRefs);
    const refTags = refs.map((r) => `@${r.tag}`).join(' ');
    const prompt = refs.length > 0
      ? `${refTags} ${frame.imagePrompt}. Style: ${frame.style}`
      : `${frame.imagePrompt}. Style: ${frame.style}`;

    await textToImage(prompt, config, imagePath, refs.length > 0 ? refs : undefined);
    logger.info('Storyboard frame generated', { momentId, index: frame.index, refCount: refs.length });

    const updated = { ...frame, imagePath };
    results.set(frame.index, updated);
    await onFrameReady(frame.index, imagePath);

    // Upload for use as reference in subsequent frames
    try {
      const uri = await uploadImageToRunway(imagePath);
      uploadedRefs.push({ tag: frameTag(frame.index), uri });
    } catch (err) {
      logger.warn('Could not upload frame as reference — next frames will skip it', {
        momentId,
        index: frame.index,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return frames.map((f) => results.get(f.index) ?? f);
}

/**
 * Regenerates only the specified frame indices after user feedback.
 *
 * Frames are processed in index order. Each frame being regenerated receives all
 * frames with a lower index as cascading references (uploaded fresh or from disk).
 * Frames NOT being regenerated keep their existing imagePath but still contribute
 * their image as a reference for any subsequent frames that are regenerated.
 */
export async function regenerateStoryboardFrames(
  frames: StoryboardFrame[],
  indicesToRegenerate: number[],
  momentId: string,
  sessionId: string,
  config: SessionConfig,
  onFrameReady: (index: number, imagePath: string) => Promise<void>
): Promise<StoryboardFrame[]> {
  await ensureDir(momentDir(sessionId, momentId));

  const imageModel = resolveImageModel(config);
  const maxRefs = getImageModelConfig(imageModel).maxReferenceImages;

  const toRegen = new Set(indicesToRegenerate);
  const sorted = [...frames].sort((a, b) => a.index - b.index);
  const results = new Map<number, StoryboardFrame>(frames.map((f) => [f.index, f]));

  // Pre-upload existing frames that are NOT being regenerated so they can be
  // used as references for the frames that ARE being regenerated.
  const existingUris = new Map<number, string>();
  await Promise.all(
    sorted
      .filter((f) => !toRegen.has(f.index) && f.imagePath)
      .map(async (f) => {
        try {
          const uri = await uploadImageToRunway(f.imagePath!); // ! justified: filtered above
          existingUris.set(f.index, uri);
        } catch {
          // skip — frame won't be available as a reference
        }
      })
  );

  // Build cascading refs and regenerate in order
  const uploadedRefs: ImageReference[] = [];

  for (const frame of sorted) {
    const tag = frameTag(frame.index);

    if (!toRegen.has(frame.index)) {
      // Not regenerating — advance the ref chain using the pre-uploaded URI
      const uri = existingUris.get(frame.index);
      if (uri) uploadedRefs.push({ tag, uri });
      continue;
    }

    // Regenerate this frame with all prior frames as cascading refs
    const imagePath = storyboardFrameImagePath(sessionId, momentId, frame.index);
    const refs = uploadedRefs.slice(-maxRefs);
    const refTags = refs.map((r) => `@${r.tag}`).join(' ');
    const prompt = refs.length > 0
      ? `${refTags} ${frame.imagePrompt}. Style: ${frame.style}`
      : `${frame.imagePrompt}. Style: ${frame.style}`;

    await textToImage(prompt, config, imagePath, refs.length > 0 ? refs : undefined);
    logger.info('Storyboard frame regenerated', { momentId, index: frame.index, refCount: refs.length });

    const updated = { ...frame, imagePath };
    results.set(frame.index, updated);
    await onFrameReady(frame.index, imagePath);

    try {
      const uri = await uploadImageToRunway(imagePath);
      uploadedRefs.push({ tag, uri });
    } catch (err) {
      logger.warn('Could not upload regenerated frame as reference', {
        momentId,
        index: frame.index,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return frames.map((f) => results.get(f.index) ?? f);
}

/** @deprecated Use generateStoryboardImages instead. */
export async function generateVariationImages(
  variations: FrameVariation[],
  momentId: string,
  sessionId: string,
  config: SessionConfig,
  onVariationReady: (index: number, imagePath: string) => Promise<void>
): Promise<FrameVariation[]> {
  await ensureDir(momentDir(sessionId, momentId));

  const updated = await Promise.all(
    variations.map((v) =>
      (async () => {
        const imagePath = variationImagePath(sessionId, momentId, v.index);
        const styledPrompt = `${v.imagePrompt}. Style: ${v.style}`;

        await textToImage(styledPrompt, config, imagePath);

        logger.info('Variation image generated', { momentId, index: v.index });

        await onVariationReady(v.index, imagePath);
        return { ...v, imagePath };
      })()
    )
  );

  return updated;
}
