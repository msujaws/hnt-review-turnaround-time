import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Sample } from '../scripts/collect';
import type { WindowStats } from '../scripts/stats';
import {
  asBusinessHours,
  asIsoTimestamp,
  asPrNumber,
  asReviewerLogin,
  asRevisionPhid,
} from '../types/brand';

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
        samples={[]}
        now={new Date('2026-04-21T12:00:00Z')}
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
        samples={[]}
        now={new Date('2026-04-21T12:00:00Z')}
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
        samples={[]}
        now={new Date('2026-04-21T12:00:00Z')}
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
        samples={[]}
        now={new Date('2026-04-21T12:00:00Z')}
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
        samples={[]}
        now={new Date('2026-04-21T12:00:00Z')}
      />,
    );
    expect(screen.getByText(/awaiting first reviews/i)).toBeInTheDocument();
  });

  it('renders each non-empty window as an expandable region listing its samples', () => {
    const sample = (
      id: number,
      reviewer: string,
      requestedAt: string,
      firstActionAt: string,
      tat: number,
    ): Sample => ({
      source: 'github',
      id: asPrNumber(id),
      reviewer: asReviewerLogin(reviewer),
      requestedAt: asIsoTimestamp(requestedAt),
      firstActionAt: asIsoTimestamp(firstActionAt),
      tatBusinessHours: asBusinessHours(tat),
    });
    const now = new Date('2026-04-21T12:00:00Z');
    const samples: Sample[] = [
      // inside 7d + 14d + 30d
      sample(382, 'jpetto', '2026-04-18T18:00:00Z', '2026-04-18T20:00:00Z', 2),
      // inside 14d + 30d only
      sample(381, 'Herraj', '2026-04-10T18:00:00Z', '2026-04-10T20:00:00Z', 2),
      // inside 30d only
      sample(374, 'Herraj', '2026-03-30T18:00:00Z', '2026-03-30T20:00:00Z', 2),
      // outside all windows (older than 30d) — should not appear
      sample(300, 'jpetto', '2026-01-01T18:00:00Z', '2026-01-01T20:00:00Z', 2),
    ];

    render(
      <Headline
        title="GitHub"
        window7d={{ n: 1, median: 2, mean: 2, p90: 2, pctUnderSLA: 100 }}
        window14d={{ n: 2, median: 2, mean: 2, p90: 2, pctUnderSLA: 100 }}
        window30d={{ n: 3, median: 2, mean: 2, p90: 2, pctUnderSLA: 100 }}
        slaHours={4}
        samples={samples}
        now={now}
      />,
    );

    const row7 = screen.getByTestId('window-7d-details');
    expect(within(row7).getByText(/#382/)).toBeInTheDocument();
    expect(within(row7).queryByText(/#381/)).not.toBeInTheDocument();
    expect(within(row7).queryByText(/#374/)).not.toBeInTheDocument();

    const row14 = screen.getByTestId('window-14d-details');
    expect(within(row14).getByText(/#382/)).toBeInTheDocument();
    expect(within(row14).getByText(/#381/)).toBeInTheDocument();
    expect(within(row14).queryByText(/#374/)).not.toBeInTheDocument();

    const row30 = screen.getByTestId('window-30d-details');
    expect(within(row30).getByText(/#382/)).toBeInTheDocument();
    expect(within(row30).getByText(/#381/)).toBeInTheDocument();
    expect(within(row30).getByText(/#374/)).toBeInTheDocument();
    expect(within(row30).queryByText(/#300/)).not.toBeInTheDocument();
  });

  it('does not render a details wrapper for empty windows (nothing to expand)', () => {
    render(
      <Headline
        title="GitHub"
        window7d={window7d}
        window14d={window7d}
        window30d={window7d}
        slaHours={4}
        samples={[]}
        now={new Date('2026-04-21T12:00:00Z')}
      />,
    );
    expect(screen.queryByTestId('window-7d-details')).not.toBeInTheDocument();
    expect(screen.queryByTestId('window-14d-details')).not.toBeInTheDocument();
    expect(screen.queryByTestId('window-30d-details')).not.toBeInTheDocument();
  });

  it('links GitHub samples to the pull request URL', () => {
    const sample: Sample = {
      source: 'github',
      id: asPrNumber(382),
      reviewer: asReviewerLogin('jpetto'),
      requestedAt: asIsoTimestamp('2026-04-18T18:00:00Z'),
      firstActionAt: asIsoTimestamp('2026-04-18T20:00:00Z'),
      tatBusinessHours: asBusinessHours(2),
    };
    render(
      <Headline
        title="GitHub"
        window7d={{ n: 1, median: 2, mean: 2, p90: 2, pctUnderSLA: 100 }}
        window14d={{ n: 1, median: 2, mean: 2, p90: 2, pctUnderSLA: 100 }}
        window30d={{ n: 1, median: 2, mean: 2, p90: 2, pctUnderSLA: 100 }}
        slaHours={4}
        samples={[sample]}
        now={new Date('2026-04-21T12:00:00Z')}
      />,
    );
    const row7 = screen.getByTestId('window-7d-details');
    const link = within(row7).getByRole('link', { name: /#382/ });
    expect(link).toHaveAttribute('href', 'https://github.com/Pocket/content-monorepo/pull/382');
  });

  it('renders the PHID as plain text for Phabricator samples', () => {
    const sample: Sample = {
      source: 'phab',
      id: asRevisionPhid('PHID-DREV-abcdefghijklmnopqrst'),
      reviewer: asReviewerLogin('maxx'),
      requestedAt: asIsoTimestamp('2026-04-18T18:00:00Z'),
      firstActionAt: asIsoTimestamp('2026-04-18T20:00:00Z'),
      tatBusinessHours: asBusinessHours(2),
    };
    render(
      <Headline
        title="Phabricator"
        window7d={{ n: 1, median: 2, mean: 2, p90: 2, pctUnderSLA: 100 }}
        window14d={{ n: 1, median: 2, mean: 2, p90: 2, pctUnderSLA: 100 }}
        window30d={{ n: 1, median: 2, mean: 2, p90: 2, pctUnderSLA: 100 }}
        slaHours={4}
        samples={[sample]}
        now={new Date('2026-04-21T12:00:00Z')}
      />,
    );
    const row7 = screen.getByTestId('window-7d-details');
    expect(within(row7).getByText(/PHID-DREV-abcdefghij/)).toBeInTheDocument();
  });

  it('renders N/A instead of 0.0h when hour values round to zero', () => {
    render(
      <Headline
        title="Phabricator"
        window7d={window7d}
        window14d={window7d}
        window30d={window7d}
        slaHours={4}
        samples={[]}
        now={new Date('2026-04-21T12:00:00Z')}
      />,
    );
    expect(screen.queryByText(/0\.0h/)).not.toBeInTheDocument();
    // three stat cells per row (median/mean/p90) × 3 rows = 9 N/A cells
    expect(screen.getAllByText('N/A')).toHaveLength(9);
  });
});
