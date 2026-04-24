import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { HistoryRow, Landing } from '../src/scripts/collect';
import { EMPTY_PEOPLE_MAP, type PeopleMap } from '../src/scripts/people';
import {
  asBusinessHours,
  asIanaTimezone,
  asIsoTimestamp,
  asReviewerLogin,
  asRevisionPhid,
} from '../src/types/brand';

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
  it('exposes one tab per source, with Phabricator active by default', () => {
    render(
      <Dashboard
        history={[row]}
        samples={[]}
        landings={[]}
        slaHours={4}
        now={new Date('2026-04-21T12:00:00Z')}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    expect(screen.getByRole('tab', { name: /frontend team \(phabricator\)/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: /backend team \(github\)/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('heading', { name: /^phabricator$/i })).toBeInTheDocument();
    expect(screen.getByTestId('trendline-phab')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^github$/i })).toBeNull();
    expect(screen.queryByTestId('trendline-github')).toBeNull();
  });

  it('shows GitHub content (Headline + Trendline) after clicking the GitHub tab', async () => {
    const user = userEvent.setup();
    render(
      <Dashboard
        history={[row]}
        samples={[]}
        landings={[]}
        slaHours={4}
        now={new Date('2026-04-21T12:00:00Z')}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    await user.click(screen.getByRole('tab', { name: /backend team \(github\)/i }));
    expect(screen.getByRole('heading', { name: /^github$/i })).toBeInTheDocument();
    expect(screen.getByTestId('trendline-github')).toBeInTheDocument();
    expect(screen.queryByTestId('trendline-phab')).toBeNull();
  });

  it('renders cycle-time, post-review, and rounds headlines in each source tab', async () => {
    const user = userEvent.setup();
    render(
      <Dashboard
        history={[row]}
        samples={[]}
        landings={[]}
        slaHours={4}
        now={new Date('2026-04-21T12:00:00Z')}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    // Phab tab (default).
    expect(screen.getByRole('heading', { name: /creation to merge/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /first-review to merge/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /review rounds/i })).toBeInTheDocument();
    // Switch to GitHub tab — same three panel headings.
    await user.click(screen.getByRole('tab', { name: /backend team \(github\)/i }));
    expect(screen.getByRole('heading', { name: /creation to merge/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /first-review to merge/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /review rounds/i })).toBeInTheDocument();
  });

  it('marks a source tab red when its 7-day TAT median is over the SLA', () => {
    const rowWithBadPhab: HistoryRow = {
      ...row,
      phab: {
        // 7d median is 5h, over the 4h SLA ⇒ red.
        window7d: { n: 23, median: 5, mean: 5.2, p90: 6, pctUnderSLA: 80 },
        window14d: { n: 47, median: 2.6, mean: 3.4, p90: 8.1, pctUnderSLA: 85 },
        window30d: { n: 95, median: 2.7, mean: 3.6, p90: 8.3, pctUnderSLA: 83 },
      },
    };
    render(
      <Dashboard
        history={[rowWithBadPhab]}
        samples={[]}
        landings={[]}
        slaHours={4}
        now={new Date('2026-04-21T12:00:00Z')}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    expect(screen.getByRole('tab', { name: /frontend team \(phabricator\)/i })).toHaveAttribute(
      'data-red-issue',
      'true',
    );
    expect(screen.getByRole('tab', { name: /backend team \(github\)/i })).toHaveAttribute(
      'data-red-issue',
      'false',
    );
  });

  it('does not mark a tab red when only the 14-day window is bad', () => {
    const rowWithBad14d: HistoryRow = {
      ...row,
      phab: {
        // 7d median is fine (2.4h ≤ 4h SLA); only 14d is blown out.
        window7d: { n: 23, median: 2.4, mean: 3.1, p90: 7.8, pctUnderSLA: 87 },
        window14d: { n: 47, median: 10, mean: 10, p90: 15, pctUnderSLA: 30 },
        window30d: { n: 95, median: 2.7, mean: 3.6, p90: 8.3, pctUnderSLA: 83 },
      },
    };
    render(
      <Dashboard
        history={[rowWithBad14d]}
        samples={[]}
        landings={[]}
        slaHours={4}
        now={new Date('2026-04-21T12:00:00Z')}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    expect(screen.getByRole('tab', { name: /frontend team \(phabricator\)/i })).toHaveAttribute(
      'data-red-issue',
      'false',
    );
  });

  it('does not mark a tab red when only the cycle-time metric has a bad stat', () => {
    // Review TAT itself is fine in every window, but the landing metric
    // (phabCycle) has a blown-out 7-day window. The narrowed rule is
    // TAT-only, so the tab should stay neutral.
    const rowWithBadCycle: HistoryRow = {
      ...row,
      phabCycle: {
        window7d: { n: 5, median: 72, mean: 80, p90: 120, pctUnderSLA: 10 },
        window14d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
        window30d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
      },
    };
    render(
      <Dashboard
        history={[rowWithBadCycle]}
        samples={[]}
        landings={[]}
        slaHours={4}
        now={new Date('2026-04-21T12:00:00Z')}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    expect(screen.getByRole('tab', { name: /frontend team \(phabricator\)/i })).toHaveAttribute(
      'data-red-issue',
      'false',
    );
  });

  it('collapses landing sub-panels that have no data while keeping the populated TAT panel open', () => {
    // Same fixture as the default row: phab/github TAT populated, but the
    // optional landing fields (phabCycle, phabPostReview, phabRounds) are
    // absent, so those sub-panels fall back to all-zero windows and should
    // render collapsed.
    render(
      <Dashboard
        history={[row]}
        samples={[]}
        landings={[]}
        slaHours={4}
        now={new Date('2026-04-21T12:00:00Z')}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    const cycleHeading = screen.getByRole('heading', { name: /creation to merge/i });
    const cycleDetails = cycleHeading.closest('details');
    expect(cycleDetails).not.toBeNull();
    expect(cycleDetails).not.toHaveAttribute('open');

    const postReviewHeading = screen.getByRole('heading', { name: /first-review to merge/i });
    expect(postReviewHeading.closest('details')).not.toHaveAttribute('open');

    const roundsHeading = screen.getByRole('heading', { name: /review rounds/i });
    expect(roundsHeading.closest('details')).not.toHaveAttribute('open');

    // The Phab Headline's h2 still reads "Phabricator" — the team prefix is
    // on the tab button, not the panel heading.
    const phabHeading = screen.getByRole('heading', { name: /^phabricator$/i });
    const phabDetails = phabHeading.closest('details');
    expect(phabDetails).not.toBeNull();
    expect(phabDetails).toHaveAttribute('open');
  });

  it('expands each landing panel to list the underlying landings for the active source', () => {
    // Populate phabCycle/phabPostReview/phabRounds so the panels aren't
    // collapsed by default and pass landings that match those windows.
    const rowWithPhabLandings: HistoryRow = {
      ...row,
      phabCycle: {
        window7d: { n: 1, median: 6, mean: 6, p90: 6, pctUnderSLA: 100 },
        window14d: { n: 1, median: 6, mean: 6, p90: 6, pctUnderSLA: 100 },
        window30d: { n: 1, median: 6, mean: 6, p90: 6, pctUnderSLA: 100 },
      },
      phabPostReview: {
        window7d: { n: 1, median: 3, mean: 3, p90: 3, pctUnderSLA: 100 },
        window14d: { n: 1, median: 3, mean: 3, p90: 3, pctUnderSLA: 100 },
        window30d: { n: 1, median: 3, mean: 3, p90: 3, pctUnderSLA: 100 },
      },
      phabRounds: {
        window7d: { n: 1, median: 1, mean: 1, p90: 1, pctUnderSLA: 100 },
        window14d: { n: 1, median: 1, mean: 1, p90: 1, pctUnderSLA: 100 },
        window30d: { n: 1, median: 1, mean: 1, p90: 1, pctUnderSLA: 100 },
      },
    };
    const landings: Landing[] = [
      {
        source: 'phab',
        id: asRevisionPhid('PHID-DREV-abcdefghijklmnopqrst'),
        revisionId: 295_966,
        author: asReviewerLogin('maxx'),
        createdAt: asIsoTimestamp('2026-04-19T14:00:00Z'),
        firstReviewAt: asIsoTimestamp('2026-04-19T17:00:00Z'),
        landedAt: asIsoTimestamp('2026-04-20T14:00:00Z'),
        reviewRounds: 1,
        cycleBusinessHours: asBusinessHours(6),
        postReviewBusinessHours: asBusinessHours(3),
      },
    ];
    render(
      <Dashboard
        history={[rowWithPhabLandings]}
        samples={[]}
        landings={landings}
        slaHours={4}
        now={new Date('2026-04-21T12:00:00Z')}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    const cycleHeading = screen.getByRole('heading', { name: /creation to merge/i });
    const cycleDetails = cycleHeading.closest('details');
    expect(cycleDetails).not.toBeNull();
    // The cycle panel's 7-day expander lists a link to the Phab revision.
    const cycleWindow = within(cycleDetails!).getByTestId('window-7d-details');
    expect(within(cycleWindow).getByRole('link', { name: /D295966/ })).toBeInTheDocument();

    const roundsHeading = screen.getByRole('heading', { name: /review rounds/i });
    const roundsDetails = roundsHeading.closest('details');
    expect(roundsDetails).not.toBeNull();
    const roundsWindow = within(roundsDetails!).getByTestId('window-7d-details');
    // Rounds table renders a "Landed" column header (no "Created" / "TAT" col).
    expect(within(roundsWindow).getByRole('columnheader', { name: 'Landed' })).toBeInTheDocument();
    expect(within(roundsWindow).getByRole('columnheader', { name: 'Rounds' })).toBeInTheDocument();
  });

  it('shows a no-data state when history is empty', () => {
    render(
      <Dashboard
        history={[]}
        samples={[]}
        landings={[]}
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
        landings={[]}
        slaHours={4}
        now={new Date('2026-04-21T12:00:00Z')}
        peopleMap={peopleMap}
      />,
    );
    const phabSection = screen.getByRole('heading', { name: /^phabricator$/i }).closest('details');
    expect(phabSection).not.toBeNull();
    // Names should appear alphabetically, case-insensitive: Dre, maxx, reemhamz.
    expect(within(phabSection!).getByText(/Dre, maxx, reemhamz/)).toBeInTheDocument();
  });

  it('links the home-newtab-reviewers project inside the Phab description', () => {
    render(
      <Dashboard
        history={[row]}
        samples={[]}
        landings={[]}
        slaHours={4}
        now={new Date('2026-04-21T12:00:00Z')}
        peopleMap={{ github: {}, phab: { maxx: asIanaTimezone('America/Chicago') } }}
      />,
    );
    const phabSection = screen.getByRole('heading', { name: /^phabricator$/i }).closest('details');
    expect(phabSection).not.toBeNull();
    const link = within(phabSection!).getByRole('link', { name: 'home-newtab-reviewers' });
    expect(link).toHaveAttribute(
      'href',
      'https://phabricator.services.mozilla.com/tag/home-newtab-reviewers/',
    );
  });

  it('renders the GitHub repo as a lowercase link in the GitHub description', async () => {
    const user = userEvent.setup();
    render(
      <Dashboard
        history={[row]}
        samples={[]}
        landings={[]}
        slaHours={4}
        now={new Date('2026-04-21T12:00:00Z')}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    // GitHub content isn't mounted until the tab is activated.
    await user.click(screen.getByRole('tab', { name: /backend team \(github\)/i }));
    const ghSection = screen.getByRole('heading', { name: /^github$/i }).closest('details');
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
