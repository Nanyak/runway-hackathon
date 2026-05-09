import { z } from 'zod';

export const ScenePlanSchema = z.object({
  captionText: z.string().transform((s) => s.substring(0, 80)),
  imagePrompt: z.string().min(1),
  videoMotionPrompt: z.string().min(1),
  brollType: z.enum(['abstract', 'metaphor', 'literal', 'text-only']),
  transitionType: z.enum(['cut', 'fade', 'zoom']),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
}).refine(
  (data) => data.endSec > data.startSec,
  { message: 'endSec must be greater than startSec' }
);

export const ScenePlanArraySchema = z.array(ScenePlanSchema).min(1).max(10);

export type ScenePlanInput = z.infer<typeof ScenePlanSchema>;
