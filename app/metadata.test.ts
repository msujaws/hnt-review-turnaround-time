import { describe, expect, it } from 'vitest';

import type { HistoryRow, PendingSample, Sample } from '../src/scripts/collect';
import {
  asBusinessHours,
  asIsoTimestamp,
  asPrNumber,
  asReviewerLogin,
  asRevisionPhid,
} from '../src/types/brand';

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

// A completed phab review that finished in `tat` business hours.
const phabSample = (requestedAt: string, tat: number): Sample =>
  ({
    source: 'phab',
    id: asRevisionPhid('PHID-DREV-fastaaaaaaaaaaaaaaaa'),
    revisionId: 900,
    reviewer: asReviewerLogin('carol'),
    requestedAt: asIsoTimestamp(requestedAt),
    firstActionAt: asIsoTimestamp(requestedAt),
    tatBusinessHours: asBusinessHours(tat),
  }) as Sample;

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

  it('uses the provided group label in the title', () => {
    const summary = buildMetadataSummary([row()], 4, { label: 'IP Protection' });
    expect(summary.title).toMatch(/^IP Protection Review TAT/);
    expect(summary.title).not.toMatch(/HNT/);
  });

  it('uses the label in the empty-history fallback', () => {
    const summary = buildMetadataSummary([], 4, { label: 'Desktop Theme' });
    expect(summary.title).toBe('Desktop Theme Review TAT');
  });

  it('suppresses the GitHub clause for Phabricator-only groups', () => {
    const summary = buildMetadataSummary([row()], 4, { label: 'Sharing', hasGithub: false });
    expect(summary.title).toMatch(/Phab 2\.1h \(7d\)/);
    expect(summary.title).not.toMatch(/GH /);
    expect(summary.description).toMatch(/Phab 7d/);
    expect(summary.description).not.toMatch(/GH /);
  });

  it('flags overdue even when history is empty (no snapshots yet but reviewers are already waiting)', () => {
    const summary = buildMetadataSummary([], 4, {
      pending: [pendingGh('2026-04-13T13:00:00Z')],
      now: new Date('2026-04-17T21:00:00Z'),
    });
    expect(summary.title.startsWith('⚠ 1 overdue · ')).toBe(true);
  });

  it('includes cycle-time median and land count in the description when present', () => {
    const phabCycleWindows = {
      window7d: { n: 4, median: 18.5, mean: 20, p90: 40, pctUnderSLA: 50 },
      window14d: { n: 8, median: 20, mean: 22, p90: 42, pctUnderSLA: 45 },
      window30d: { n: 16, median: 22, mean: 25, p90: 48, pctUnderSLA: 40 },
    };
    const githubCycleWindows = {
      window7d: { n: 2, median: 9, mean: 10, p90: 14, pctUnderSLA: 75 },
      window14d: { n: 5, median: 10, mean: 11, p90: 15, pctUnderSLA: 70 },
      window30d: { n: 10, median: 11, mean: 12, p90: 16, pctUnderSLA: 65 },
    };
    const summary = buildMetadataSummary(
      [row({ phabCycle: phabCycleWindows, githubCycle: githubCycleWindows })],
      4,
    );
    // Should mention cycle figures somewhere in the description without
    // disturbing the TAT-focused title. Format kept terse for Slack unfurl.
    expect(summary.description).toMatch(/cycle 18\.5h.*4 land/);
    expect(summary.description).toMatch(/cycle 9\.0h.*2 land/);
    expect(summary.title).not.toMatch(/cycle/i);
  });

  it('omits the cycle clause entirely on historical rows without the field (back-compat)', () => {
    const summary = buildMetadataSummary([row()], 4);
    expect(summary.description).not.toMatch(/cycle/i);
    expect(summary.description).not.toMatch(/land/i);
  });

  it('celebrates fast reviews (under 2h) with a count prefix on title and description', () => {
    const summary = buildMetadataSummary([row()], 4, {
      now: new Date('2026-04-17T21:00:00Z'),
      samples: [
        phabSample('2026-04-15T13:00:00Z', 1), // in 7d window, fast
        phabSample('2026-04-15T13:00:00Z', 0.5), // in 7d window, fast
        phabSample('2026-04-15T13:00:00Z', 3), // in window, not fast
      ],
    });
    expect(summary.title.startsWith('🎉 2 under 2h · ')).toBe(true);
    expect(summary.description.startsWith('🎉 2 under 2h · ')).toBe(true);
  });

  it('anchors the fast-review count on the snapshot day, not real now', () => {
    // The snapshot is dated 2026-04-20 and the sample falls in its 7d window.
    // `now` is months later — if the count used real now, the window would
    // miss the sample and there would be no celebration.
    const summary = buildMetadataSummary([row()], 4, {
      now: new Date('2026-07-01T12:00:00Z'),
      samples: [phabSample('2026-04-16T13:00:00Z', 1)],
    });
    expect(summary.title.startsWith('🎉 1 under 2h · ')).toBe(true);
  });

  it('omits the celebration prefix when no review beat 2h (back-compat with no samples)', () => {
    const summary = buildMetadataSummary([row()], 4);
    expect(summary.title).not.toMatch(/under 2h/);
    expect(summary.description).not.toMatch(/under 2h/);
  });

  it('orders the overdue warning ahead of the fast-review celebration', () => {
    const summary = buildMetadataSummary([row()], 4, {
      now: new Date('2026-04-17T21:00:00Z'),
      pending: [pendingGh('2026-04-13T13:00:00Z')], // 40h+ → overdue
      samples: [phabSample('2026-04-15T13:00:00Z', 1)], // fast
    });
    expect(summary.title.startsWith('⚠ 1 overdue · 🎉 1 under 2h · ')).toBe(true);
    expect(summary.description.startsWith('⚠ 1 overdue · 🎉 1 under 2h · ')).toBe(true);
  });

  it('counts fast reviews in the headline window even when it falls back to 14d', () => {
    const summary = buildMetadataSummary(
      [
        row({
          phab: {
            window7d: zeroWindow,
            window14d: { n: 4, median: 3.3, mean: 3.5, p90: 5, pctUnderSLA: 70 },
            window30d: { n: 8, median: 3.8, mean: 4, p90: 6, pctUnderSLA: 65 },
          },
        }),
      ],
      4,
      {
        now: new Date('2026-04-17T21:00:00Z'),
        // 2026-04-09 is outside the 7d window but inside 14d; only counted
        // because the phab headline fell back to the 14-day window.
        samples: [phabSample('2026-04-09T13:00:00Z', 1)],
      },
    );
    expect(summary.title.startsWith('🎉 1 under 2h · ')).toBe(true);
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
