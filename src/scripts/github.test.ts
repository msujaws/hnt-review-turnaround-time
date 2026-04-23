import { describe, expect, it, vi } from 'vitest';

import {
  extractLandingFromPullRequest,
  extractSamplesFromPullRequest,
  fetchGithubSamples,
  type GraphqlClient,
  type PullRequestData,
} from './github';

const pr = (overrides: Partial<PullRequestData> = {}): PullRequestData => ({
  number: 42,
  isDraft: false,
  author: { login: 'author-user' },
  createdAt: '2026-04-19T12:00:00Z',
  mergedAt: null,
  closed: false,
  timeline: [],
  ...overrides,
});

describe('extractSamplesFromPullRequest', () => {
  it('returns no samples for a draft PR', () => {
    const data = pr({
      isDraft: true,
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-19T14:00:00Z',
          reviewerLogins: ['alice'],
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T16:00:00Z',
          authorLogin: 'alice',
        },
      ],
    });
    const result = extractSamplesFromPullRequest(data);
    expect(result.samples).toEqual([]);
    expect(result.pending).toEqual([]);
  });

  it('emits a sample for a review requested then submitted', () => {
    const data = pr({
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-19T14:00:00Z',
          reviewerLogins: ['alice'],
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T16:00:00Z',
          authorLogin: 'alice',
        },
      ],
    });
    const { samples, pending } = extractSamplesFromPullRequest(data);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      source: 'github',
      id: 42,
      author: 'author-user',
      reviewer: 'alice',
      requestedAt: '2026-04-19T14:00:00Z',
      firstActionAt: '2026-04-19T16:00:00Z',
    });
    expect(pending).toEqual([]);
  });

  it('ignores reviews from bot accounts', () => {
    const data = pr({
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-19T14:00:00Z',
          reviewerLogins: ['dependabot[bot]'],
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T16:00:00Z',
          authorLogin: 'dependabot[bot]',
        },
      ],
    });
    const { samples, pending } = extractSamplesFromPullRequest(data);
    expect(samples).toEqual([]);
    expect(pending).toEqual([]);
  });

  it('ignores self-reviews (author reviewing own PR)', () => {
    const data = pr({
      author: { login: 'alice' },
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-19T14:00:00Z',
          reviewerLogins: ['alice'],
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T16:00:00Z',
          authorLogin: 'alice',
        },
      ],
    });
    const { samples, pending } = extractSamplesFromPullRequest(data);
    expect(samples).toEqual([]);
    expect(pending).toEqual([]);
  });

  it('uses the earliest review action after the request', () => {
    const data = pr({
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-19T14:00:00Z',
          reviewerLogins: ['alice'],
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T15:00:00Z',
          authorLogin: 'alice',
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T17:00:00Z',
          authorLogin: 'alice',
        },
      ],
    });
    const { samples } = extractSamplesFromPullRequest(data);
    expect(samples[0]?.firstActionAt).toBe('2026-04-19T15:00:00Z');
  });

  it('emits one sample per reviewer when multiple reviewers are requested', () => {
    const data = pr({
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-19T14:00:00Z',
          reviewerLogins: ['alice', 'bob'],
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T15:00:00Z',
          authorLogin: 'alice',
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T16:00:00Z',
          authorLogin: 'bob',
        },
      ],
    });
    const { samples } = extractSamplesFromPullRequest(data);
    expect(samples.map((s) => s.reviewer).sort()).toEqual(['alice', 'bob']);
  });

  it('does not emit a sample for a reviewer who has not submitted; emits pending instead', () => {
    const data = pr({
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-19T14:00:00Z',
          reviewerLogins: ['alice', 'bob'],
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T15:00:00Z',
          authorLogin: 'alice',
        },
      ],
    });
    const { samples, pending } = extractSamplesFromPullRequest(data);
    expect(samples.map((s) => s.reviewer)).toEqual(['alice']);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      source: 'github',
      id: 42,
      author: 'author-user',
      reviewer: 'bob',
      requestedAt: '2026-04-19T14:00:00Z',
    });
  });

  it('ignores reviews submitted before the review request', () => {
    const data = pr({
      timeline: [
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T13:00:00Z',
          authorLogin: 'alice',
        },
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-19T14:00:00Z',
          reviewerLogins: ['alice'],
        },
      ],
    });
    const { samples, pending } = extractSamplesFromPullRequest(data);
    expect(samples).toEqual([]);
    // Alice was requested at 14:00 and never acted after that (the 13:00 review
    // predates the request) → she's still pending.
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      reviewer: 'alice',
      requestedAt: '2026-04-19T14:00:00Z',
    });
  });

  it('falls back to the earliest ReviewRequestedEvent when the reviewer was not explicitly requested (team request)', () => {
    // Team was requested (reviewerLogins empty because the team wasn't visible to the PAT);
    // alice reviewed. The request timestamp for alice should be the team-request time.
    const data = pr({
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-19T14:00:00Z',
          reviewerLogins: [],
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T17:00:00Z',
          authorLogin: 'alice',
        },
      ],
    });
    const { samples } = extractSamplesFromPullRequest(data);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      reviewer: 'alice',
      requestedAt: '2026-04-19T14:00:00Z',
      firstActionAt: '2026-04-19T17:00:00Z',
    });
  });

  it('prefers an explicit per-reviewer request when one exists, even if a later team request happened', () => {
    const data = pr({
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-19T14:00:00Z',
          reviewerLogins: ['alice'],
        },
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-19T15:00:00Z',
          reviewerLogins: [],
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T16:00:00Z',
          authorLogin: 'alice',
        },
      ],
    });
    const { samples } = extractSamplesFromPullRequest(data);
    expect(samples[0]?.requestedAt).toBe('2026-04-19T14:00:00Z');
  });

  it('uses the earliest of concurrent team + explicit requests (team before explicit)', () => {
    // Team request at T1, explicit user request at T2, review at T3.
    // Reviewer was on the hook from T1 (via the team), not T2.
    const data = pr({
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-10T10:00:00Z',
          reviewerLogins: [],
          teamSlug: 'team-a',
        },
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-10T11:00:00Z',
          reviewerLogins: ['alice'],
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-10T13:00:00Z',
          authorLogin: 'alice',
        },
      ],
    });
    const { samples } = extractSamplesFromPullRequest(data);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.requestedAt).toBe('2026-04-10T10:00:00Z');
  });

  it('disambiguates multiple unknown-slug team requests so a remove does not wipe the other', () => {
    // Two unknown-slug team requests; one removal (we don't know which team);
    // reviewer acts. The first add should be paired with the first remove (FIFO),
    // leaving the second team request active, so the sample uses the second add's time.
    const data = pr({
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-10T10:00:00Z',
          reviewerLogins: [],
        },
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-10T11:00:00Z',
          reviewerLogins: [],
        },
        {
          kind: 'ReviewRequestRemovedEvent',
          createdAt: '2026-04-10T12:00:00Z',
          reviewerLogins: [],
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-10T14:00:00Z',
          authorLogin: 'alice',
        },
      ],
    });
    const { samples } = extractSamplesFromPullRequest(data);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.requestedAt).toBe('2026-04-10T11:00:00Z');
  });

  it("keeps another team's active request when one team is removed", () => {
    // Team A requested at T1, Team B requested at T2, Team A removed at T3.
    // Alice reviews at T4. Team B is still active; sample should use T2 (earliest
    // still-active team request at or before the review).
    const data = pr({
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-10T10:00:00Z',
          reviewerLogins: [],
          teamSlug: 'team-a',
        },
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-10T11:00:00Z',
          reviewerLogins: [],
          teamSlug: 'team-b',
        },
        {
          kind: 'ReviewRequestRemovedEvent',
          createdAt: '2026-04-10T12:00:00Z',
          reviewerLogins: [],
          teamSlug: 'team-a',
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-10T14:00:00Z',
          authorLogin: 'alice',
        },
      ],
    });
    const { samples } = extractSamplesFromPullRequest(data);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.requestedAt).toBe('2026-04-10T11:00:00Z');
  });

  it('uses the latest request after a remove/re-request cycle, not the first one', () => {
    // Requested T1, removed T2, re-requested T3, reviewed T4. Sample = (T3, T4).
    const data = pr({
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-10T14:00:00Z',
          reviewerLogins: ['alice'],
        },
        {
          kind: 'ReviewRequestRemovedEvent',
          createdAt: '2026-04-10T15:00:00Z',
          reviewerLogins: ['alice'],
        },
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-10T16:00:00Z',
          reviewerLogins: ['alice'],
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-10T18:00:00Z',
          authorLogin: 'alice',
        },
      ],
    });
    const { samples } = extractSamplesFromPullRequest(data);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.requestedAt).toBe('2026-04-10T16:00:00Z');
    expect(samples[0]?.firstActionAt).toBe('2026-04-10T18:00:00Z');
  });

  it('falls back to an earlier team request when the explicit re-request comes after the review', () => {
    // PR #373-style: team request at T1 (null reviewer), reviewer acts at T2, then
    // explicit re-request at T3 > T2. Review was a response to T1, not T3.
    const data = pr({
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-03-09T19:47:04Z',
          reviewerLogins: [],
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-03-10T22:06:31Z',
          authorLogin: 'jpetto',
        },
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-03-11T18:43:39Z',
          reviewerLogins: ['jpetto'],
        },
      ],
    });
    const { samples } = extractSamplesFromPullRequest(data);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      reviewer: 'jpetto',
      requestedAt: '2026-03-09T19:47:04Z',
      firstActionAt: '2026-03-10T22:06:31Z',
    });
  });

  it('falls back to the PR creation time when a review happens without any ReviewRequestedEvent', () => {
    // PR #378 case: reviewer was set at PR creation so GitHub never emitted a
    // standalone ReviewRequestedEvent. Without a fallback the sample would be lost.
    const data = pr({
      createdAt: '2026-03-16T20:00:00Z',
      timeline: [
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-03-16T20:40:19Z',
          authorLogin: 'Herraj',
        },
      ],
    });
    const { samples } = extractSamplesFromPullRequest(data);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      reviewer: 'Herraj',
      requestedAt: '2026-03-16T20:00:00Z',
      firstActionAt: '2026-03-16T20:40:19Z',
    });
  });

  it('does NOT fall back to createdAt for a reviewer who was never on the hook (request was for someone else)', () => {
    // bob is requested, alice leaves a drive-by review. alice was never requested
    // (explicitly or via team), so she shouldn't get a sample anchored on createdAt.
    // bob never acted → bob is pending.
    const data = pr({
      createdAt: '2026-04-19T12:00:00Z',
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-19T14:00:00Z',
          reviewerLogins: ['bob'],
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T16:00:00Z',
          authorLogin: 'alice',
        },
      ],
    });
    const { samples, pending } = extractSamplesFromPullRequest(data);
    expect(samples).toEqual([]);
    expect(pending.map((p) => p.reviewer)).toEqual(['bob']);
  });

  it('still emits no sample when a review is submitted before the PR was created (data anomaly)', () => {
    const data = pr({
      createdAt: '2026-04-19T18:00:00Z',
      timeline: [
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T17:00:00Z',
          authorLogin: 'alice',
        },
      ],
    });
    const { samples, pending } = extractSamplesFromPullRequest(data);
    expect(samples).toEqual([]);
    expect(pending).toEqual([]);
  });

  describe('pending extraction', () => {
    it('emits a pending entry when a reviewer is requested and never acts', () => {
      const data = pr({
        timeline: [
          {
            kind: 'ReviewRequestedEvent',
            createdAt: '2026-04-19T14:00:00Z',
            reviewerLogins: ['alice'],
          },
        ],
      });
      const { samples, pending } = extractSamplesFromPullRequest(data);
      expect(samples).toEqual([]);
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        source: 'github',
        id: 42,
        reviewer: 'alice',
        requestedAt: '2026-04-19T14:00:00Z',
      });
    });

    it('does not emit pending for a closed PR with an outstanding request', () => {
      // Closed-without-merge PRs still show outstanding review requests in the
      // timeline, but the request is no longer actionable. Emitting pending
      // stuck PR #292 in the overdue list for ~360 business hours after close.
      const data = pr({
        closed: true,
        timeline: [
          {
            kind: 'ReviewRequestedEvent',
            createdAt: '2026-04-19T14:00:00Z',
            reviewerLogins: ['alice'],
          },
        ],
      });
      const { samples, pending } = extractSamplesFromPullRequest(data);
      expect(samples).toEqual([]);
      expect(pending).toEqual([]);
    });

    it('still emits a sample for a pre-close review on a closed PR', () => {
      // A review that landed before the PR closed is legitimate completed data —
      // only pending emission is gated on open-state.
      const data = pr({
        closed: true,
        timeline: [
          {
            kind: 'ReviewRequestedEvent',
            createdAt: '2026-04-19T14:00:00Z',
            reviewerLogins: ['alice'],
          },
          {
            kind: 'PullRequestReview',
            submittedAt: '2026-04-19T16:00:00Z',
            authorLogin: 'alice',
          },
        ],
      });
      const { samples, pending } = extractSamplesFromPullRequest(data);
      expect(samples).toHaveLength(1);
      expect(samples[0]).toMatchObject({
        reviewer: 'alice',
        requestedAt: '2026-04-19T14:00:00Z',
        firstActionAt: '2026-04-19T16:00:00Z',
      });
      expect(pending).toEqual([]);
    });

    it('does not emit pending when a request is followed by a removal', () => {
      const data = pr({
        timeline: [
          {
            kind: 'ReviewRequestedEvent',
            createdAt: '2026-04-19T14:00:00Z',
            reviewerLogins: ['alice'],
          },
          {
            kind: 'ReviewRequestRemovedEvent',
            createdAt: '2026-04-19T15:00:00Z',
            reviewerLogins: ['alice'],
          },
        ],
      });
      const { samples, pending } = extractSamplesFromPullRequest(data);
      expect(samples).toEqual([]);
      expect(pending).toEqual([]);
    });

    it('does not emit pending after the reviewer has already acted, even if a later re-request came in', () => {
      const data = pr({
        timeline: [
          {
            kind: 'ReviewRequestedEvent',
            createdAt: '2026-04-19T14:00:00Z',
            reviewerLogins: ['alice'],
          },
          {
            kind: 'PullRequestReview',
            submittedAt: '2026-04-19T15:00:00Z',
            authorLogin: 'alice',
          },
          {
            kind: 'ReviewRequestedEvent',
            createdAt: '2026-04-19T16:00:00Z',
            reviewerLogins: ['alice'],
          },
        ],
      });
      const { samples, pending } = extractSamplesFromPullRequest(data);
      expect(samples).toHaveLength(1);
      expect(pending).toEqual([]);
    });

    it('uses the latest active request for a reviewer who was requested, removed, and re-requested without acting', () => {
      const data = pr({
        timeline: [
          {
            kind: 'ReviewRequestedEvent',
            createdAt: '2026-04-10T14:00:00Z',
            reviewerLogins: ['alice'],
          },
          {
            kind: 'ReviewRequestRemovedEvent',
            createdAt: '2026-04-10T15:00:00Z',
            reviewerLogins: ['alice'],
          },
          {
            kind: 'ReviewRequestedEvent',
            createdAt: '2026-04-10T16:00:00Z',
            reviewerLogins: ['alice'],
          },
        ],
      });
      const { samples, pending } = extractSamplesFromPullRequest(data);
      expect(samples).toEqual([]);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.requestedAt).toBe('2026-04-10T16:00:00Z');
    });

    it('skips team-only requests (no named reviewer) from pending', () => {
      // Team request came in but no specific user was named. We can't attribute
      // the pending request to a person, so skip it (matches the "only surface
      // things we can blame on a reviewer" rule).
      const data = pr({
        timeline: [
          {
            kind: 'ReviewRequestedEvent',
            createdAt: '2026-04-19T14:00:00Z',
            reviewerLogins: [],
            teamSlug: 'team-a',
          },
        ],
      });
      const { samples, pending } = extractSamplesFromPullRequest(data);
      expect(samples).toEqual([]);
      expect(pending).toEqual([]);
    });

    it('skips bot reviewers from pending', () => {
      const data = pr({
        timeline: [
          {
            kind: 'ReviewRequestedEvent',
            createdAt: '2026-04-19T14:00:00Z',
            reviewerLogins: ['dependabot[bot]'],
          },
        ],
      });
      const { pending } = extractSamplesFromPullRequest(data);
      expect(pending).toEqual([]);
    });

    it('skips self-pending for the PR author', () => {
      const data = pr({
        author: { login: 'alice' },
        timeline: [
          {
            kind: 'ReviewRequestedEvent',
            createdAt: '2026-04-19T14:00:00Z',
            reviewerLogins: ['alice'],
          },
        ],
      });
      const { pending } = extractSamplesFromPullRequest(data);
      expect(pending).toEqual([]);
    });

    it('emits separate pending entries for multiple unacted-on reviewers', () => {
      const data = pr({
        timeline: [
          {
            kind: 'ReviewRequestedEvent',
            createdAt: '2026-04-19T14:00:00Z',
            reviewerLogins: ['alice', 'bob'],
          },
        ],
      });
      const { pending } = extractSamplesFromPullRequest(data);
      expect(pending.map((p) => p.reviewer).sort()).toEqual(['alice', 'bob']);
    });
  });
});

const emptyPage = {
  repository: {
    pullRequests: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [],
    },
  },
};

// Drives `request` by matching the query string. Each of the two query streams
// (recent-updates and open-state) has its own queue of pages; the handler
// returns whichever queue matches the current query. Unrecognized queries
// (e.g. the timeline-tail follow-up) are served from the `other` queue in FIFO
// order. This keeps mocks oblivious to the parallel ordering of the two
// top-level fetches.
const mockGraphqlResponses = (
  queues: {
    readonly recent?: readonly unknown[];
    readonly open?: readonly unknown[];
    readonly other?: readonly unknown[];
  } = {},
): ReturnType<typeof vi.fn> => {
  const recent = [...(queues.recent ?? [])];
  const open = [...(queues.open ?? [])];
  const other = [...(queues.other ?? [])];
  return vi.fn(async (query: string): Promise<unknown> => {
    if (query.includes('OpenPullRequestPage')) {
      if (open.length === 0) return emptyPage;
      return open.shift();
    }
    if (query.includes('PullRequestPage')) {
      if (recent.length === 0) return emptyPage;
      return recent.shift();
    }
    if (other.length === 0) throw new Error(`unmocked query: ${query.slice(0, 40)}...`);
    return other.shift();
  });
};

describe('fetchGithubSamples', () => {
  it('fetches pull requests, paginates, and extracts samples', async () => {
    const request = mockGraphqlResponses({
      recent: [
        {
          repository: {
            pullRequests: {
              pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
              nodes: [
                {
                  number: 1,
                  isDraft: false,
                  createdAt: '2026-01-01T10:00:00Z',
                  updatedAt: '2026-04-19T20:00:00Z',
                  author: { login: 'author1' },
                  timelineItems: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [
                      {
                        __typename: 'ReviewRequestedEvent',
                        createdAt: '2026-04-19T14:00:00Z',
                        requestedReviewer: { __typename: 'User', login: 'alice' },
                      },
                      {
                        __typename: 'PullRequestReview',
                        submittedAt: '2026-04-19T16:00:00Z',
                        author: { login: 'alice' },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
        {
          repository: {
            pullRequests: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  number: 2,
                  isDraft: false,
                  createdAt: '2026-01-01T10:00:00Z',
                  updatedAt: '2026-04-10T20:00:00Z',
                  author: { login: 'author2' },
                  timelineItems: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [
                      {
                        __typename: 'ReviewRequestedEvent',
                        createdAt: '2026-04-05T14:00:00Z',
                        requestedReviewer: { __typename: 'User', login: 'bob' },
                      },
                      {
                        __typename: 'PullRequestReview',
                        submittedAt: '2026-04-05T15:30:00Z',
                        author: { login: 'bob' },
                      },
                    ],
                  },
                },
                {
                  number: 3,
                  isDraft: false,
                  createdAt: '2026-01-01T10:00:00Z',
                  updatedAt: '2026-03-10T12:00:00Z',
                  author: { login: 'author3' },
                  timelineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
                },
              ],
            },
          },
        },
      ],
    });
    const client: GraphqlClient = { request: request as unknown as GraphqlClient['request'] };

    const { samples, pending } = await fetchGithubSamples({
      client,
      owner: 'Pocket',
      repo: 'content-monorepo',
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
    });

    expect(samples.map((s) => s.reviewer).sort()).toEqual(['alice', 'bob']);
    expect(pending).toEqual([]);
  });

  it('paginates timeline items for a PR with more than 100 events', async () => {
    const request = mockGraphqlResponses({
      recent: [
        {
          repository: {
            pullRequests: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  number: 500,
                  isDraft: false,
                  createdAt: '2026-04-18T12:00:00Z',
                  updatedAt: '2026-04-20T20:00:00Z',
                  author: { login: 'author-500' },
                  timelineItems: {
                    pageInfo: { hasNextPage: true, endCursor: 'timeline-cursor-1' },
                    nodes: [
                      {
                        __typename: 'ReviewRequestedEvent',
                        createdAt: '2026-04-18T14:00:00Z',
                        requestedReviewer: { __typename: 'User', login: 'alice' },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      ],
      other: [
        // Timeline tail: the review event for alice (missed by the 100-item cap on page 1).
        {
          repository: {
            pullRequest: {
              timelineItems: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    __typename: 'PullRequestReview',
                    submittedAt: '2026-04-18T16:00:00Z',
                    author: { login: 'alice' },
                  },
                ],
              },
            },
          },
        },
      ],
    });
    const client: GraphqlClient = { request: request as unknown as GraphqlClient['request'] };

    const { samples } = await fetchGithubSamples({
      client,
      owner: 'Pocket',
      repo: 'content-monorepo',
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
    });

    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      source: 'github',
      id: 500,
      reviewer: 'alice',
      requestedAt: '2026-04-18T14:00:00Z',
      firstActionAt: '2026-04-18T16:00:00Z',
    });
    // Find the tail call — the query text identifies it — to confirm the fetcher
    // targeted THIS PR with THIS cursor, not something scrambled.
    const tailCall = request.mock.calls.find(([query]) =>
      String(query).includes('PullRequestTimelineTail'),
    );
    expect(tailCall?.[1]).toMatchObject({
      owner: 'Pocket',
      repo: 'content-monorepo',
      number: 500,
      cursor: 'timeline-cursor-1',
    });
  });

  it('stops paginating once PRs are older than the lookback window', async () => {
    const request = mockGraphqlResponses({
      recent: [
        {
          repository: {
            pullRequests: {
              pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
              nodes: [
                {
                  number: 1,
                  isDraft: false,
                  createdAt: '2026-01-01T10:00:00Z',
                  updatedAt: '2026-01-01T12:00:00Z',
                  author: { login: 'author1' },
                  timelineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
                },
              ],
            },
          },
        },
      ],
    });
    const client: GraphqlClient = { request: request as unknown as GraphqlClient['request'] };
    const { samples } = await fetchGithubSamples({
      client,
      owner: 'Pocket',
      repo: 'content-monorepo',
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
    });
    expect(samples).toEqual([]);
    // Recent query stops at the stale PR; open-state query runs separately and
    // (with no mocks queued) returns empty. 2 top-level calls total.
    const topLevelCalls = request.mock.calls.filter(
      ([q]) => !String(q).includes('PullRequestTimelineTail'),
    );
    expect(topLevelCalls).toHaveLength(2);
  });

  it('discovers pending requests from old-but-still-open PRs (open-state query, not recent-updates)', async () => {
    // PR #900 was opened 60 days ago, review was requested then, and nothing
    // has happened since. It falls outside the 3-day follow-up lookback, so
    // the recent-updates query misses it — but the OPEN_PR_QUERY catches it
    // and the pending reviewer shows up in the result.
    const request = mockGraphqlResponses({
      recent: [emptyPage],
      open: [
        {
          repository: {
            pullRequests: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  number: 900,
                  isDraft: false,
                  createdAt: '2026-02-18T10:00:00Z',
                  updatedAt: '2026-02-18T14:00:00Z',
                  author: { login: 'author-900' },
                  timelineItems: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [
                      {
                        __typename: 'ReviewRequestedEvent',
                        createdAt: '2026-02-18T14:00:00Z',
                        requestedReviewer: { __typename: 'User', login: 'alice' },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      ],
    });
    const client: GraphqlClient = { request: request as unknown as GraphqlClient['request'] };

    const { samples, pending } = await fetchGithubSamples({
      client,
      owner: 'Pocket',
      repo: 'content-monorepo',
      lookbackDays: 3,
      now: new Date('2026-04-20T12:00:00Z'),
    });

    expect(samples).toEqual([]);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      source: 'github',
      id: 900,
      reviewer: 'alice',
      requestedAt: '2026-02-18T14:00:00Z',
    });
  });

  it('dedupes PRs that appear in both the recent-updates and open-state queries', async () => {
    // PR #42 is both recently-updated AND open — it appears in both query
    // streams. We should extract it exactly once, not emit two duplicate
    // samples per reviewer.
    const prNode = {
      number: 42,
      isDraft: false,
      createdAt: '2026-04-18T10:00:00Z',
      updatedAt: '2026-04-19T20:00:00Z',
      author: { login: 'author-42' },
      timelineItems: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            __typename: 'ReviewRequestedEvent',
            createdAt: '2026-04-19T14:00:00Z',
            requestedReviewer: { __typename: 'User', login: 'alice' },
          },
          {
            __typename: 'PullRequestReview',
            submittedAt: '2026-04-19T16:00:00Z',
            author: { login: 'alice' },
          },
        ],
      },
    };
    const page = {
      repository: {
        pullRequests: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [prNode],
        },
      },
    };
    const request = mockGraphqlResponses({ recent: [page], open: [page] });
    const client: GraphqlClient = { request: request as unknown as GraphqlClient['request'] };

    const { samples } = await fetchGithubSamples({
      client,
      owner: 'Pocket',
      repo: 'content-monorepo',
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
    });

    expect(samples).toHaveLength(1);
    expect(samples[0]?.reviewer).toBe('alice');
  });
});

describe('extractLandingFromPullRequest', () => {
  it('returns null for an unmerged PR', () => {
    const data = pr({
      mergedAt: null,
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-19T14:00:00Z',
          reviewerLogins: ['alice'],
        },
      ],
    });
    expect(extractLandingFromPullRequest(data)).toBeNull();
  });

  it('returns a one-shot landing when merged after a single approving review', () => {
    const data = pr({
      mergedAt: '2026-04-19T18:00:00Z',
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-19T14:00:00Z',
          reviewerLogins: ['alice'],
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T16:00:00Z',
          authorLogin: 'alice',
          state: 'APPROVED',
        },
      ],
    });
    const landing = extractLandingFromPullRequest(data);
    expect(landing).not.toBeNull();
    expect(landing).toMatchObject({
      source: 'github',
      id: 42,
      author: 'author-user',
      createdAt: '2026-04-19T12:00:00Z',
      firstReviewAt: '2026-04-19T16:00:00Z',
      landedAt: '2026-04-19T18:00:00Z',
      reviewRounds: 1,
    });
  });

  it('counts reviewRounds as 1 plus the number of CHANGES_REQUESTED reviews', () => {
    const data = pr({
      mergedAt: '2026-04-22T18:00:00Z',
      timeline: [
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-20T10:00:00Z',
          authorLogin: 'alice',
          state: 'CHANGES_REQUESTED',
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-21T10:00:00Z',
          authorLogin: 'alice',
          state: 'CHANGES_REQUESTED',
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-22T10:00:00Z',
          authorLogin: 'alice',
          state: 'APPROVED',
        },
      ],
    });
    const landing = extractLandingFromPullRequest(data);
    expect(landing?.reviewRounds).toBe(3);
    expect(landing?.firstReviewAt).toBe('2026-04-20T10:00:00Z');
  });

  it('returns firstReviewAt=null when the PR merged without any human review', () => {
    const data = pr({
      mergedAt: '2026-04-19T18:00:00Z',
      timeline: [
        {
          kind: 'ReviewRequestedEvent',
          createdAt: '2026-04-19T14:00:00Z',
          reviewerLogins: ['alice'],
        },
      ],
    });
    const landing = extractLandingFromPullRequest(data);
    expect(landing).not.toBeNull();
    expect(landing?.firstReviewAt).toBeNull();
    expect(landing?.reviewRounds).toBe(1);
  });

  it('ignores bot reviews when picking firstReviewAt', () => {
    const data = pr({
      mergedAt: '2026-04-19T18:00:00Z',
      timeline: [
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T15:00:00Z',
          authorLogin: 'dependabot[bot]',
          state: 'APPROVED',
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T16:00:00Z',
          authorLogin: 'alice',
          state: 'APPROVED',
        },
      ],
    });
    const landing = extractLandingFromPullRequest(data);
    expect(landing?.firstReviewAt).toBe('2026-04-19T16:00:00Z');
    expect(landing?.reviewRounds).toBe(1);
  });

  it('ignores self-reviews by the PR author', () => {
    const data = pr({
      author: { login: 'alice' },
      mergedAt: '2026-04-19T18:00:00Z',
      timeline: [
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T15:00:00Z',
          authorLogin: 'alice',
          state: 'APPROVED',
        },
      ],
    });
    const landing = extractLandingFromPullRequest(data);
    expect(landing?.firstReviewAt).toBeNull();
    expect(landing?.reviewRounds).toBe(1);
  });

  it('ignores bot CHANGES_REQUESTED reviews in the rounds count', () => {
    const data = pr({
      mergedAt: '2026-04-20T18:00:00Z',
      timeline: [
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T15:00:00Z',
          authorLogin: 'dependabot[bot]',
          state: 'CHANGES_REQUESTED',
        },
        {
          kind: 'PullRequestReview',
          submittedAt: '2026-04-19T16:00:00Z',
          authorLogin: 'alice',
          state: 'APPROVED',
        },
      ],
    });
    expect(extractLandingFromPullRequest(data)?.reviewRounds).toBe(1);
  });
});
