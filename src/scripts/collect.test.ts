import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  asBusinessHours,
  asIanaTimezone,
  asIsoTimestamp,
  asPrNumber,
  asReviewerLogin,
  asRevisionPhid,
} from '../types/brand';

import {
  backlogSnapshotSchema,
  collect,
  computeBacklogSnapshot,
  historyRowSchema,
  landingSchema,
  loadPhabProgress,
  PHAB_PROGRESS_SCHEMA_VERSION,
  prunePhabCache,
  sampleSchema,
  type BacklogSnapshot,
  type HistoryRow,
  type Landing,
  type Sample,
} from './collect';
import type { GithubLanding, GithubPendingSample, GithubSample } from './github';
import type { PeopleMap } from './people';
import type { PhabLanding, PhabPendingSample, PhabSample, PhabTransaction } from './phabricator';

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
// collect() expects ({ samples, pending, landings }). Most collect() tests
// don't care about pending or landings, so they pass [] for those by default.
const phabResult = (
  samples: readonly PhabSample[] = [],
  pending: readonly PhabPendingSample[] = [],
  landings: readonly PhabLanding[] = [],
): {
  samples: readonly PhabSample[];
  pending: readonly PhabPendingSample[];
  landings: readonly PhabLanding[];
} => ({
  samples,
  pending,
  landings,
});
const ghResult = (
  samples: readonly GithubSample[] = [],
  pending: readonly GithubPendingSample[] = [],
  landings: readonly GithubLanding[] = [],
): {
  samples: readonly GithubSample[];
  pending: readonly GithubPendingSample[];
  landings: readonly GithubLanding[];
} => ({
  samples,
  pending,
  landings,
});

describe('collect', () => {
  it('uses the backfill lookback when no existing samples', async () => {
    const fetchPhab = vi.fn(async () => ({ samples: [], pending: [], landings: [] }));
    const fetchGithub = vi.fn(async () => ({ samples: [], pending: [], landings: [] }));

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

  it('uses a 3-day lookback when both samples and landings already exist', async () => {
    const existing: Sample[] = [{ ...makePhabSample(), tatBusinessHours: asBusinessHours(2) }];
    const existingLanding: Landing = {
      source: 'phab',
      id: asRevisionPhid('PHID-DREV-zzzzzzzzzzzzzzzzzzzz'),
      revisionId: 9,
      createdAt: asIsoTimestamp('2026-04-10T12:00:00Z'),
      firstReviewAt: null,
      landedAt: asIsoTimestamp('2026-04-12T12:00:00Z'),
      reviewRounds: 1,
      cycleBusinessHours: asBusinessHours(16),
      postReviewBusinessHours: null,
    };
    const fetchPhab = vi.fn(async () => ({ samples: [], pending: [], landings: [] }));
    const fetchGithub = vi.fn(async () => ({ samples: [], pending: [], landings: [] }));

    const result = await collect({
      existingSamples: existing,
      existingLandings: [existingLanding],
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
        author: asReviewerLogin('mel-author'),
        reviewer: asReviewerLogin('mel-reviewer'),
        requestedAt: asIsoTimestamp('2026-06-01T00:00:00Z'),
        firstActionAt: asIsoTimestamp('2026-06-01T02:00:00Z'),
      }),
      tatBusinessHours: asBusinessHours(0),
    };
    const peopleMap: PeopleMap = {
      github: {
        'mel-author': asIanaTimezone('Australia/Melbourne'),
        'mel-reviewer': asIanaTimezone('Australia/Melbourne'),
      },
      phab: {},
    };
    const fetchPhab = vi.fn(async () => ({ samples: [], pending: [], landings: [] }));
    const fetchGithub = vi.fn(async () => ({ samples: [], pending: [], landings: [] }));

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
    const fetchPhab = vi.fn(async () => ({ samples: [], pending: [], landings: [] }));
    const fetchGithub = vi.fn(async () => ({ samples: [], pending: [], landings: [] }));

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

  describe('team-membership purge on existing samples and landings', () => {
    const peopleMap: PeopleMap = {
      github: {
        'team-member-a': asIanaTimezone('America/New_York'),
        'team-member-b': asIanaTimezone('America/New_York'),
      },
      phab: {
        alice: asIanaTimezone('America/New_York'),
        bob: asIanaTimezone('America/New_York'),
      },
    };

    it('drops legacy github samples whose author is not in peopleMap.github', async () => {
      const existing: Sample[] = [
        {
          ...makeGhSample({
            id: asPrNumber(1),
            author: asReviewerLogin('external-contributor'),
            reviewer: asReviewerLogin('team-member-a'),
          }),
          tatBusinessHours: asBusinessHours(2),
        },
        {
          ...makeGhSample({
            id: asPrNumber(2),
            author: asReviewerLogin('team-member-a'),
            reviewer: asReviewerLogin('team-member-b'),
          }),
          tatBusinessHours: asBusinessHours(2),
        },
      ];
      const result = await collect({
        existingSamples: existing,
        existingHistory: [],
        fetchPhab: vi.fn(async () => phabResult()),
        fetchGithub: vi.fn(async () => ghResult()),
        peopleMap,
        now: new Date('2026-04-20T13:00:00Z'),
      });
      expect(result.samples.map((s) => s.id)).toEqual([2]);
    });

    it('drops legacy github samples whose reviewer is not in peopleMap.github', async () => {
      const existing: Sample[] = [
        {
          ...makeGhSample({
            id: asPrNumber(3),
            author: asReviewerLogin('team-member-a'),
            reviewer: asReviewerLogin('external-reviewer'),
          }),
          tatBusinessHours: asBusinessHours(2),
        },
      ];
      const result = await collect({
        existingSamples: existing,
        existingHistory: [],
        fetchPhab: vi.fn(async () => phabResult()),
        fetchGithub: vi.fn(async () => ghResult()),
        peopleMap,
        now: new Date('2026-04-20T13:00:00Z'),
      });
      expect(result.samples).toEqual([]);
    });

    it('drops legacy samples with no author field (cannot verify team membership)', async () => {
      const existing: Sample[] = [
        {
          ...makeGhSample({ id: asPrNumber(4), reviewer: asReviewerLogin('team-member-a') }),
          tatBusinessHours: asBusinessHours(2),
        },
      ];
      expect(existing[0]?.author).toBeUndefined();
      const result = await collect({
        existingSamples: existing,
        existingHistory: [],
        fetchPhab: vi.fn(async () => phabResult()),
        fetchGithub: vi.fn(async () => ghResult()),
        peopleMap,
        now: new Date('2026-04-20T13:00:00Z'),
      });
      expect(result.samples).toEqual([]);
    });

    it('drops legacy phab samples whose author is not in peopleMap.phab', async () => {
      const existing: Sample[] = [
        {
          ...makePhabSample({
            id: asRevisionPhid('PHID-DREV-offteamauthor11111xx'),
            author: asReviewerLogin('outsider'),
            reviewer: asReviewerLogin('alice'),
          }),
          tatBusinessHours: asBusinessHours(2),
        },
        {
          ...makePhabSample({
            id: asRevisionPhid('PHID-DREV-teamauthor22222xxxxx'),
            author: asReviewerLogin('alice'),
            reviewer: asReviewerLogin('bob'),
          }),
          tatBusinessHours: asBusinessHours(2),
        },
      ];
      const result = await collect({
        existingSamples: existing,
        existingHistory: [],
        fetchPhab: vi.fn(async () => phabResult()),
        fetchGithub: vi.fn(async () => ghResult()),
        peopleMap,
        now: new Date('2026-04-20T13:00:00Z'),
      });
      expect(result.samples.map((s) => s.id)).toEqual(['PHID-DREV-teamauthor22222xxxxx']);
    });

    it('drops legacy landings whose author is not on the team', async () => {
      const existingLandings: Landing[] = [
        {
          source: 'github',
          id: asPrNumber(100),
          author: asReviewerLogin('external-contributor'),
          createdAt: asIsoTimestamp('2026-04-15T10:00:00Z'),
          firstReviewAt: asIsoTimestamp('2026-04-15T12:00:00Z'),
          landedAt: asIsoTimestamp('2026-04-16T10:00:00Z'),
          reviewRounds: 1,
          cycleBusinessHours: asBusinessHours(8),
          postReviewBusinessHours: asBusinessHours(4),
        },
        {
          source: 'github',
          id: asPrNumber(101),
          author: asReviewerLogin('team-member-a'),
          createdAt: asIsoTimestamp('2026-04-15T10:00:00Z'),
          firstReviewAt: asIsoTimestamp('2026-04-15T12:00:00Z'),
          landedAt: asIsoTimestamp('2026-04-16T10:00:00Z'),
          reviewRounds: 1,
          cycleBusinessHours: asBusinessHours(8),
          postReviewBusinessHours: asBusinessHours(4),
        },
      ];
      const result = await collect({
        existingSamples: [
          {
            ...makeGhSample({
              author: asReviewerLogin('team-member-a'),
              reviewer: asReviewerLogin('team-member-b'),
            }),
            tatBusinessHours: asBusinessHours(2),
          },
        ],
        existingLandings,
        existingHistory: [],
        fetchPhab: vi.fn(async () => phabResult()),
        fetchGithub: vi.fn(async () => ghResult()),
        peopleMap,
        now: new Date('2026-04-20T13:00:00Z'),
      });
      expect(result.landings.map((l) => l.id)).toEqual([101]);
    });
  });
});

const tx = (phid: string): PhabTransaction => ({
  id: 1,
  phid,
  type: 'comment',
  authorPhid: 'PHID-USER-aaaaaaaaaaaaaaaaaaaa',
  dateCreated: 1_760_000_000,
  fields: {},
});

const makeCache = (
  entries: readonly (readonly [string, readonly PhabTransaction[]])[],
): ReadonlyMap<string, readonly PhabTransaction[]> => new Map(entries);

const makePhabLanding = (overrides: Partial<PhabLanding> = {}): PhabLanding => ({
  source: 'phab',
  id: asRevisionPhid('PHID-DREV-abcdefghijklmnopqrst'),
  revisionId: 234_567,
  author: asReviewerLogin('author-user'),
  createdAt: asIsoTimestamp('2026-04-19T14:00:00Z'),
  firstReviewAt: asIsoTimestamp('2026-04-19T16:00:00Z'),
  landedAt: asIsoTimestamp('2026-04-19T18:00:00Z'),
  reviewRounds: 1,
  ...overrides,
});

const makeGhLanding = (overrides: Partial<GithubLanding> = {}): GithubLanding => ({
  source: 'github',
  id: asPrNumber(42),
  author: asReviewerLogin('author-user'),
  createdAt: asIsoTimestamp('2026-04-19T14:00:00Z'),
  firstReviewAt: asIsoTimestamp('2026-04-19T16:00:00Z'),
  landedAt: asIsoTimestamp('2026-04-19T18:00:00Z'),
  reviewRounds: 1,
  ...overrides,
});

describe('collect landings', () => {
  it('attaches cycleBusinessHours and postReviewBusinessHours computed from author timezone', async () => {
    // Mon 2026-04-20 ET 10:00 → 12:00 = 2 business hours
    // 10:00 ET = 14:00 UTC; 12:00 ET = 16:00 UTC
    const fetchPhab = vi.fn(async () =>
      phabResult(
        [],
        [],
        [
          makePhabLanding({
            createdAt: asIsoTimestamp('2026-04-20T14:00:00Z'),
            firstReviewAt: asIsoTimestamp('2026-04-20T15:00:00Z'),
            landedAt: asIsoTimestamp('2026-04-20T16:00:00Z'),
          }),
        ],
      ),
    );
    const fetchGithub = vi.fn(async () => ghResult());

    const result = await collect({
      existingSamples: [],
      existingLandings: [],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T18:00:00Z'),
    });

    expect(result.landings).toHaveLength(1);
    // Mon 10:00 ET → 12:00 ET = 2 business hours
    expect(result.landings[0]?.cycleBusinessHours).toBeCloseTo(2, 5);
    // Mon 11:00 ET → 12:00 ET = 1 business hour
    expect(result.landings[0]?.postReviewBusinessHours).toBeCloseTo(1, 5);
  });

  it('sets postReviewBusinessHours to null when firstReviewAt is null', async () => {
    const fetchPhab = vi.fn(async () => phabResult());
    const fetchGithub = vi.fn(async () =>
      ghResult([], [], [makeGhLanding({ firstReviewAt: null })]),
    );

    const result = await collect({
      existingSamples: [],
      existingLandings: [],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T18:00:00Z'),
    });

    expect(result.landings[0]?.firstReviewAt).toBeNull();
    expect(result.landings[0]?.postReviewBusinessHours).toBeNull();
  });

  it('dedupes landings by (source, id) — fresh extraction wins', async () => {
    const existing: Landing = {
      ...makePhabLanding({ reviewRounds: 5 }),
      cycleBusinessHours: asBusinessHours(99),
      postReviewBusinessHours: asBusinessHours(88),
    };
    const fetchPhab = vi.fn(async () => phabResult([], [], [makePhabLanding({ reviewRounds: 2 })]));
    const fetchGithub = vi.fn(async () => ghResult());

    const result = await collect({
      existingSamples: [],
      existingLandings: [existing],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T18:00:00Z'),
    });

    expect(result.landings).toHaveLength(1);
    expect(result.landings[0]?.reviewRounds).toBe(2);
  });

  it('prunes landings older than the 90-day retention window (by landedAt)', async () => {
    // now = 2026-04-20T13:00:00Z → 90-day cutoff ≈ 2026-01-21 ET.
    const staleLanding: Landing = {
      ...makeGhLanding({
        id: asPrNumber(1),
        landedAt: asIsoTimestamp('2025-12-01T12:00:00Z'),
      }),
      cycleBusinessHours: asBusinessHours(10),
      postReviewBusinessHours: asBusinessHours(5),
    };
    const freshLanding: Landing = {
      ...makeGhLanding({ id: asPrNumber(2), landedAt: asIsoTimestamp('2026-04-19T16:00:00Z') }),
      cycleBusinessHours: asBusinessHours(2),
      postReviewBusinessHours: asBusinessHours(1),
    };
    const fetchPhab = vi.fn(async () => phabResult());
    const fetchGithub = vi.fn(async () => ghResult());

    const result = await collect({
      existingSamples: [],
      existingLandings: [staleLanding, freshLanding],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T13:00:00Z'),
    });

    expect(result.landings.map((l) => l.id)).toEqual([2]);
  });

  it('populates phabCycle, phabPostReview, and phabRounds windows in the history row', async () => {
    // Three landings in the 7-day window, all on Mon 2026-04-20 ET.
    // Cycle times: 1h, 2h, 3h. Rounds: 1, 2, 3. PostReview: 0.5h, 1h, 1.5h.
    const fetchPhab = vi.fn(async () =>
      phabResult(
        [],
        [],
        [
          makePhabLanding({
            id: asRevisionPhid('PHID-DREV-aaaaaaaaaaaaaaaaaaaa'),
            createdAt: asIsoTimestamp('2026-04-20T14:00:00Z'),
            firstReviewAt: asIsoTimestamp('2026-04-20T14:30:00Z'),
            landedAt: asIsoTimestamp('2026-04-20T15:00:00Z'),
            reviewRounds: 1,
          }),
          makePhabLanding({
            id: asRevisionPhid('PHID-DREV-bbbbbbbbbbbbbbbbbbbb'),
            createdAt: asIsoTimestamp('2026-04-20T14:00:00Z'),
            firstReviewAt: asIsoTimestamp('2026-04-20T15:00:00Z'),
            landedAt: asIsoTimestamp('2026-04-20T16:00:00Z'),
            reviewRounds: 2,
          }),
          makePhabLanding({
            id: asRevisionPhid('PHID-DREV-cccccccccccccccccccc'),
            createdAt: asIsoTimestamp('2026-04-20T14:00:00Z'),
            firstReviewAt: asIsoTimestamp('2026-04-20T15:30:00Z'),
            landedAt: asIsoTimestamp('2026-04-20T17:00:00Z'),
            reviewRounds: 3,
          }),
        ],
      ),
    );
    const fetchGithub = vi.fn(async () => ghResult());

    const result = await collect({
      existingSamples: [],
      existingLandings: [],
      existingHistory: [],
      fetchPhab,
      fetchGithub,
      now: new Date('2026-04-20T18:00:00Z'),
    });

    const latest = result.history.at(-1);
    expect(latest?.phabCycle?.window7d.n).toBe(3);
    expect(latest?.phabCycle?.window7d.mean).toBeCloseTo(2, 5);
    expect(latest?.phabPostReview?.window7d.n).toBe(3);
    expect(latest?.phabPostReview?.window7d.mean).toBeCloseTo(1, 5);
    expect(latest?.phabRounds?.window7d.n).toBe(3);
    expect(latest?.phabRounds?.window7d.mean).toBeCloseTo(2, 5);
    // ROUNDS_SLA = 1, so pctUnderSLA = % with rounds <= 1 = 33.33...
    expect(latest?.phabRounds?.window7d.pctUnderSLA).toBeCloseTo(33.33, 1);
  });
});

describe('computeBacklogSnapshot', () => {
  const now = new Date('2026-04-22T19:00:00Z'); // Wed 15:00 ET

  it('returns zeros when there are no pending samples', () => {
    const snapshot = computeBacklogSnapshot([], now);
    expect(snapshot.phab.openCount).toBe(0);
    expect(snapshot.github.openCount).toBe(0);
    expect(snapshot.phab.oldestBusinessHours).toBe(0);
    expect(snapshot.github.p90BusinessHours).toBe(0);
  });

  it('splits counts by source', () => {
    const phabPending: PhabPendingSample = {
      source: 'phab',
      id: asRevisionPhid('PHID-DREV-aaaaaaaaaaaaaaaaaaaa'),
      revisionId: 1,
      reviewer: asReviewerLogin('alice'),
      requestedAt: asIsoTimestamp('2026-04-22T17:00:00Z'), // 1h old at Wed 15:00 ET
    };
    const gh1: GithubPendingSample = {
      source: 'github',
      id: asPrNumber(1),
      reviewer: asReviewerLogin('bob'),
      requestedAt: asIsoTimestamp('2026-04-22T17:00:00Z'),
    };
    const gh2: GithubPendingSample = {
      source: 'github',
      id: asPrNumber(2),
      reviewer: asReviewerLogin('carol'),
      requestedAt: asIsoTimestamp('2026-04-22T18:00:00Z'),
    };
    const snapshot = computeBacklogSnapshot([phabPending, gh1, gh2], now);
    expect(snapshot.phab.openCount).toBe(1);
    expect(snapshot.github.openCount).toBe(2);
  });

  it('reports the oldest business-hours age for each source', () => {
    // Oldest Phab pending: Wed 09:00 ET (2026-04-22T13:00Z), now Wed 15:00 ET = 6 bh.
    const older: PhabPendingSample = {
      source: 'phab',
      id: asRevisionPhid('PHID-DREV-aaaaaaaaaaaaaaaaaaaa'),
      revisionId: 1,
      reviewer: asReviewerLogin('alice'),
      requestedAt: asIsoTimestamp('2026-04-22T13:00:00Z'),
    };
    const newer: PhabPendingSample = {
      source: 'phab',
      id: asRevisionPhid('PHID-DREV-bbbbbbbbbbbbbbbbbbbb'),
      revisionId: 2,
      reviewer: asReviewerLogin('bob'),
      requestedAt: asIsoTimestamp('2026-04-22T18:00:00Z'), // 1 bh old
    };
    const snapshot = computeBacklogSnapshot([older, newer], now);
    expect(snapshot.phab.oldestBusinessHours).toBeCloseTo(6, 5);
  });
});

describe('backlogSnapshotSchema', () => {
  it('parses a valid snapshot', () => {
    const raw = {
      date: '2026-04-22',
      phab: { openCount: 3, oldestBusinessHours: 12.5, p90BusinessHours: 10 },
      github: { openCount: 0, oldestBusinessHours: 0, p90BusinessHours: 0 },
    };
    const parsed: BacklogSnapshot = backlogSnapshotSchema.parse(raw);
    expect(parsed.phab.openCount).toBe(3);
    expect(parsed.github.openCount).toBe(0);
  });

  it('rejects a negative openCount', () => {
    expect(() =>
      backlogSnapshotSchema.parse({
        date: '2026-04-22',
        phab: { openCount: -1, oldestBusinessHours: 0, p90BusinessHours: 0 },
        github: { openCount: 0, oldestBusinessHours: 0, p90BusinessHours: 0 },
      }),
    ).toThrow();
  });
});

describe('landingSchema', () => {
  const validPhabLanding = {
    source: 'phab' as const,
    id: 'PHID-DREV-abcdefghijklmnopqrst',
    revisionId: 234_567,
    author: 'alice',
    createdAt: '2026-04-10T12:00:00Z',
    firstReviewAt: '2026-04-11T14:00:00Z',
    landedAt: '2026-04-12T18:00:00Z',
    cycleBusinessHours: 12.5,
    postReviewBusinessHours: 5.25,
    reviewRounds: 2,
  };

  const validGithubLanding = {
    source: 'github' as const,
    id: 42,
    author: 'bob',
    createdAt: '2026-04-10T12:00:00Z',
    firstReviewAt: '2026-04-11T14:00:00Z',
    landedAt: '2026-04-12T18:00:00Z',
    cycleBusinessHours: 8,
    postReviewBusinessHours: 4,
    reviewRounds: 1,
  };

  it('parses a valid phab landing', () => {
    const parsed: Landing = landingSchema.parse(validPhabLanding);
    expect(parsed.source).toBe('phab');
    expect(parsed.id).toBe('PHID-DREV-abcdefghijklmnopqrst');
    expect(parsed.cycleBusinessHours).toBe(12.5);
    expect(parsed.postReviewBusinessHours).toBe(5.25);
    expect(parsed.reviewRounds).toBe(2);
  });

  it('parses a valid github landing', () => {
    const parsed: Landing = landingSchema.parse(validGithubLanding);
    expect(parsed.source).toBe('github');
    expect(parsed.id).toBe(42);
    expect(parsed.reviewRounds).toBe(1);
  });

  it('accepts a merged-without-review landing with null firstReviewAt and null postReviewBusinessHours', () => {
    const noReview = {
      ...validGithubLanding,
      firstReviewAt: null,
      postReviewBusinessHours: null,
    };
    const parsed = landingSchema.parse(noReview);
    expect(parsed.firstReviewAt).toBeNull();
    expect(parsed.postReviewBusinessHours).toBeNull();
  });

  it('accepts a phab landing without an author (outside-roster patch)', () => {
    const noAuthor: Record<string, unknown> = { ...validPhabLanding };
    delete noAuthor.author;
    const parsed = landingSchema.parse(noAuthor);
    expect(parsed.source).toBe('phab');
    expect(parsed.author).toBeUndefined();
  });

  it('rejects a landing missing landedAt', () => {
    const missing: Record<string, unknown> = { ...validGithubLanding };
    delete missing.landedAt;
    expect(() => landingSchema.parse(missing)).toThrow();
  });

  it('rejects a negative reviewRounds', () => {
    expect(() => landingSchema.parse({ ...validGithubLanding, reviewRounds: -1 })).toThrow();
  });

  it('rejects a negative cycleBusinessHours', () => {
    expect(() =>
      landingSchema.parse({ ...validGithubLanding, cycleBusinessHours: -0.5 }),
    ).toThrow();
  });

  it('rejects a landing with firstReviewAt but null postReviewBusinessHours', () => {
    expect(() =>
      landingSchema.parse({ ...validGithubLanding, postReviewBusinessHours: null }),
    ).toThrow();
  });
});

describe('loadPhabProgress', () => {
  let temporaryDirectory: string;
  let progressPath: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'phab-progress-'));
    progressPath = path.join(temporaryDirectory, '.phab-progress.json');
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  const cachedPayload = {
    lookbackDays: 45,
    createdAt: '2026-04-23T02:49:00.000Z',
    transactionsByRevisionPhid: {
      'PHID-DREV-example12345678abcdef': [
        {
          id: 1,
          phid: 'PHID-XACT-example1',
          type: 'status',
          authorPhid: 'PHID-USER-author',
          dateCreated: 1_714_000_000,
          fields: { old: 'needs-review', new: 'published' },
        },
      ],
    },
  };

  it('returns an empty cache when the on-disk file has no schemaVersion (legacy stale cache)', async () => {
    // Mirrors the pre-hardening shape that shipped up through a19dec4: no
    // schemaVersion field. The loader should treat this as invalid and
    // return an empty cache so the next run rebuilds from scratch.
    await fs.writeFile(progressPath, JSON.stringify(cachedPayload), 'utf8');
    const now = new Date('2026-04-23T03:00:00Z');
    const { transactions } = await loadPhabProgress(progressPath, 45, now);
    expect(transactions.size).toBe(0);
  });

  it('returns an empty cache when schemaVersion does not match the current constant', async () => {
    const mismatch = { ...cachedPayload, schemaVersion: PHAB_PROGRESS_SCHEMA_VERSION + 1 };
    await fs.writeFile(progressPath, JSON.stringify(mismatch), 'utf8');
    const now = new Date('2026-04-23T03:00:00Z');
    const { transactions } = await loadPhabProgress(progressPath, 45, now);
    expect(transactions.size).toBe(0);
  });

  it('returns the cached transactions when schemaVersion, lookbackDays, and TTL all match', async () => {
    const current = { ...cachedPayload, schemaVersion: PHAB_PROGRESS_SCHEMA_VERSION };
    await fs.writeFile(progressPath, JSON.stringify(current), 'utf8');
    const now = new Date('2026-04-23T03:00:00Z');
    const { transactions } = await loadPhabProgress(progressPath, 45, now);
    expect(transactions.size).toBe(1);
    const txs = transactions.get('PHID-DREV-example12345678abcdef');
    expect(txs).toBeDefined();
    expect(txs?.[0]?.fields.new).toBe('published');
  });

  it('pins the current schemaVersion constant to 2 (bump intentionally)', () => {
    // Guard against accidental bumps during unrelated refactors. Bumping this
    // constant is a deliberate action that invalidates every on-disk cache.
    expect(PHAB_PROGRESS_SCHEMA_VERSION).toBe(2);
  });
});

describe('prunePhabCache', () => {
  it('returns an empty map when the seen set is empty', () => {
    const cache = makeCache([['PHID-DREV-one', [tx('PHID-XACT-1')]]]);
    expect(prunePhabCache(new Set(), cache).size).toBe(0);
  });

  it('drops cache entries whose phid is not in the seen set', () => {
    const cache = makeCache([
      ['PHID-DREV-kept', [tx('PHID-XACT-1')]],
      ['PHID-DREV-dropped', [tx('PHID-XACT-2')]],
    ]);
    const pruned = prunePhabCache(new Set(['PHID-DREV-kept']), cache);
    expect([...pruned.keys()]).toEqual(['PHID-DREV-kept']);
  });

  it('ignores seen phids that have no cache entry yet', () => {
    const cache = makeCache([['PHID-DREV-cached', [tx('PHID-XACT-1')]]]);
    const pruned = prunePhabCache(new Set(['PHID-DREV-cached', 'PHID-DREV-brand-new']), cache);
    expect([...pruned.keys()]).toEqual(['PHID-DREV-cached']);
  });
});
