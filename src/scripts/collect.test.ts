import { describe, expect, it, vi } from 'vitest';

import {
  asBusinessHours,
  asIsoTimestamp,
  asPrNumber,
  asReviewerLogin,
  asRevisionPhid,
} from '../types/brand';

import { collect, type HistoryRow, type Sample } from './collect';
import type { GithubSample } from './github';
import type { PhabSample } from './phabricator';

const makePhabSample = (overrides: Partial<PhabSample> = {}): PhabSample => ({
  source: 'phab',
  id: asRevisionPhid('PHID-DREV-abcdefghijklmnopqrst'),
  reviewer: asReviewerLogin('alice'),
  requestedAt: asIsoTimestamp('2026-04-19T14:00:00Z'),
  firstActionAt: asIsoTimestamp('2026-04-19T16:00:00Z'),
  ...overrides,
});

const makeGhSample = (overrides: Partial<GithubSample> = {}): GithubSample => ({
  source: 'github',
  id: asPrNumber(42),
  reviewer: asReviewerLogin('bob'),
  requestedAt: asIsoTimestamp('2026-04-19T14:00:00Z'),
  firstActionAt: asIsoTimestamp('2026-04-19T15:00:00Z'),
  ...overrides,
});

describe('collect', () => {
  it('uses a 21-day lookback when no existing samples', async () => {
    const fetchPhab = vi.fn(async () => []);
    const fetchGithub = vi.fn(async () => []);

    const result = await collect({
      existingSamples: [],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T13:00:00Z'),
    });

    expect(fetchPhab).toHaveBeenCalledWith(21);
    expect(fetchGithub).toHaveBeenCalledWith(21);
    expect(result.lookbackDays).toBe(21);
  });

  it('uses a 3-day lookback when samples already exist', async () => {
    const existing: Sample[] = [{ ...makePhabSample(), tatBusinessHours: asBusinessHours(2) }];
    const fetchPhab = vi.fn(async () => []);
    const fetchGithub = vi.fn(async () => []);

    const result = await collect({
      existingSamples: existing,
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T13:00:00Z'),
    });

    expect(fetchPhab).toHaveBeenCalledWith(3);
    expect(fetchGithub).toHaveBeenCalledWith(3);
    expect(result.lookbackDays).toBe(3);
  });

  it('computes tatBusinessHours on new samples', async () => {
    // Mon 2026-04-20 10:00 ET → 12:00 ET = 2 business hours
    // 10:00 ET = 14:00 UTC; 12:00 ET = 16:00 UTC
    const fetchPhab = vi.fn(async () => [
      makePhabSample({
        requestedAt: asIsoTimestamp('2026-04-20T14:00:00Z'),
        firstActionAt: asIsoTimestamp('2026-04-20T16:00:00Z'),
      }),
    ]);
    const fetchGithub = vi.fn(async () => []);

    const result = await collect({
      existingSamples: [],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T18:00:00Z'),
    });

    expect(result.samples[0]?.tatBusinessHours).toBeCloseTo(2, 5);
  });

  it('deduplicates samples by (source, id, reviewer)', async () => {
    const existing: Sample[] = [{ ...makePhabSample(), tatBusinessHours: asBusinessHours(2) }];
    const fetchPhab = vi.fn(async () => [
      makePhabSample({ firstActionAt: asIsoTimestamp('2026-04-19T18:00:00Z') }),
    ]);
    const fetchGithub = vi.fn(async () => []);

    const result = await collect({
      existingSamples: existing,
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T13:00:00Z'),
    });

    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]?.firstActionAt).toBe('2026-04-19T16:00:00Z');
  });

  it('prunes samples older than 60 days', async () => {
    const old: Sample = {
      ...makePhabSample({
        id: asRevisionPhid('PHID-DREV-zzzzzzzzzzzzzzzzzzzz'),
        requestedAt: asIsoTimestamp('2026-01-01T14:00:00Z'),
        firstActionAt: asIsoTimestamp('2026-01-01T16:00:00Z'),
      }),
      tatBusinessHours: asBusinessHours(2),
    };
    const fetchPhab = vi.fn(async () => []);
    const fetchGithub = vi.fn(async () => []);

    const result = await collect({
      existingSamples: [old],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T13:00:00Z'),
    });

    expect(result.samples).toEqual([]);
  });

  it('appends today history row with 7d and 14d windows per source', async () => {
    const fetchPhab = vi.fn(async () => [
      makePhabSample({
        requestedAt: asIsoTimestamp('2026-04-19T14:00:00Z'),
        firstActionAt: asIsoTimestamp('2026-04-19T16:00:00Z'),
      }),
    ]);
    const fetchGithub = vi.fn(async () => [makeGhSample()]);

    const result = await collect({
      existingSamples: [],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T13:00:00Z'),
    });

    expect(result.history).toHaveLength(1);
    expect(result.history[0]?.date).toBe('2026-04-20');
    expect(result.history[0]?.phab.window7d.n).toBe(1);
    expect(result.history[0]?.github.window7d.n).toBe(1);
  });

  it('replaces an existing row for the same date (idempotent)', async () => {
    const existingHistory: HistoryRow[] = [
      {
        date: '2026-04-20',
        phab: {
          window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
          window14d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        },
        github: {
          window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
          window14d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        },
      },
    ];
    const fetchPhab = vi.fn(async () => [makePhabSample()]);
    const fetchGithub = vi.fn(async () => []);

    const result = await collect({
      existingSamples: [],
      existingHistory,
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T13:00:00Z'),
    });

    expect(result.history).toHaveLength(1);
    expect(result.history[0]?.phab.window7d.n).toBe(1);
  });

  it('preserves history rows from previous dates', async () => {
    const prior: HistoryRow = {
      date: '2026-04-19',
      phab: {
        window7d: { n: 5, median: 2, mean: 2, p90: 3, pctUnderSLA: 80 },
        window14d: { n: 5, median: 2, mean: 2, p90: 3, pctUnderSLA: 80 },
      },
      github: {
        window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        window14d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
      },
    };
    const fetchPhab = vi.fn(async () => []);
    const fetchGithub = vi.fn(async () => []);

    const result = await collect({
      existingSamples: [{ ...makePhabSample(), tatBusinessHours: asBusinessHours(2) }],
      existingHistory: [prior],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T13:00:00Z'),
    });

    expect(result.history).toHaveLength(2);
    expect(result.history[0]?.date).toBe('2026-04-19');
    expect(result.history[1]?.date).toBe('2026-04-20');
  });
});
