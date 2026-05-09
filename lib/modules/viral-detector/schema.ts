import { z } from 'zod';

export const MomentDetectionSchema = z.object({
  title: z.string().min(1).max(200),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  viralScore: z.number().min(0).max(100),
  reason: z.string().min(1),
  hook: z.string().max(100),
  mood: z.enum(['inspiring', 'funny', 'educational', 'controversial', 'emotional']),
  clipType: z.enum(['one-liner', 'story-arc', 'insight', 'reaction']),
  suggestedStyle: z.string().min(5).max(200).optional(),
}).refine(
  (data) => {
    const dur = data.endSec - data.startSec;
    return dur >= 5 && dur <= 15;
  },
  { message: 'Moment must be between 5 and 15 seconds long' }
);

export const MomentDetectionArraySchema = z.array(MomentDetectionSchema);

export type MomentDetectionInput = z.infer<typeof MomentDetectionSchema>;
