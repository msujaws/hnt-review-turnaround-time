import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { WindowStats } from '../scripts/stats';

import { Headline } from './Headline';

const window7d: WindowStats = { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 };
const window14d: WindowStats = {
  n: 23,
  median: 2.42,
  mean: 3.15,
  p90: 7.83,
  pctUnderSLA: 86.95,
};
const window30d: WindowStats = {
  n: 58,
  median: 2.9,
  mean: 3.5,
  p90: 8.4,
  pctUnderSLA: 80,
};

describe('Headline', () => {
  it('renders the source title', () => {
    render(
      <Headline
        title="Phabricator"
        window7d={window14d}
        window14d={window14d}
        window30d={window14d}
        slaHours={4}
      />,
    );
    expect(screen.getByRole('heading', { name: /phabricator/i })).toBeInTheDocument();
  });

  it('renders 7-day, 14-day, and 30-day rows with their counts', () => {
    render(
      <Headline
        title="Phabricator"
        window7d={window7d}
        window14d={window14d}
        window30d={window30d}
        slaHours={4}
      />,
    );
    expect(screen.getByText('7-day')).toBeInTheDocument();
    expect(screen.getByText('14-day')).toBeInTheDocument();
    expect(screen.getByText('30-day')).toBeInTheDocument();
    expect(screen.getByText(/no reviews in window/)).toBeInTheDocument();
    expect(screen.getByText(/23 reviews/)).toBeInTheDocument();
    expect(screen.getByText(/58 reviews/)).toBeInTheDocument();
  });

  it('renders rounded median/mean/p90/pctUnderSLA values for the 14-day window', () => {
    render(
      <Headline
        title="Phabricator"
        window7d={window7d}
        window14d={window14d}
        window30d={window30d}
        slaHours={4}
      />,
    );
    expect(screen.getByText(/2\.4h/)).toBeInTheDocument();
    expect(screen.getByText(/3\.2h/)).toBeInTheDocument();
    expect(screen.getByText(/7\.8h/)).toBeInTheDocument();
    expect(screen.getByText(/87%/)).toBeInTheDocument();
  });

  it('renders SLA label with the configured hours', () => {
    render(
      <Headline
        title="Phabricator"
        window7d={window7d}
        window14d={window14d}
        window30d={window30d}
        slaHours={4}
      />,
    );
    expect(screen.getAllByText(/under 4h sla/i)).toHaveLength(3);
  });

  it('shows the awaiting state when all windows are empty', () => {
    render(
      <Headline
        title="GitHub"
        window7d={window7d}
        window14d={window7d}
        window30d={window7d}
        slaHours={4}
      />,
    );
    expect(screen.getByText(/awaiting first reviews/i)).toBeInTheDocument();
  });

  it('renders N/A instead of 0.0h when hour values round to zero', () => {
    render(
      <Headline
        title="Phabricator"
        window7d={window7d}
        window14d={window7d}
        window30d={window7d}
        slaHours={4}
      />,
    );
    expect(screen.queryByText(/0\.0h/)).not.toBeInTheDocument();
    // three stat cells per row (median/mean/p90) × 3 rows = 9 N/A cells
    expect(screen.getAllByText('N/A')).toHaveLength(9);
  });
});
