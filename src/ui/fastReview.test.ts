import { describe, expect, it } from 'vitest';

import type { Sample } from '../scripts/collect';
import { asBusinessHours, asIsoTimestamp, asPrNumber, asReviewerLogin } from '../types/brand';

import { countFastInWindow, isFastSample } from './fastReview';

const sample = (overrides: Partial<Sample> = {}): Sample =>
  ({
    source: 'github',
    id: asPrNumber(7),
    reviewer: asReviewerLogin('alice'),
    requestedAt: asIsoTimestamp('2026-04-13T13:00:00Z'),
    firstActionAt: asIsoTimestamp('2026-04-13T14:00:00Z'),
    tatBusinessHours: asBusinessHours(1),
    ...overrides,
  }) as Sample;

describe('isFastSample', () => {
  it('treats a turnaround under the threshold as fast', () => {
    expect(isFastSample(sample({ tatBusinessHours: asBusinessHours(1.9) }), 2)).toBe(true);
  });

  it('does not treat exactly the threshold as fast (strictly under)', () => {
    expect(isFastSample(sample({ tatBusinessHours: asBusinessHours(2) }), 2)).toBe(false);
  });

  it('treats a turnaround above the threshold as not fast', () => {
    expect(isFastSample(sample({ tatBusinessHours: asBusinessHours(2.1) }), 2)).toBe(false);
  });
});

describe('countFastInWindow', () => {
  // Anchor "now" at Fri 2026-04-17 17:00 ET; a 7-day window reaches back to
  // 2026-04-11. The requestedAt timestamps below are well inside or before it.
  const now = new Date('2026-04-17T21:00:00Z');

  it('counts only fast samples whose request falls inside the window', () => {
    const samples = [
      sample({
        requestedAt: asIsoTimestamp('2026-04-15T13:00:00Z'),
        tatBusinessHours: asBusinessHours(1),
      }), // in, fast
      sample({
        requestedAt: asIsoTimestamp('2026-04-15T13:00:00Z'),
        tatBusinessHours: asBusinessHours(5),
      }), // in, slow
      sample({
        requestedAt: asIsoTimestamp('2026-03-01T13:00:00Z'),
        tatBusinessHours: asBusinessHours(1),
      }), // out, fast
    ];
    expect(countFastInWindow(samples, 7, now, 2)).toBe(1);
  });

  it('returns 0 for an empty list', () => {
    expect(countFastInWindow([], 7, now, 2)).toBe(0);
  });
});
