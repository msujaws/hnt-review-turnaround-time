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
  it('produces a title and description from the latest history row', () => {
    const summary = buildMetadataSummary([row], 4);
    expect(summary.title).toMatch(/HNT Review TAT/);
    expect(summary.title).toMatch(/Phab 2\.4h/);
    expect(summary.title).toMatch(/GH 1\.8h/);
    expect(summary.description).toMatch(/87% under 4h/);
    expect(summary.description).toMatch(/92% under 4h/);
  });

  it('falls back to a placeholder when history is empty', () => {
    const summary = buildMetadataSummary([], 4);
    expect(summary.title).toBe('HNT Review TAT');
    expect(summary.description).toMatch(/no snapshots/i);
  });
});
