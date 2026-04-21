import { describe, expect, it } from 'vitest';

import type { HistoryRow, PendingSample } from '../src/scripts/collect';
import { asIsoTimestamp, asPrNumber, asReviewerLogin, asRevisionPhid } from '../src/types/brand';

import { buildMetadataSummary } from './metadata';

const zeroWindow = { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 };

const row = (overrides: Partial<HistoryRow> = {}): HistoryRow => ({
  date: '2026-04-20',
  phab: {
    window7d: { n: 5, median: 2.1, mean: 2.3, p90: 4.2, pctUnderSLA: 85 },
    window14d: { n: 10, median: 2.4, mean: 2.6, p90: 5.1, pctUnderSLA: 80 },
    window30d: { n: 22, median: 2.8, mean: 3, p90: 6, pctUnderSLA: 75 },
  },
  github: {
    window7d: { n: 3, median: 4.4, mean: 5, p90: 9, pctUnderSLA: 60 },
    window14d: { n: 7, median: 4.8, mean: 5.5, p90: 10, pctUnderSLA: 55 },
    window30d: { n: 15, median: 5.2, mean: 6, p90: 11, pctUnderSLA: 50 },
  },
  ...overrides,
});

const pendingGh = (requestedAt: string): PendingSample => ({
  source: 'github',
  id: asPrNumber(42),
  reviewer: asReviewerLogin('alice'),
  requestedAt: asIsoTimestamp(requestedAt),
});

describe('buildMetadataSummary', () => {
  it('returns a baseline summary when no pending is supplied', () => {
    const summary = buildMetadataSummary([row()], 4);
    expect(summary.title).toMatch(/Phab 2\.1h \(7d\)/);
    expect(summary.title).toMatch(/GH 4\.4h \(7d\)/);
    expect(summary.title).not.toMatch(/overdue/i);
    expect(summary.description).not.toMatch(/overdue/i);
  });

  it('prepends a warning and count when any pending item is overdue (≥ 40 business hours)', () => {
    const summary = buildMetadataSummary([row()], 4, {
      // Mon 09:00 ET → Fri 17:00 ET is exactly 40 business hours.
      pending: [pendingGh('2026-04-13T13:00:00Z')],
      now: new Date('2026-04-17T21:00:00Z'),
    });
    expect(summary.title.startsWith('⚠ 1 overdue · ')).toBe(true);
    expect(summary.description.startsWith('⚠ 1 overdue · ')).toBe(true);
  });

  it('does not flag when no pending item exceeds the 10x SLA threshold', () => {
    const summary = buildMetadataSummary([row()], 4, {
      pending: [pendingGh('2026-04-20T13:00:00Z')], // Mon 09:00 ET
      now: new Date('2026-04-21T15:00:00Z'), // Tue 11:00 ET → 10h waiting
    });
    expect(summary.title).not.toMatch(/overdue/i);
  });

  it('counts only the overdue items, not the total pending', () => {
    const summary = buildMetadataSummary([row()], 4, {
      pending: [
        pendingGh('2026-04-13T13:00:00Z'), // 40h+ by the chosen now
        {
          source: 'phab',
          id: asRevisionPhid('PHID-DREV-newishaaaaaaaaaaaaaa'),
          revisionId: 500,
          reviewer: asReviewerLogin('bob'),
          requestedAt: asIsoTimestamp('2026-04-17T13:00:00Z'), // same day → ~4h
        },
      ],
      now: new Date('2026-04-17T21:00:00Z'),
    });
    expect(summary.title.startsWith('⚠ 1 overdue · ')).toBe(true);
  });

  it('falls back gracefully when history is empty', () => {
    const summary = buildMetadataSummary([], 4);
    expect(summary.title).toBe('HNT Review TAT');
    expect(summary.description).toBe('No snapshots yet.');
  });

  it('flags overdue even when history is empty (no snapshots yet but reviewers are already waiting)', () => {
    const summary = buildMetadataSummary([], 4, {
      pending: [pendingGh('2026-04-13T13:00:00Z')],
      now: new Date('2026-04-17T21:00:00Z'),
    });
    expect(summary.title.startsWith('⚠ 1 overdue · ')).toBe(true);
  });

  it('falls back to 14d then 30d window when 7d has no reviews', () => {
    const summary = buildMetadataSummary(
      [
        row({
          phab: {
            window7d: zeroWindow,
            window14d: { n: 4, median: 3.3, mean: 3.5, p90: 5, pctUnderSLA: 70 },
            window30d: { n: 8, median: 3.8, mean: 4, p90: 6, pctUnderSLA: 65 },
          },
          github: {
            window7d: zeroWindow,
            window14d: zeroWindow,
            window30d: { n: 6, median: 4, mean: 5, p90: 9, pctUnderSLA: 45 },
          },
        }),
      ],
      4,
    );
    expect(summary.title).toMatch(/Phab 3\.3h \(14d\)/);
    expect(summary.title).toMatch(/GH 4\.0h \(30d\)/);
  });
});
