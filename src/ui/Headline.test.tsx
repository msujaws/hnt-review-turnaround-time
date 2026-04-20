import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { WindowStats } from '../scripts/stats';

import { Headline } from './Headline';

const stats: WindowStats = {
  n: 23,
  median: 2.42,
  mean: 3.15,
  p90: 7.83,
  pctUnderSLA: 86.95,
};

describe('Headline', () => {
  it('renders the source title', () => {
    render(<Headline title="Phabricator" stats={stats} slaHours={4} />);
    expect(screen.getByRole('heading', { name: /phabricator/i })).toBeInTheDocument();
  });

  it('shows the sample count', () => {
    render(<Headline title="Phabricator" stats={stats} slaHours={4} />);
    expect(screen.getByText(/23\s*reviews/i)).toBeInTheDocument();
  });

  it('renders all four metrics with rounded values', () => {
    render(<Headline title="Phabricator" stats={stats} slaHours={4} />);
    expect(screen.getByText(/2\.4\s*h/)).toBeInTheDocument();
    expect(screen.getByText(/3\.2\s*h/)).toBeInTheDocument();
    expect(screen.getByText(/7\.8\s*h/)).toBeInTheDocument();
    expect(screen.getByText(/87%/)).toBeInTheDocument();
  });

  it('renders labels for each metric', () => {
    render(<Headline title="Phabricator" stats={stats} slaHours={4} />);
    expect(screen.getByText(/median/i)).toBeInTheDocument();
    expect(screen.getByText(/mean/i)).toBeInTheDocument();
    expect(screen.getByText(/^p90$/i)).toBeInTheDocument();
    expect(screen.getByText(/under 4h sla/i)).toBeInTheDocument();
  });

  it('indicates empty state when n is 0', () => {
    render(
      <Headline
        title="GitHub"
        stats={{ n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 }}
        slaHours={4}
      />,
    );
    expect(screen.getByText(/no reviews/i)).toBeInTheDocument();
  });
});
