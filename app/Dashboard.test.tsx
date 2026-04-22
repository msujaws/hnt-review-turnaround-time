import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { HistoryRow } from '../src/scripts/collect';
import { EMPTY_PEOPLE_MAP, type PeopleMap } from '../src/scripts/people';
import { asIanaTimezone } from '../src/types/brand';

import { Dashboard } from './Dashboard';
import { buildMetadataSummary } from './metadata';

const row: HistoryRow = {
  date: '2026-04-20',
  phab: {
    window7d: { n: 23, median: 2.4, mean: 3.1, p90: 7.8, pctUnderSLA: 87 },
    window14d: { n: 47, median: 2.6, mean: 3.4, p90: 8.1, pctUnderSLA: 85 },
    window30d: { n: 95, median: 2.7, mean: 3.6, p90: 8.3, pctUnderSLA: 83 },
  },
  github: {
    window7d: { n: 12, median: 1.8, mean: 2.2, p90: 4.5, pctUnderSLA: 92 },
    window14d: { n: 23, median: 1.9, mean: 2.3, p90: 5, pctUnderSLA: 90 },
    window30d: { n: 45, median: 2, mean: 2.4, p90: 5.3, pctUnderSLA: 88 },
  },
};

describe('Dashboard', () => {
  it('renders a Headline and Trendline for each source when history has data', () => {
    render(
      <Dashboard
        history={[row]}
        samples={[]}
        slaHours={4}
        now={new Date('2026-04-21T12:00:00Z')}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    expect(screen.getByRole('heading', { name: /^phabricator$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^github$/i })).toBeInTheDocument();
    expect(screen.getByTestId('trendline-phab')).toBeInTheDocument();
    expect(screen.getByTestId('trendline-github')).toBeInTheDocument();
  });

  it('shows a no-data state when history is empty', () => {
    render(
      <Dashboard
        history={[]}
        samples={[]}
        slaHours={4}
        now={new Date('2026-04-21T12:00:00Z')}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    expect(screen.getByText(/no snapshots yet/i)).toBeInTheDocument();
  });

  it('lists tracked Phabricator reviewers alphabetically in the Phab description', () => {
    const peopleMap: PeopleMap = {
      github: {},
      phab: {
        maxx: asIanaTimezone('America/Chicago'),
        reemhamz: asIanaTimezone('Australia/Melbourne'),
        Dre: asIanaTimezone('America/Los_Angeles'),
      },
    };
    render(
      <Dashboard
        history={[row]}
        samples={[]}
        slaHours={4}
        now={new Date('2026-04-21T12:00:00Z')}
        peopleMap={peopleMap}
      />,
    );
    const phabSection = screen.getByRole('heading', { name: /^phabricator$/i }).closest('section');
    expect(phabSection).not.toBeNull();
    // Names should appear alphabetically, case-insensitive: Dre, maxx, reemhamz.
    expect(within(phabSection!).getByText(/Dre, maxx, reemhamz/)).toBeInTheDocument();
  });

  it('renders the GitHub repo as a lowercase link in the GitHub description', () => {
    render(
      <Dashboard
        history={[row]}
        samples={[]}
        slaHours={4}
        now={new Date('2026-04-21T12:00:00Z')}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    const ghSection = screen.getByRole('heading', { name: /^github$/i }).closest('section');
    expect(ghSection).not.toBeNull();
    const link = within(ghSection!).getByRole('link', { name: 'pocket/content-monorepo' });
    expect(link).toHaveAttribute('href', 'https://github.com/Pocket/content-monorepo');
  });
});

describe('buildMetadataSummary', () => {
  it('produces a title and description from the 7-day window when populated', () => {
    const summary = buildMetadataSummary([row], 4);
    expect(summary.title).toMatch(/HNT Review TAT/);
    expect(summary.title).toMatch(/Phab 2\.4h \(7d\)/);
    expect(summary.title).toMatch(/GH 1\.8h \(7d\)/);
    expect(summary.description).toMatch(/87% under 4h/);
    expect(summary.description).toMatch(/92% under 4h/);
  });

  it('falls back to the 14-day window when 7-day is empty', () => {
    const sparseRow: HistoryRow = {
      date: '2026-04-21',
      phab: {
        window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        window14d: { n: 5, median: 3.2, mean: 3.4, p90: 6, pctUnderSLA: 80 },
        window30d: { n: 9, median: 3.3, mean: 3.6, p90: 6.5, pctUnderSLA: 78 },
      },
      github: {
        window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        window14d: { n: 3, median: 1.1, mean: 1.5, p90: 2.4, pctUnderSLA: 100 },
        window30d: { n: 6, median: 1.2, mean: 1.6, p90: 2.6, pctUnderSLA: 100 },
      },
    };
    const summary = buildMetadataSummary([sparseRow], 4);
    expect(summary.title).toMatch(/Phab 3\.2h \(14d\)/);
    expect(summary.title).toMatch(/GH 1\.1h \(14d\)/);
    expect(summary.description).toMatch(/Phab 14d: median 3\.2h, 80% under 4h SLA \(n=5\)/);
    expect(summary.description).toMatch(/GH 14d: median 1\.1h, 100% under 4h SLA \(n=3\)/);
  });

  it('falls back to a placeholder when history is empty', () => {
    const summary = buildMetadataSummary([], 4);
    expect(summary.title).toBe('HNT Review TAT');
    expect(summary.description).toMatch(/no snapshots/i);
  });

  it('renders N/A instead of 0.0h for a source with no reviews while the other has data', () => {
    const mixedRow: HistoryRow = {
      date: '2026-04-21',
      phab: {
        window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        window14d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        window30d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
      },
      github: {
        window7d: { n: 2, median: 2, mean: 2, p90: 2, pctUnderSLA: 100 },
        window14d: { n: 2, median: 2, mean: 2, p90: 2, pctUnderSLA: 100 },
        window30d: { n: 2, median: 2, mean: 2, p90: 2, pctUnderSLA: 100 },
      },
    };
    const summary = buildMetadataSummary([mixedRow], 4);
    expect(summary.title).toMatch(/Phab N\/A/);
    expect(summary.title).toMatch(/GH 2\.0h/);
    expect(summary.description).toMatch(/Phab 30d: median N\/A/);
    expect(summary.description).toMatch(/GH 7d: median 2\.0h/);
  });

  it('falls back to "awaiting first reviews" when every window on both sources is empty', () => {
    const emptyRow: HistoryRow = {
      date: '2026-04-21',
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
    };
    const summary = buildMetadataSummary([emptyRow], 4);
    expect(summary.title).toBe('HNT Review TAT · awaiting first reviews');
    expect(summary.description).toMatch(/no reviews yet/i);
  });
});
