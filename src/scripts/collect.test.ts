import { describe, expect, it, vi } from 'vitest';

import {
  asBusinessHours,
  asIanaTimezone,
  asIsoTimestamp,
  asPrNumber,
  asReviewerLogin,
  asRevisionPhid,
} from '../types/brand';

import { collect, historyRowSchema, sampleSchema, type HistoryRow, type Sample } from './collect';
import type { GithubPendingSample, GithubSample } from './github';
import type { PeopleMap } from './people';
import type { PhabPendingSample, PhabSample } from './phabricator';

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

// Test helpers: wrap a bare samples array in the fetch result shape that
// collect() now expects ({ samples, pending }). Most collect() tests don't
// care about pending, so they pass [] for it by default.
const phabResult = (
  samples: readonly PhabSample[] = [],
  pending: readonly PhabPendingSample[] = [],
): { samples: readonly PhabSample[]; pending: readonly PhabPendingSample[] } => ({
  samples,
  pending,
});
const ghResult = (
  samples: readonly GithubSample[] = [],
  pending: readonly GithubPendingSample[] = [],
): { samples: readonly GithubSample[]; pending: readonly GithubPendingSample[] } => ({
  samples,
  pending,
});

describe('collect', () => {
  it('uses the backfill lookback when no existing samples', async () => {
    const fetchPhab = vi.fn(async () => ({ samples: [], pending: [] }));
    const fetchGithub = vi.fn(async () => ({ samples: [], pending: [] }));

    const result = await collect({
      existingSamples: [],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T13:00:00Z'),
    });

    expect(fetchPhab).toHaveBeenCalledWith(45);
    expect(fetchGithub).toHaveBeenCalledWith(45);
    expect(result.lookbackDays).toBe(45);
  });

  it('uses a 3-day lookback when samples already exist', async () => {
    const existing: Sample[] = [{ ...makePhabSample(), tatBusinessHours: asBusinessHours(2) }];
    const fetchPhab = vi.fn(async () => ({ samples: [], pending: [] }));
    const fetchGithub = vi.fn(async () => ({ samples: [], pending: [] }));

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
    const fetchPhab = vi.fn(async () =>
      phabResult([
        makePhabSample({
          requestedAt: asIsoTimestamp('2026-04-20T14:00:00Z'),
          firstActionAt: asIsoTimestamp('2026-04-20T16:00:00Z'),
        }),
      ]),
    );
    const fetchGithub = vi.fn(async () => ghResult());

    const result = await collect({
      existingSamples: [],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T18:00:00Z'),
    });

    expect(result.samples[0]?.tatBusinessHours).toBeCloseTo(2, 5);
  });

  it('recomputes tatBusinessHours on every run so peopleMap edits propagate to existing samples', async () => {
    // Existing sample has tatBusinessHours=0 cached (was computed in ET against a Sunday UTC span).
    const existing: Sample = {
      ...makeGhSample({
        reviewer: asReviewerLogin('mel-reviewer'),
        requestedAt: asIsoTimestamp('2026-06-01T00:00:00Z'),
        firstActionAt: asIsoTimestamp('2026-06-01T02:00:00Z'),
      }),
      tatBusinessHours: asBusinessHours(0),
    };
    const peopleMap: PeopleMap = {
      github: { 'mel-reviewer': asIanaTimezone('Australia/Melbourne') },
      phab: {},
    };
    const fetchPhab = vi.fn(async () => ({ samples: [], pending: [] }));
    const fetchGithub = vi.fn(async () => ({ samples: [], pending: [] }));

    const result = await collect({
      existingSamples: [existing],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      peopleMap,
      now: new Date('2026-06-01T12:00:00Z'),
    });

    // Melbourne: 10:00-12:00 Mon = 2h business hours; recomputed on read.
    expect(result.samples[0]?.tatBusinessHours).toBeCloseTo(2, 5);
  });

  it('deduplicates samples by (source, id, reviewer) — fresh extraction wins so extractor bug fixes self-heal', async () => {
    // Prior sample had an incorrect firstActionAt (18:00) and stale cached TAT (4h)
    // captured by an older extractor.
    const existing: Sample[] = [
      {
        ...makePhabSample({
          firstActionAt: asIsoTimestamp('2026-04-19T18:00:00Z'),
        }),
        tatBusinessHours: asBusinessHours(4),
      },
    ];
    // Re-extraction finds the correct, earlier first-action timestamp (16:00).
    const fetchPhab = vi.fn(async () =>
      phabResult([
        makePhabSample({
          requestedAt: asIsoTimestamp('2026-04-19T14:00:00Z'),
          firstActionAt: asIsoTimestamp('2026-04-19T16:00:00Z'),
        }),
      ]),
    );
    const fetchGithub = vi.fn(async () => ghResult());

    const result = await collect({
      existingSamples: existing,
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T13:00:00Z'),
    });

    expect(result.samples).toHaveLength(1);
    // Fresh wins for every field on the sample shape.
    expect(result.samples[0]).toMatchObject({
      source: 'phab',
      id: 'PHID-DREV-abcdefghijklmnopqrst',
      reviewer: 'alice',
      requestedAt: '2026-04-19T14:00:00Z',
      firstActionAt: '2026-04-19T16:00:00Z',
    });
    // tatBusinessHours is recomputed from the fresh timestamps (2h, ET business
    // hours on Sun 2026-04-19 14:00-16:00 UTC = Sun 10-12 ET, but Sunday is a
    // weekend — so 0 business hours). The stale cached value 4h is discarded.
    expect(result.samples[0]?.tatBusinessHours).toBe(0);
  });

  it('prunes samples strictly before the 90-day ET cutoff but keeps ones at or after it', async () => {
    // For now = 2026-04-20T13:00:00Z (Mon 09:00 ET), the 90-day ET cutoff is
    // startOfDay(ET, 2026-04-20) - 89 days = 2026-01-21 00:00 ET = 2026-01-21T05:00:00Z.
    // A naive "now - 90*86400000 ms" retention gives a different cutoff (2026-01-20T13:00Z),
    // so these boundary assertions would fail under the broken implementation.
    const now = new Date('2026-04-20T13:00:00Z');
    const atCutoff: Sample = {
      ...makePhabSample({
        id: asRevisionPhid('PHID-DREV-yyyyyyyyyyyyyyyyyyyy'),
        requestedAt: asIsoTimestamp('2026-01-21T05:00:00Z'), // exactly at ET cutoff
        firstActionAt: asIsoTimestamp('2026-01-21T06:00:00Z'),
      }),
      tatBusinessHours: asBusinessHours(1),
    };
    const justBeforeCutoff: Sample = {
      ...makePhabSample({
        id: asRevisionPhid('PHID-DREV-zzzzzzzzzzzzzzzzzzzz'),
        requestedAt: asIsoTimestamp('2026-01-21T04:59:59Z'), // 1s before ET cutoff
        firstActionAt: asIsoTimestamp('2026-01-21T05:59:59Z'),
      }),
      tatBusinessHours: asBusinessHours(1),
    };

    const result = await collect({
      existingSamples: [justBeforeCutoff, atCutoff],
      existingHistory: [],
      fetchPhab: vi.fn(async () => phabResult()),
      fetchGithub: vi.fn(async () => ghResult()),
      now,
    });

    expect(result.samples).toHaveLength(1);
    expect(result.samples.map((s) => s.id)).toEqual(['PHID-DREV-yyyyyyyyyyyyyyyyyyyy']);
  });

  it('appends today history row with 7d, 14d, and 30d windows per source', async () => {
    const fetchPhab = vi.fn(async () =>
      phabResult([
        makePhabSample({
          requestedAt: asIsoTimestamp('2026-04-19T14:00:00Z'),
          firstActionAt: asIsoTimestamp('2026-04-19T16:00:00Z'),
        }),
      ]),
    );
    const fetchGithub = vi.fn(async () => ghResult([makeGhSample()]));

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
    expect(result.history[0]?.phab.window14d.n).toBe(1);
    expect(result.history[0]?.phab.window30d.n).toBe(1);
    expect(result.history[0]?.github.window7d.n).toBe(1);
    expect(result.history[0]?.github.window14d.n).toBe(1);
    expect(result.history[0]?.github.window30d.n).toBe(1);
  });

  it('anchors the 7-day window on ET calendar days: includes today and the 6 prior ET days', async () => {
    // "now" is Tue 2026-04-21 18:00 ET. The 7-day window covers
    // Tue 2026-04-21 and the 6 prior ET calendar days (Wed 2026-04-15 through today).
    const fetchPhab = vi.fn(async () => phabResult());
    const fetchGithub = vi.fn(async () =>
      ghResult([
        // inside: Wed 2026-04-15 14:00 UTC = Wed 10:00 ET (the oldest day in range).
        makeGhSample({
          id: asPrNumber(101),
          requestedAt: asIsoTimestamp('2026-04-15T14:00:00Z'),
          firstActionAt: asIsoTimestamp('2026-04-15T15:00:00Z'),
        }),
        // outside: Tue 2026-04-14 14:00 UTC = Tue 10:00 ET (7 days prior to today — out of range).
        makeGhSample({
          id: asPrNumber(102),
          requestedAt: asIsoTimestamp('2026-04-14T14:00:00Z'),
          firstActionAt: asIsoTimestamp('2026-04-14T15:00:00Z'),
        }),
      ]),
    );

    const result = await collect({
      existingSamples: [],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-21T22:00:00Z'),
    });

    expect(result.history[0]?.github.window7d.n).toBe(1);
  });

  it('computes tatBusinessHours in the reviewer’s local timezone when a people map is provided', async () => {
    // Request at 2026-06-01T00:00:00Z, first action at +2h.
    // ET interprets this as Sun 20:00 → 22:00 (outside business hours → 0h).
    // Melbourne interprets it as Mon 10:00 → 12:00 (inside business hours → 2h).
    const peopleMap: PeopleMap = {
      github: { 'mel-reviewer': asIanaTimezone('Australia/Melbourne') },
      phab: {},
    };
    const fetchPhab = vi.fn(async () => phabResult());
    const fetchGithub = vi.fn(async () =>
      ghResult([
        makeGhSample({
          reviewer: asReviewerLogin('mel-reviewer'),
          requestedAt: asIsoTimestamp('2026-06-01T00:00:00Z'),
          firstActionAt: asIsoTimestamp('2026-06-01T02:00:00Z'),
        }),
      ]),
    );

    const result = await collect({
      existingSamples: [],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      peopleMap,
      now: new Date('2026-06-01T12:00:00Z'),
    });

    expect(result.samples[0]?.tatBusinessHours).toBeCloseTo(2, 5);
  });

  it('falls back to ET when no peopleMap is supplied (backwards-compat)', async () => {
    const fetchPhab = vi.fn(async () => phabResult());
    const fetchGithub = vi.fn(async () =>
      ghResult([
        makeGhSample({
          requestedAt: asIsoTimestamp('2026-06-01T00:00:00Z'),
          firstActionAt: asIsoTimestamp('2026-06-01T02:00:00Z'),
        }),
      ]),
    );

    const result = await collect({
      existingSamples: [],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-06-01T12:00:00Z'),
    });

    // ET: Sun 20:00 → 22:00 = 0 business hours.
    expect(result.samples[0]?.tatBusinessHours).toBe(0);
  });

  it('includes samples up to 30 days old in the 30-day window but not in 14d', async () => {
    // Requested 20 business-weekdays earlier: inside 30d, outside 14d.
    const fetchPhab = vi.fn(async () =>
      phabResult([
        makePhabSample({
          requestedAt: asIsoTimestamp('2026-03-25T14:00:00Z'),
          firstActionAt: asIsoTimestamp('2026-03-25T16:00:00Z'),
        }),
      ]),
    );
    const fetchGithub = vi.fn(async () => ghResult());

    const result = await collect({
      existingSamples: [],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T13:00:00Z'),
    });

    expect(result.history[0]?.phab.window14d.n).toBe(0);
    expect(result.history[0]?.phab.window30d.n).toBe(1);
  });

  it('replaces an existing row for the same date (idempotent)', async () => {
    const existingHistory: HistoryRow[] = [
      {
        date: '2026-04-20',
        phab: {
          window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
          window14d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
          window30d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        },
        github: {
          window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
          window14d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
          window30d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        },
      },
    ];
    const fetchPhab = vi.fn(async () => phabResult([makePhabSample()]));
    const fetchGithub = vi.fn(async () => ghResult());

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

  it('sampleSchema rejects a malformed record', () => {
    const bad = { source: 'github', id: -1, reviewer: '', requestedAt: 'not-a-date' };
    expect(() => sampleSchema.parse(bad)).toThrow();
  });

  it('sampleSchema accepts a valid persisted sample round-trip', () => {
    const good = {
      source: 'github',
      id: 42,
      reviewer: 'alice',
      requestedAt: '2026-04-19T14:00:00Z',
      firstActionAt: '2026-04-19T16:00:00Z',
      tatBusinessHours: 2,
    };
    expect(() => sampleSchema.parse(good)).not.toThrow();
  });

  it('historyRowSchema rejects a row missing window30d', () => {
    const bad = {
      date: '2026-04-20',
      phab: {
        window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        window14d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
      },
      github: {
        window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        window14d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
      },
    };
    expect(() => historyRowSchema.parse(bad)).toThrow();
  });

  it('window stats.n for a hand-counted fixture matches the hardcoded expected counts', async () => {
    // Independent oracle: the expected counts below are derived by hand from
    // the ET calendar. Tue 2026-04-21 is "today". 7-day window = 2026-04-15
    // through 2026-04-21 ET. 14-day = 2026-04-08+. 30-day = 2026-03-23+.
    const now = new Date('2026-04-21T22:00:00Z'); // Tue 18:00 ET
    const fetchPhab = vi.fn(async () => phabResult());
    const fetchGithub = vi.fn(async () =>
      ghResult([
        makeGhSample({
          id: asPrNumber(1),
          requestedAt: asIsoTimestamp('2026-04-21T14:00:00Z'), // Tue: 7d + 14d + 30d
          firstActionAt: asIsoTimestamp('2026-04-21T15:00:00Z'),
        }),
        makeGhSample({
          id: asPrNumber(2),
          requestedAt: asIsoTimestamp('2026-04-20T14:00:00Z'), // Mon: 7d + 14d + 30d
          firstActionAt: asIsoTimestamp('2026-04-20T15:00:00Z'),
        }),
        makeGhSample({
          id: asPrNumber(3),
          requestedAt: asIsoTimestamp('2026-04-16T14:00:00Z'), // 7d edge (Thu): 7d + 14d + 30d
          firstActionAt: asIsoTimestamp('2026-04-16T15:00:00Z'),
        }),
        makeGhSample({
          id: asPrNumber(4),
          requestedAt: asIsoTimestamp('2026-04-10T14:00:00Z'), // 14d + 30d only
          firstActionAt: asIsoTimestamp('2026-04-10T15:00:00Z'),
        }),
        makeGhSample({
          id: asPrNumber(5),
          requestedAt: asIsoTimestamp('2026-04-01T14:00:00Z'), // 30d only
          firstActionAt: asIsoTimestamp('2026-04-01T15:00:00Z'),
        }),
      ]),
    );

    const result = await collect({
      existingSamples: [],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now,
    });

    // Counts computed by hand against ET calendar days, not by re-running
    // the production predicate.
    expect(result.history[0]?.github.window7d.n).toBe(3);
    expect(result.history[0]?.github.window14d.n).toBe(4);
    expect(result.history[0]?.github.window30d.n).toBe(5);
  });

  it('preserves history rows from previous dates', async () => {
    const prior: HistoryRow = {
      date: '2026-04-19',
      phab: {
        window7d: { n: 5, median: 2, mean: 2, p90: 3, pctUnderSLA: 80 },
        window14d: { n: 5, median: 2, mean: 2, p90: 3, pctUnderSLA: 80 },
        window30d: { n: 5, median: 2, mean: 2, p90: 3, pctUnderSLA: 80 },
      },
      github: {
        window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        window14d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        window30d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
      },
    };
    const fetchPhab = vi.fn(async () => ({ samples: [], pending: [] }));
    const fetchGithub = vi.fn(async () => ({ samples: [], pending: [] }));

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

  it('passes pending through from fresh fetches to the result', async () => {
    const phabPending: PhabPendingSample = {
      source: 'phab',
      id: asRevisionPhid('PHID-DREV-pendingaaaaaaaaaaaaa'),
      revisionId: 789,
      reviewer: asReviewerLogin('charlie'),
      requestedAt: asIsoTimestamp('2026-04-19T14:00:00Z'),
    };
    const ghPending: GithubPendingSample = {
      source: 'github',
      id: asPrNumber(77),
      reviewer: asReviewerLogin('dave'),
      requestedAt: asIsoTimestamp('2026-04-18T14:00:00Z'),
    };
    const fetchPhab = vi.fn(async () => phabResult([], [phabPending]));
    const fetchGithub = vi.fn(async () => ghResult([], [ghPending]));

    const result = await collect({
      existingSamples: [],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T13:00:00Z'),
    });

    expect(result.pending).toHaveLength(2);
    expect(result.pending.map((p) => p.reviewer).sort()).toEqual(['charlie', 'dave']);
  });

  it('overwrites pending wholesale from each run (no merge with prior state)', async () => {
    // If a reviewer was pending last run but acted before this run, they drop
    // off the fresh fetch → they should NOT appear in this run's pending.
    // collect() has no access to a prior pending.json on disk; the overwrite
    // semantics live in how runCollectionFromDisk writes the file. Within
    // collect() itself, pending simply reflects the current fetch.
    const fetchPhab = vi.fn(async () => phabResult());
    const fetchGithub = vi.fn(async () => ghResult());

    const result = await collect({
      existingSamples: [],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T13:00:00Z'),
    });

    expect(result.pending).toEqual([]);
  });
});
