import { describe, expect, it } from 'vitest';

import type { SourceWindows } from '../scripts/collect';
import type { WindowStats } from '../scripts/stats';

import { sourceWindowsHasRedIssue } from './redIssue';

const sla = 4;
const goodStats: WindowStats = { n: 5, median: 2, mean: 2.5, p90: 3.5, pctUnderSLA: 95 };
const warnStats: WindowStats = { n: 5, median: 5, mean: 6, p90: 7, pctUnderSLA: 75 };
// hours beyond 2 × SLA = bad tier; pct under 70 = bad tier.
const badHoursStats: WindowStats = { n: 5, median: 10, mean: 12, p90: 20, pctUnderSLA: 80 };
const badPctStats: WindowStats = { n: 5, median: 2, mean: 2.5, p90: 3.5, pctUnderSLA: 40 };
const emptyStats: WindowStats = { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 };

describe('sourceWindowsHasRedIssue', () => {
  it('returns false for undefined windows', () => {
    expect(sourceWindowsHasRedIssue(undefined, sla)).toBe(false);
  });

  it('returns false when every window is good', () => {
    const windows: SourceWindows = {
      window7d: goodStats,
      window14d: goodStats,
      window30d: goodStats,
    };
    expect(sourceWindowsHasRedIssue(windows, sla)).toBe(false);
  });

  it('returns false for warn-tier stats (not bad)', () => {
    const windows: SourceWindows = {
      window7d: warnStats,
      window14d: warnStats,
      window30d: warnStats,
    };
    expect(sourceWindowsHasRedIssue(windows, sla)).toBe(false);
  });

  it('returns true when any window has a bad-tier hours stat', () => {
    const windows: SourceWindows = {
      window7d: goodStats,
      window14d: badHoursStats,
      window30d: goodStats,
    };
    expect(sourceWindowsHasRedIssue(windows, sla)).toBe(true);
  });

  it('returns true when any window has a bad pctUnderSLA', () => {
    const windows: SourceWindows = {
      window7d: goodStats,
      window14d: goodStats,
      window30d: badPctStats,
    };
    expect(sourceWindowsHasRedIssue(windows, sla)).toBe(true);
  });

  it('ignores empty windows (n=0) even though pctUnderSLA=0 would otherwise be bad', () => {
    const windows: SourceWindows = {
      window7d: emptyStats,
      window14d: emptyStats,
      window30d: emptyStats,
    };
    expect(sourceWindowsHasRedIssue(windows, sla)).toBe(false);
  });
});
