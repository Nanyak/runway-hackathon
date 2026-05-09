import { z } from 'zod';

export const FrameVariationSchema = z.object({
  imagePrompt: z.string().min(20).max(1200),
  motionPrompt: z.string().min(10).max(300),
  style: z.string().min(5).max(200),
});

export const FramePlanSchema = z.array(FrameVariationSchema).min(2).max(4);

export type FramePlanInput = z.infer<typeof FrameVariationSchema>;
