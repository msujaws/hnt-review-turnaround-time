import { describe, expect, it } from 'vitest';

import { asBugNumber, asIsoTimestamp } from '../types/brand';

import { backfillBugHistory, isRowFullyCovered } from './backfillBugHistory';
import type { BugSample } from './bugzilla';
import type { HistoryRow } from './collect';

const zero = { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 };
const emptyWindows = { window7d: zero, window14d: zero, window30d: zero };

const makeRow = (date: string, extra: Partial<HistoryRow> = {}): HistoryRow => ({
  date,
  phab: emptyWindows,
  github: emptyWindows,
  ...extra,
});

const makeBug = (id: number, filedAt: string, resolvedAt: string): BugSample => ({
  source: 'bugzilla',
  id: asBugNumber(id),
  summary: `bug ${String(id)}`,
  product: 'Firefox',
  component: 'New Tab Page',
  filedAt: asIsoTimestamp(filedAt),
  resolvedAt: asIsoTimestamp(resolvedAt),
});

// bugs.json holds 90 days of resolved bugs. A row's 30-day window is only fully
// inside that reach if the row is itself no older than 90 - 30 = 60 days.
const now = new Date('2026-08-14T12:00:00Z');

describe('isRowFullyCovered', () => {
  it('covers a row from today', () => {
    expect(isRowFullyCovered('2026-08-14', now)).toBe(true);
  });

  it('covers a row 59 days old', () => {
    expect(isRowFullyCovered('2026-06-16', now)).toBe(true);
  });

  it('does not cover a row 61 days old, whose 30-day window would be partial', () => {
    expect(isRowFullyCovered('2026-06-13', now)).toBe(false);
  });

  it('does not cover a row older than retention', () => {
    expect(isRowFullyCovered('2026-01-01', now)).toBe(false);
  });
});

describe('backfillBugHistory', () => {
  const bugs = [
    makeBug(1, '2026-07-01T00:00:00Z', '2026-07-10T00:00:00Z'),
    makeBug(2, '2026-07-20T00:00:00Z', '2026-07-24T00:00:00Z'),
    makeBug(3, '2026-08-01T00:00:00Z', '2026-08-13T00:00:00Z'),
  ];

  it('fills a covered row from the bug set', () => {
    const filled = backfillBugHistory([makeRow('2026-07-24')], bugs, now, 7);
    // As of 2026-07-24 the 7-day window holds only bug 2 (resolved that day).
    expect(filled[0]?.bugFix?.window7d.n).toBe(1);
    expect(filled[0]?.bugFix?.window7d.median).toBe(4);
  });

  it('computes each row against its own date, not today', () => {
    const filled = backfillBugHistory([makeRow('2026-07-10'), makeRow('2026-07-24')], bugs, now, 7);
    expect(filled[0]?.bugFix?.window7d.n).toBe(1);
    expect(filled[1]?.bugFix?.window7d.n).toBe(1);
    // Bug 1 resolved 2026-07-10, bug 2 on 07-24 — different bugs, different medians.
    expect(filled[0]?.bugFix?.window7d.median).toBe(9);
    expect(filled[1]?.bugFix?.window7d.median).toBe(4);
  });

  // A partial number looks authoritative but is computed from a truncated bug
  // set. Leaving the key absent is honest: buildChartData plots it as a zero the
  // reader can recognize as "no data yet".
  it('leaves an uncovered row untouched rather than writing a partial number', () => {
    const old = makeRow('2026-05-01');
    expect(backfillBugHistory([old], bugs, now, 7)[0]).toEqual(old);
    expect(backfillBugHistory([old], bugs, now, 7)[0]?.bugFix).toBeUndefined();
  });

  it('preserves every other key on a row it fills', () => {
    const row = makeRow('2026-07-24', {
      phabCycle: emptyWindows,
      phabRounds: emptyWindows,
    });
    const filled = backfillBugHistory([row], bugs, now, 7)[0];
    expect(filled?.phabCycle).toEqual(emptyWindows);
    expect(filled?.phabRounds).toEqual(emptyWindows);
    expect(filled?.date).toBe('2026-07-24');
  });

  it('is idempotent', () => {
    const once = backfillBugHistory([makeRow('2026-07-24')], bugs, now, 7);
    expect(backfillBugHistory(once, bugs, now, 7)).toEqual(once);
  });

  it('overwrites a previously backfilled value, so a threshold change can be redone', () => {
    // A 14-day fix: under a 30-day threshold, over a 7-day one.
    const slow = [makeBug(9, '2026-07-10T00:00:00Z', '2026-07-24T00:00:00Z')];
    const once = backfillBugHistory([makeRow('2026-07-24')], slow, now, 7);
    const redone = backfillBugHistory(once, slow, now, 30);
    expect(once[0]?.bugFix?.window7d.pctUnderSLA).toBe(0);
    expect(redone[0]?.bugFix?.window7d.pctUnderSLA).toBe(100);
  });

  it('returns rows in the same order', () => {
    const rows = [makeRow('2026-07-10'), makeRow('2026-07-17'), makeRow('2026-07-24')];
    expect(backfillBugHistory(rows, bugs, now, 7).map((r) => r.date)).toEqual([
      '2026-07-10',
      '2026-07-17',
      '2026-07-24',
    ]);
  });

  it('writes zeroed windows for a covered row with no bugs in range', () => {
    const filled = backfillBugHistory([makeRow('2026-06-20')], bugs, now, 7);
    expect(filled[0]?.bugFix?.window7d).toEqual(zero);
  });
});
