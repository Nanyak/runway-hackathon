import { SessionConfig } from '@/lib/types';
import { textToImage, ImageReference } from '@/lib/modules/image-generator/runway';
import { uploadImageToRunway } from '@/lib/modules/video-generator/runway';
import logger from '@/lib/logger';

/**
 * Generates a clean character portrait by passing the storyboard sheet as a reference
 * to GPT Image 2. The result is a consistent, isolated portrait of the speaker as
 * depicted in the storyboard — used as a visual anchor for Seedance 2.
 */
export async function generateCharacterFromStoryboard(
  sessionId: string,
  momentId: string,
  storyboardSheetPath: string,
  config: SessionConfig,
  destPath: string,
  speakerName?: string
): Promise<void> {
  const name = speakerName?.trim() || 'the speaker';

  // Upload the storyboard sheet so GPT Image 2 can use it as a reference
  const sheetUri = await uploadImageToRunway(storyboardSheetPath);
  const refs: ImageReference[] = [{ tag: 'storyboard', uri: sheetUri }];

  const prompt =
    `@storyboard From this storyboard, extract the main speaker (${name}) and generate ` +
    `a clean, well-lit portrait of the same person. ` +
    `Consistent appearance with the storyboard panels. Cinematic illustration style, ` +
    `professional lighting, slightly stylized rather than photorealistic. ` +
    `Neutral or slightly blurred background. No text, no logos, no watermarks.`;

  const characterConfig: SessionConfig = { ...config, imageModel: 'gpt_image_2' };

  logger.info('Generating character portrait from storyboard', { sessionId, momentId, name });
  await textToImage(prompt, characterConfig, destPath, refs);
  logger.info('Character portrait saved', { sessionId, momentId, destPath });
}
