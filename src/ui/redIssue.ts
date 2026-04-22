import type { SourceWindows } from '../scripts/collect';

import { tierForHours, tierForPctUnderSla } from './slaTier';

// True iff any of the 7/14/30-day windows has at least one stat in the 'bad'
// tier — i.e. median/mean/p90 over 2× the threshold or pctUnderSLA under 70%.
// Empty windows (n=0) are ignored: pctUnderSLA=0 is a bookkeeping default when
// there are no samples, not an actual failing metric.
export const sourceWindowsHasRedIssue = (
  windows: SourceWindows | undefined,
  slaThreshold: number,
): boolean => {
  if (windows === undefined) return false;
  for (const w of [windows.window7d, windows.window14d, windows.window30d]) {
    if (w.n === 0) continue;
    if (
      tierForHours(w.median, slaThreshold) === 'bad' ||
      tierForHours(w.mean, slaThreshold) === 'bad' ||
      tierForHours(w.p90, slaThreshold) === 'bad' ||
      tierForPctUnderSla(w.pctUnderSLA) === 'bad'
    ) {
      return true;
    }
  }
  return false;
};
