import { describe, expect, it } from 'vitest';

import { asBusinessHours, type BusinessHours } from '../types/brand';

import { computeStats } from './stats';

const hours = (values: number[]): BusinessHours[] => values.map((v) => asBusinessHours(v));

describe('computeStats', () => {
  it('returns zeros for an empty sample set', () => {
    const result = computeStats(hours([]), 4);
    expect(result).toEqual({ n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 });
  });

  it('handles a single sample', () => {
    const result = computeStats(hours([2.5]), 4);
    expect(result.n).toBe(1);
    expect(result.median).toBe(2.5);
    expect(result.mean).toBe(2.5);
    expect(result.p90).toBe(2.5);
    expect(result.pctUnderSLA).toBe(100);
  });

  it('computes median as middle value for odd n', () => {
    const result = computeStats(hours([1, 3, 5, 7, 9]), 4);
    expect(result.median).toBe(5);
  });

  it('computes median as average of two middle values for even n', () => {
    const result = computeStats(hours([1, 2, 3, 4]), 4);
    expect(result.median).toBe(2.5);
  });

  it('computes mean as arithmetic average', () => {
    const result = computeStats(hours([1, 2, 3, 4, 5]), 4);
    expect(result.mean).toBe(3);
  });

  it('computes p90 via linear interpolation', () => {
    // Values [1..10], p90 position = 9 * 0.9 = 8.1 → between idx 8 (9) and idx 9 (10)
    // 9 + 0.1 * (10 - 9) = 9.1
    const result = computeStats(hours([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 4);
    expect(result.p90).toBeCloseTo(9.1, 5);
  });

  it('computes pctUnderSLA (samples <= SLA threshold)', () => {
    const result = computeStats(hours([1, 2, 3, 4, 5, 6, 7, 8]), 4);
    // 4 of 8 samples are <= 4h
    expect(result.pctUnderSLA).toBe(50);
  });

  it('counts samples equal to the SLA as meeting it', () => {
    const result = computeStats(hours([4, 4, 4, 5]), 4);
    expect(result.pctUnderSLA).toBe(75);
  });

  it('does not mutate the input array', () => {
    const input = hours([5, 1, 3, 2, 4]);
    const snapshot = [...input];
    computeStats(input, 4);
    expect(input).toEqual(snapshot);
  });

  it('handles unsorted input', () => {
    const result = computeStats(hours([9, 1, 5, 3, 7]), 4);
    expect(result.median).toBe(5);
  });
});
