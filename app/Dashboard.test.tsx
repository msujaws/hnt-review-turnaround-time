import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { HistoryRow } from '../src/scripts/collect';

import { Dashboard } from './Dashboard';
import { buildMetadataSummary } from './metadata';

const row: HistoryRow = {
  date: '2026-04-20',
  phab: {
    window7d: { n: 23, median: 2.4, mean: 3.1, p90: 7.8, pctUnderSLA: 87 },
    window14d: { n: 47, median: 2.6, mean: 3.4, p90: 8.1, pctUnderSLA: 85 },
  },
  github: {
    window7d: { n: 12, median: 1.8, mean: 2.2, p90: 4.5, pctUnderSLA: 92 },
    window14d: { n: 23, median: 1.9, mean: 2.3, p90: 5, pctUnderSLA: 90 },
  },
};

describe('Dashboard', () => {
  it('renders a Headline and Trendline for each source when history has data', () => {
    render(<Dashboard history={[row]} slaHours={4} />);
    expect(screen.getByRole('heading', { name: /^phabricator$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^github$/i })).toBeInTheDocument();
    expect(screen.getByTestId('trendline-phab')).toBeInTheDocument();
    expect(screen.getByTestId('trendline-github')).toBeInTheDocument();
  });

  it('shows a no-data state when history is empty', () => {
    render(<Dashboard history={[]} slaHours={4} />);
    expect(screen.getByText(/no snapshots yet/i)).toBeInTheDocument();
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
      },
      github: {
        window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        window14d: { n: 3, median: 1.1, mean: 1.5, p90: 2.4, pctUnderSLA: 100 },
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

  it('renders N/A instead of 0.0h when both windows are empty', () => {
    const emptyRow: HistoryRow = {
      date: '2026-04-21',
      phab: {
        window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        window14d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
      },
      github: {
        window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        window14d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
      },
    };
    const summary = buildMetadataSummary([emptyRow], 4);
    expect(summary.title).not.toMatch(/0\.0h/);
    expect(summary.title).toMatch(/Phab N\/A/);
    expect(summary.title).toMatch(/GH N\/A/);
    expect(summary.description).not.toMatch(/0\.0h/);
    expect(summary.description).toMatch(/median N\/A/);
  });
});
