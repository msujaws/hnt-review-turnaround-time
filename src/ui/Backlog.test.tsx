import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BacklogSnapshot, PendingSample } from '../scripts/collect';
import type { PeopleMap } from '../scripts/people';
import {
  asIsoTimestamp,
  asPrNumber,
  asReviewerLogin,
  asRevisionPhid,
  asBusinessHours,
} from '../types/brand';

import { Backlog } from './Backlog';

const snapshot = (date: string, phabOpen: number, ghOpen: number): BacklogSnapshot => ({
  date,
  phab: {
    openCount: phabOpen,
    oldestBusinessHours: asBusinessHours(phabOpen * 2),
    p90BusinessHours: asBusinessHours(phabOpen * 1.5),
  },
  github: {
    openCount: ghOpen,
    oldestBusinessHours: asBusinessHours(ghOpen * 2),
    p90BusinessHours: asBusinessHours(ghOpen * 1.5),
  },
});

const peopleMap: PeopleMap = { github: {}, phab: {} };

const phabPending = (id: string, revisionId: number, reviewer: string): PendingSample => ({
  source: 'phab',
  id: asRevisionPhid(id),
  revisionId,
  author: asReviewerLogin('mconley'),
  reviewer: asReviewerLogin(reviewer),
  requestedAt: asIsoTimestamp('2026-04-24T16:11:47.000Z'),
});

const githubPending = (n: number, reviewer: string): PendingSample => ({
  source: 'github',
  id: asPrNumber(n),
  author: asReviewerLogin('thecount'),
  reviewer: asReviewerLogin(reviewer),
  requestedAt: asIsoTimestamp('2026-04-24T18:00:00.000Z'),
});

const now = new Date('2026-04-27T16:00:00Z');

describe('Backlog', () => {
  it('renders the current open count for each source', () => {
    render(
      <Backlog
        snapshots={[snapshot('2026-04-22', 3, 5)]}
        pending={[]}
        now={now}
        peopleMap={peopleMap}
      />,
    );
    expect(screen.getByText(/phab/i)).toBeInTheDocument();
    expect(screen.getByText(/github/i)).toBeInTheDocument();
    expect(screen.getByText(/3 open/i)).toBeInTheDocument();
    expect(screen.getByText(/5 open/i)).toBeInTheDocument();
  });

  it('renders the oldest business-hours age', () => {
    render(
      <Backlog
        snapshots={[snapshot('2026-04-22', 3, 0)]}
        pending={[]}
        now={now}
        peopleMap={peopleMap}
      />,
    );
    // Phab oldest = 3 * 2 = 6h
    expect(screen.getByText(/oldest 6\.0h/i)).toBeInTheDocument();
  });

  it('renders a no-backlog state when both sources are empty', () => {
    render(
      <Backlog
        snapshots={[snapshot('2026-04-22', 0, 0)]}
        pending={[]}
        now={now}
        peopleMap={peopleMap}
      />,
    );
    expect(screen.getAllByText(/no open reviews/i)).toHaveLength(2);
  });

  it('uses the latest snapshot for current numbers when multiple are supplied', () => {
    render(
      <Backlog
        snapshots={[snapshot('2026-04-20', 10, 10), snapshot('2026-04-22', 2, 4)]}
        pending={[]}
        now={now}
        peopleMap={peopleMap}
      />,
    );
    expect(screen.getByText(/2 open/i)).toBeInTheDocument();
    expect(screen.getByText(/4 open/i)).toBeInTheDocument();
    expect(screen.queryByText(/10 open/i)).toBeNull();
  });

  it('renders a placeholder when there are no snapshots at all', () => {
    render(<Backlog snapshots={[]} pending={[]} now={now} peopleMap={peopleMap} />);
    expect(screen.getByText(/no backlog snapshots yet/i)).toBeInTheDocument();
  });

  describe('expandable list of open reviews', () => {
    it('wraps the open count in a <details> element so clicking it toggles the list', () => {
      render(
        <Backlog
          snapshots={[snapshot('2026-04-22', 1, 0)]}
          pending={[
            phabPending('PHID-DREV-aaaaaaaaaaaaaaaaaaaa', 296_454, 'home-newtab-reviewers'),
          ]}
          now={now}
          peopleMap={peopleMap}
        />,
      );
      const phabDetails = screen.getByTestId('backlog-phab-details');
      expect(phabDetails.tagName).toBe('DETAILS');
      // Summary contains the open count so the user clicks the count to expand.
      const summary = within(phabDetails).getByText(/1 open/i);
      expect(summary.closest('summary')).not.toBeNull();
    });

    it('lists each phab pending entry in the expanded body with its review label and reviewer', () => {
      render(
        <Backlog
          snapshots={[snapshot('2026-04-22', 2, 0)]}
          pending={[
            phabPending('PHID-DREV-aaaaaaaaaaaaaaaaaaaa', 296_454, 'home-newtab-reviewers'),
            phabPending('PHID-DREV-bbbbbbbbbbbbbbbbbbbb', 296_376, 'maxx'),
          ]}
          now={now}
          peopleMap={peopleMap}
        />,
      );
      const phabDetails = screen.getByTestId('backlog-phab-details');
      const rows = within(phabDetails).getAllByTestId('backlog-row');
      expect(rows).toHaveLength(2);
      expect(within(phabDetails).getByText(/D296454/)).toBeInTheDocument();
      expect(within(phabDetails).getByText(/D296376/)).toBeInTheDocument();
      expect(within(phabDetails).getByText('home-newtab-reviewers')).toBeInTheDocument();
      expect(within(phabDetails).getByText('maxx')).toBeInTheDocument();
    });

    it('routes pending entries to the correct source card', () => {
      render(
        <Backlog
          snapshots={[snapshot('2026-04-22', 1, 1)]}
          pending={[
            phabPending('PHID-DREV-aaaaaaaaaaaaaaaaaaaa', 296_454, 'maxx'),
            githubPending(123, 'thecount'),
          ]}
          now={now}
          peopleMap={peopleMap}
        />,
      );
      const phabRows = within(screen.getByTestId('backlog-phab-details')).getAllByTestId(
        'backlog-row',
      );
      const ghRows = within(screen.getByTestId('backlog-github-details')).getAllByTestId(
        'backlog-row',
      );
      expect(phabRows).toHaveLength(1);
      expect(ghRows).toHaveLength(1);
      expect(phabRows[0]?.textContent).toContain('D296454');
      expect(ghRows[0]?.textContent).toContain('#123');
    });

    it('does not wrap the card in <details> when openCount is 0 (nothing to list)', () => {
      render(
        <Backlog
          snapshots={[snapshot('2026-04-22', 0, 0)]}
          pending={[]}
          now={now}
          peopleMap={peopleMap}
        />,
      );
      expect(screen.queryByTestId('backlog-phab-details')).toBeNull();
      expect(screen.queryByTestId('backlog-github-details')).toBeNull();
    });

    it('sorts rows by waiting time descending (oldest request first)', () => {
      // Earlier requestedAt = waited longer = should come first.
      const older: PendingSample = {
        source: 'phab',
        id: asRevisionPhid('PHID-DREV-oldoldoldoldoldoldol'),
        revisionId: 100,
        author: asReviewerLogin('mconley'),
        reviewer: asReviewerLogin('older-rev'),
        requestedAt: asIsoTimestamp('2026-04-20T10:00:00Z'),
      };
      const newer: PendingSample = {
        source: 'phab',
        id: asRevisionPhid('PHID-DREV-newnewnewnewnewnewne'),
        revisionId: 101,
        author: asReviewerLogin('mconley'),
        reviewer: asReviewerLogin('newer-rev'),
        requestedAt: asIsoTimestamp('2026-04-26T10:00:00Z'),
      };
      render(
        <Backlog
          snapshots={[snapshot('2026-04-22', 2, 0)]}
          pending={[newer, older]}
          now={now}
          peopleMap={peopleMap}
        />,
      );
      const rows = within(screen.getByTestId('backlog-phab-details')).getAllByTestId('backlog-row');
      expect(rows[0]?.textContent).toContain('D100');
      expect(rows[1]?.textContent).toContain('D101');
    });
  });
});
