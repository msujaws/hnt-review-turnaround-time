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

  it('renders an optional description paragraph under the title', () => {
    render(
      <Headline
        title="Phabricator"
        description="Reviews on mozilla-central where the team is requested."
        window7d={window14d}
        window14d={window14d}
        window30d={window14d}
        slaHours={4}
        samples={[]}
        now={new Date('2026-04-21T12:00:00Z')}
      />,
    );
    expect(
      screen.getByText(/reviews on mozilla-central where the team is requested/i),
    ).toBeInTheDocument();
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

  it('uses the override slaLabel when provided', () => {
    render(
      <Headline
        title="Rounds"
        window7d={window14d}
        window14d={window14d}
        window30d={window14d}
        slaHours={1}
        slaLabel="One-shot"
        samples={[]}
        now={new Date('2026-04-21T12:00:00Z')}
      />,
    );
    expect(screen.getAllByText(/one-shot/i).length).toBeGreaterThanOrEqual(3);
  });

  it('formats values as round counts when unit=rounds', () => {
    const rounds: WindowStats = { n: 5, median: 2, mean: 2.4, p90: 3, pctUnderSLA: 40 };
    render(
      <Headline
        title="Rounds"
        window7d={rounds}
        window14d={rounds}
        window30d={rounds}
        slaHours={1}
        unit="rounds"
        slaLabel="One-shot"
        samples={[]}
        now={new Date('2026-04-21T12:00:00Z')}
      />,
    );
    // median is 2 rounds — renders without an "h" suffix.
    expect(screen.queryByText(/2\.0h/)).toBeNull();
    expect(screen.getAllByText(/^2$/).length).toBeGreaterThan(0);
  });

  it('uses the configured count label (e.g. "land" for landings)', () => {
    render(
      <Headline
        title="Cycle"
        window7d={window7d}
        window14d={window14d}
        window30d={window30d}
        slaHours={24}
        countLabel="land"
        samples={[]}
        now={new Date('2026-04-21T12:00:00Z')}
      />,
    );
    expect(screen.getByText(/23 lands/)).toBeInTheDocument();
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
      author: asReviewerLogin('author-user'),
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

  it('shows the patch author in the expanded sample table', () => {
    const sample: Sample = {
      source: 'github',
      id: asPrNumber(501),
      author: asReviewerLogin('connie'),
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
    expect(within(row7).getByRole('columnheader', { name: /author/i })).toBeInTheDocument();
    expect(within(row7).getByText('connie')).toBeInTheDocument();
  });

  it('renders a Phabricator sample as a D<revisionId> link when revisionId is present', () => {
    const sample: Sample = {
      source: 'phab',
      id: asRevisionPhid('PHID-DREV-abcdefghijklmnopqrst'),
      revisionId: 287_177,
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
    const link = within(row7).getByRole('link', { name: /D287177/ });
    expect(link).toHaveAttribute('href', 'https://phabricator.services.mozilla.com/D287177');
  });

  it('falls back to the PHID as plain text when a legacy Phab sample lacks revisionId', () => {
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
    expect(within(row7).queryByRole('link', { name: /^D/ })).not.toBeInTheDocument();
  });

  it('still renders 0.0h for a populated window whose stats happen to round to 0', () => {
    // A real workday-zero case: n > 0 but all activity happened outside business hours.
    const nonEmptyZero: WindowStats = {
      n: 3,
      median: 0,
      mean: 0.02,
      p90: 0.04,
      pctUnderSLA: 100,
    };
    render(
      <Headline
        title="GitHub"
        window7d={nonEmptyZero}
        window14d={nonEmptyZero}
        window30d={nonEmptyZero}
        slaHours={4}
        samples={[]}
        now={new Date('2026-04-21T12:00:00Z')}
      />,
    );
    // 0.0h should appear (not N/A) for every hour stat since n > 0.
    expect(screen.queryAllByText('N/A')).toHaveLength(0);
    expect(screen.queryAllByText('0.0h').length).toBeGreaterThan(0);
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

  it('tints stat cells by SLA tier (good/warn/bad)', () => {
    // 7d: clearly good (well under 4h, 100% under SLA)
    const good: WindowStats = { n: 5, median: 1.2, mean: 1.5, p90: 2.1, pctUnderSLA: 100 };
    // 14d: clearly warn (between 4h and 8h, 75% under SLA)
    const warn: WindowStats = { n: 5, median: 5, mean: 6, p90: 7.5, pctUnderSLA: 75 };
    // 30d: clearly bad (>8h, 60% under SLA)
    const bad: WindowStats = { n: 5, median: 12, mean: 14, p90: 20, pctUnderSLA: 60 };
    render(
      <Headline
        title="Phabricator"
        window7d={good}
        window14d={warn}
        window30d={bad}
        slaHours={4}
        samples={[]}
        now={new Date('2026-04-21T12:00:00Z')}
      />,
    );
    // Each StatCell's value span has the label span as a sibling inside the
    // card div; the card div is the value span's parent.
    const goodCard = screen.getByText('1.2h').parentElement;
    expect(goodCard?.className).toMatch(/emerald/);
    const warnMedianCard = screen.getByText('5.0h').parentElement;
    expect(warnMedianCard?.className).toMatch(/amber/);
    const badP90Card = screen.getByText('20.0h').parentElement;
    expect(badP90Card?.className).toMatch(/rose/);
    // % under SLA also tiered: 100% → good, 75% → warn, 60% → bad.
    expect(screen.getByText('100%').parentElement?.className).toMatch(/emerald/);
    expect(screen.getByText('75%').parentElement?.className).toMatch(/amber/);
    expect(screen.getByText('60%').parentElement?.className).toMatch(/rose/);
  });

  it('does not apply a tier tint to N/A cells (no data)', () => {
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
    for (const cell of screen.getAllByText('N/A')) {
      const card = cell.parentElement;
      expect(card?.className).not.toMatch(/emerald|amber|rose/);
    }
  });

  it('tints the per-sample TAT text by tier', () => {
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
    const samples: Sample[] = [
      sample(1, 'alice', '2026-04-18T18:00:00Z', '2026-04-18T20:00:00Z', 1.2), // good
      sample(2, 'bob', '2026-04-18T18:00:00Z', '2026-04-18T20:00:00Z', 5.5), // warn
      sample(3, 'carol', '2026-04-18T18:00:00Z', '2026-04-18T20:00:00Z', 14.2), // bad
    ];
    // Pick stat values that don't collide with any sample TAT (1.2, 5.5, 14.2)
    // so we can unambiguously locate TAT-cell spans via getByText.
    render(
      <Headline
        title="GitHub"
        window7d={{ n: 3, median: 8.1, mean: 9.2, p90: 12.3, pctUnderSLA: 33 }}
        window14d={{ n: 3, median: 8.1, mean: 9.2, p90: 12.3, pctUnderSLA: 33 }}
        window30d={{ n: 3, median: 8.1, mean: 9.2, p90: 12.3, pctUnderSLA: 33 }}
        slaHours={4}
        samples={samples}
        now={new Date('2026-04-21T12:00:00Z')}
      />,
    );
    const row7 = screen.getByTestId('window-7d-details');
    const goodTat = within(row7).getByText('1.2h');
    const warnTat = within(row7).getByText('5.5h');
    const badTat = within(row7).getByText('14.2h');
    expect(goodTat.className).toMatch(/emerald/);
    expect(warnTat.className).toMatch(/amber/);
    expect(badTat.className).toMatch(/rose/);
  });
});
