import { describe, expect, it } from 'vitest';

import type { Sample } from '../scripts/collect';
import {
  asBusinessHours,
  asIsoTimestamp,
  asPrNumber,
  asReviewerLogin,
  asRevisionPhid,
} from '../types/brand';

import { buildLeaderboard } from './leaderboard';

const NOW = new Date('2026-04-17T21:00:00Z');

// A completed review by `reviewer` that took `tat` business hours. Defaults to
// a request inside the 30-day window anchored on NOW.
const review = (
  reviewer: string,
  tat: number,
  source: 'phab' | 'github' = 'phab',
  requestedAt = '2026-04-10T13:00:00Z',
): Sample =>
  ({
    source,
    id: source === 'phab' ? asRevisionPhid('PHID-DREV-aaaaaaaaaaaaaaaaaaaa') : asPrNumber(1),
    revisionId: source === 'phab' ? 1 : undefined,
    reviewer: asReviewerLogin(reviewer),
    requestedAt: asIsoTimestamp(requestedAt),
    firstActionAt: asIsoTimestamp(requestedAt),
    tatBusinessHours: asBusinessHours(tat),
  }) as Sample;

const reviews = (reviewer: string, tats: number[], source: 'phab' | 'github' = 'phab'): Sample[] =>
  tats.map((tat) => review(reviewer, tat, source));

describe('buildLeaderboard', () => {
  it('returns an empty list when there are no samples', () => {
    expect(buildLeaderboard([], { now: NOW })).toEqual([]);
  });

  it('excludes reviewers below the minimum sample count', () => {
    const rows = buildLeaderboard([...reviews('busy', [1, 1, 1]), ...reviews('rare', [1, 1])], {
      now: NOW,
      minSamples: 3,
    });
    expect(rows.map((r) => r.reviewer)).toEqual(['busy']);
  });

  it('ranks by percentage under SLA, highest first', () => {
    const rows = buildLeaderboard(
      [...reviews('reliable', [1, 1, 1]), ...reviews('spotty', [1, 10, 10])],
      { now: NOW, minSamples: 3, slaHours: 4 },
    );
    expect(rows.map((r) => r.reviewer)).toEqual(['reliable', 'spotty']);
    expect(rows[0]?.pctUnderSla).toBe(100);
  });

  it('breaks ties on equal SLA rate by lower median turnaround', () => {
    const rows = buildLeaderboard(
      [...reviews('snappy', [1, 1, 1]), ...reviews('steady', [3, 3, 3])],
      { now: NOW, minSamples: 3, slaHours: 4 },
    );
    expect(rows.map((r) => r.reviewer)).toEqual(['snappy', 'steady']);
  });

  it('breaks remaining ties by higher count, then login', () => {
    const rows = buildLeaderboard(
      [...reviews('zoe', [2, 2, 2]), ...reviews('amy', [2, 2, 2]), ...reviews('vol', [2, 2, 2, 2])],
      { now: NOW, minSamples: 3, slaHours: 4 },
    );
    // vol wins on count; amy precedes zoe alphabetically.
    expect(rows.map((r) => r.reviewer)).toEqual(['vol', 'amy', 'zoe']);
  });

  it('reports per-reviewer count, median, fast count, and SLA rate', () => {
    const [row] = buildLeaderboard(reviews('carol', [1, 1.5, 3]), {
      now: NOW,
      minSamples: 3,
      slaHours: 4,
      fastHours: 2,
    });
    expect(row?.count).toBe(3);
    expect(row?.medianTat).toBe(1.5);
    expect(row?.fastCount).toBe(2); // 1 and 1.5 are under 2h
    expect(row?.pctUnderSla).toBe(100);
  });

  it('ignores samples outside the window', () => {
    const rows = buildLeaderboard(
      [
        ...reviews('carol', [1, 1, 1]),
        review('carol', 1, 'phab', '2026-01-01T13:00:00Z'), // outside 30d
      ],
      { now: NOW, minSamples: 3, windowDays: 30 },
    );
    expect(rows[0]?.count).toBe(3);
  });

  it('keeps the same login separate per source', () => {
    const rows = buildLeaderboard(
      [...reviews('dana', [1, 1, 1], 'phab'), ...reviews('dana', [2, 2, 2], 'github')],
      { now: NOW, minSamples: 3 },
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(['phab', 'github']));
  });
});
