import { describe, expect, it } from 'vitest';

import type { SourceWindows } from '../scripts/collect';
import type { WindowStats } from '../scripts/stats';

import { window7dMedianOverSla } from './redIssue';

const sla = 4;
const goodStats: WindowStats = { n: 5, median: 2, mean: 2.5, p90: 3.5, pctUnderSLA: 95 };
// 7d median at exactly 4 stays non-red (strict > SLA).
const atSlaStats: WindowStats = { n: 5, median: 4, mean: 4.5, p90: 6, pctUnderSLA: 80 };
const overSlaStats: WindowStats = { n: 5, median: 5, mean: 5.5, p90: 7, pctUnderSLA: 70 };
const emptyStats: WindowStats = { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 };

describe('window7dMedianOverSla', () => {
  it('returns false when the 7-day window has no samples', () => {
    const windows: SourceWindows = {
      window7d: emptyStats,
      window14d: overSlaStats,
      window30d: overSlaStats,
    };
    expect(window7dMedianOverSla(windows, sla)).toBe(false);
  });

  it('returns false when the 7-day median equals the SLA', () => {
    const windows: SourceWindows = {
      window7d: atSlaStats,
      window14d: goodStats,
      window30d: goodStats,
    };
    expect(window7dMedianOverSla(windows, sla)).toBe(false);
  });

  it('returns true when the 7-day median is over the SLA', () => {
    const windows: SourceWindows = {
      window7d: overSlaStats,
      window14d: goodStats,
      window30d: goodStats,
    };
    expect(window7dMedianOverSla(windows, sla)).toBe(true);
  });

  it('ignores 14-day and 30-day windows when deciding', () => {
    const windows: SourceWindows = {
      window7d: goodStats,
      window14d: overSlaStats,
      window30d: overSlaStats,
    };
    expect(window7dMedianOverSla(windows, sla)).toBe(false);
  });
});
