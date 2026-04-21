import { describe, expect, it, vi } from 'vitest';

import {
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
    expect(extractSamplesFromPullRequest(data)).toEqual([]);
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
    const samples = extractSamplesFromPullRequest(data);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      source: 'github',
      id: 42,
      reviewer: 'alice',
      requestedAt: '2026-04-19T14:00:00Z',
      firstActionAt: '2026-04-19T16:00:00Z',
    });
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
    expect(extractSamplesFromPullRequest(data)).toEqual([]);
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
    expect(extractSamplesFromPullRequest(data)).toEqual([]);
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
    const samples = extractSamplesFromPullRequest(data);
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
    const samples = extractSamplesFromPullRequest(data);
    expect(samples.map((s) => s.reviewer).sort()).toEqual(['alice', 'bob']);
  });

  it('does not emit a sample for a reviewer who has not submitted', () => {
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
    const samples = extractSamplesFromPullRequest(data);
    expect(samples.map((s) => s.reviewer)).toEqual(['alice']);
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
    expect(extractSamplesFromPullRequest(data)).toEqual([]);
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
    const samples = extractSamplesFromPullRequest(data);
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
    const samples = extractSamplesFromPullRequest(data);
    expect(samples[0]?.requestedAt).toBe('2026-04-19T14:00:00Z');
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
    const samples = extractSamplesFromPullRequest(data);
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
    const samples = extractSamplesFromPullRequest(data);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      reviewer: 'Herraj',
      requestedAt: '2026-03-16T20:00:00Z',
      firstActionAt: '2026-03-16T20:40:19Z',
    });
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
    expect(extractSamplesFromPullRequest(data)).toEqual([]);
  });
});

describe('fetchGithubSamples', () => {
  it('fetches pull requests, paginates, and extracts samples', async () => {
    const request = vi.fn();
    const client: GraphqlClient = { request: request as unknown as GraphqlClient['request'] };
    request.mockResolvedValueOnce({
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
    });
    request.mockResolvedValueOnce({
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
              timelineItems: { nodes: [] },
            },
          ],
        },
      },
    });

    const samples = await fetchGithubSamples({
      client,
      owner: 'Pocket',
      repo: 'content-monorepo',
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(samples.map((s) => s.reviewer).sort()).toEqual(['alice', 'bob']);
  });

  it('stops paginating once PRs are older than the lookback window', async () => {
    const request = vi.fn();
    const client: GraphqlClient = { request: request as unknown as GraphqlClient['request'] };
    request.mockResolvedValueOnce({
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
              timelineItems: { nodes: [] },
            },
          ],
        },
      },
    });
    const samples = await fetchGithubSamples({
      client,
      owner: 'Pocket',
      repo: 'content-monorepo',
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
    });
    expect(samples).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
