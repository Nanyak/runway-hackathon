import { Moment } from '@/lib/types';

export function deduplicateMoments(moments: Moment[]): Moment[] {
  // Sort by viralScore descending
  const sorted = [...moments].sort((a, b) => b.viralScore - a.viralScore);

  const selected: Moment[] = [];

  for (const moment of sorted) {
    const overlaps = selected.some(
      (s) => moment.startSec < s.endSec && moment.endSec > s.startSec
    );

    if (!overlaps) {
      selected.push(moment);
    }
  }

  // Return in chronological order
  return selected.sort((a, b) => a.startSec - b.startSec);
}
