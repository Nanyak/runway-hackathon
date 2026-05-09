import { z } from 'zod';

export const StoryboardFrameSchema = z.object({
  index: z.number().int().min(0).max(15),
  sceneDescription: z.string().min(10).max(700),
  imagePrompt: z.string().min(20).max(1200),
  motionContribution: z.string().min(10).max(400),
  style: z.string().min(5).max(250),
});

export const StoryboardPlanSchema = z.object({
  frames: z.array(StoryboardFrameSchema).min(4).max(16),
  overallMotionPrompt: z.string().min(20).max(900),
});
