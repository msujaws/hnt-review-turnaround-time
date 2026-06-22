import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Sample } from '../scripts/collect';
import {
  asBusinessHours,
  asIsoTimestamp,
  asPrNumber,
  asReviewerLogin,
  asRevisionPhid,
} from '../types/brand';

import { ReviewerLeaderboard } from './ReviewerLeaderboard';

const NOW = new Date('2026-04-17T21:00:00Z');

const review = (reviewer: string, tat: number, source: 'phab' | 'github' = 'phab'): Sample =>
  ({
    source,
    id: source === 'phab' ? asRevisionPhid('PHID-DREV-aaaaaaaaaaaaaaaaaaaa') : asPrNumber(1),
    revisionId: source === 'phab' ? 1 : undefined,
    reviewer: asReviewerLogin(reviewer),
    requestedAt: asIsoTimestamp('2026-04-10T13:00:00Z'),
    firstActionAt: asIsoTimestamp('2026-04-10T13:00:00Z'),
    tatBusinessHours: asBusinessHours(tat),
  }) as Sample;

const reviews = (reviewer: string, tats: number[], source: 'phab' | 'github' = 'phab'): Sample[] =>
  tats.map((tat) => review(reviewer, tat, source));

describe('ReviewerLeaderboard', () => {
  it('renders reviewers ranked best first, with a trophy on the leader', () => {
    render(
      <ReviewerLeaderboard
        samples={[...reviews('reliable', [1, 1, 1]), ...reviews('spotty', [1, 10, 10])]}
        now={NOW}
        slaHours={4}
      />,
    );
    const rows = screen.getAllByTestId('leaderboard-row');
    expect(within(rows[0]!).getByText('reliable')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('spotty')).toBeInTheDocument();
    expect(rows[0]!.querySelector('.material-symbols-outlined')?.textContent).toBe('emoji_events');
  });

  it('renders a section per source', () => {
    render(
      <ReviewerLeaderboard
        samples={[...reviews('alice', [1, 1, 1], 'phab'), ...reviews('bob', [2, 2, 2], 'github')]}
        now={NOW}
        slaHours={4}
      />,
    );
    expect(screen.getByText('Phabricator')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('shows an empty state when no reviewer qualifies', () => {
    render(<ReviewerLeaderboard samples={reviews('rare', [1, 1])} now={NOW} slaHours={4} />);
    expect(screen.queryAllByTestId('leaderboard-row')).toHaveLength(0);
    expect(screen.getByText(/not enough reviews/i)).toBeInTheDocument();
  });
});
