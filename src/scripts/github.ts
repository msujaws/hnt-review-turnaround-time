import { graphql } from '@octokit/graphql';
import { z } from 'zod';

import {
  asIsoTimestamp,
  asPrNumber,
  asReviewerLogin,
  type IsoTimestamp,
  type PrNumber,
  type ReviewerLogin,
} from '../types/brand';

export interface GithubSample {
  readonly source: 'github';
  readonly id: PrNumber;
  readonly reviewer: ReviewerLogin;
  readonly requestedAt: IsoTimestamp;
  readonly firstActionAt: IsoTimestamp;
}

export interface GithubPendingSample {
  readonly source: 'github';
  readonly id: PrNumber;
  readonly reviewer: ReviewerLogin;
  readonly requestedAt: IsoTimestamp;
}

export interface ExtractedPullRequest {
  readonly samples: readonly GithubSample[];
  readonly pending: readonly GithubPendingSample[];
}

export type TimelineEvent =
  | {
      readonly kind: 'ReviewRequestedEvent';
      readonly createdAt: string;
      readonly reviewerLogins: readonly string[];
      readonly teamSlug?: string;
    }
  | {
      readonly kind: 'ReviewRequestRemovedEvent';
      readonly createdAt: string;
      readonly reviewerLogins: readonly string[];
      readonly teamSlug?: string;
    }
  | {
      readonly kind: 'PullRequestReview';
      readonly submittedAt: string;
      readonly authorLogin: string;
    };

export interface PullRequestData {
  readonly number: number;
  readonly isDraft: boolean;
  readonly author: { readonly login: string };
  readonly createdAt: string;
  readonly timeline: readonly TimelineEvent[];
}

export interface GraphqlClient {
  request: <T>(query: string, variables: Record<string, unknown>) => Promise<T>;
}

const isBot = (login: string): boolean => login.endsWith('[bot]');

const eventTime = (event: TimelineEvent): string =>
  event.kind === 'PullRequestReview' ? event.submittedAt : event.createdAt;

const unknownTeamKey = (createdAt: string): string => `__unknown__:${createdAt}`;

const earliest = (values: readonly string[]): string | undefined => {
  let min: string | undefined;
  for (const value of values) {
    if (min === undefined || value < min) min = value;
  }
  return min;
};

export const extractSamplesFromPullRequest = (data: PullRequestData): ExtractedPullRequest => {
  if (data.isDraft) return { samples: [], pending: [] };

  const hasAnyRequestEvent = data.timeline.some((event) => event.kind === 'ReviewRequestedEvent');
  const ordered = [...data.timeline].sort((a, b) => eventTime(a).localeCompare(eventTime(b)));

  // Per-reviewer active request timestamps (cleared on remove), and per-team
  // active request timestamps keyed by team slug. Team requests whose slug
  // isn't visible to the PAT get a synthetic FIFO key ("__unknown__:<createdAt>")
  // so an unknown-team remove only pairs with the oldest still-active unknown
  // request, instead of wiping every unknown team in one shot.
  const explicitRequestAt = new Map<string, string>();
  const teamRequestAt = new Map<string, string>();
  const emitted = new Map<string, { requestedAt: string; firstActionAt: string }>();

  for (const event of ordered) {
    if (event.kind === 'ReviewRequestedEvent' || event.kind === 'ReviewRequestRemovedEvent') {
      if (event.reviewerLogins.length === 0) {
        if (event.teamSlug !== undefined) {
          if (event.kind === 'ReviewRequestedEvent') {
            teamRequestAt.set(event.teamSlug, event.createdAt);
          } else {
            teamRequestAt.delete(event.teamSlug);
          }
        } else if (event.kind === 'ReviewRequestedEvent') {
          teamRequestAt.set(unknownTeamKey(event.createdAt), event.createdAt);
        } else {
          // FIFO: pair this remove with the earliest still-active unknown team.
          const oldestUnknownKey = [...teamRequestAt.keys()]
            .filter((k) => k.startsWith('__unknown__:'))
            .sort((a, b) =>
              (teamRequestAt.get(a) ?? '').localeCompare(teamRequestAt.get(b) ?? ''),
            )[0];
          if (oldestUnknownKey !== undefined) teamRequestAt.delete(oldestUnknownKey);
        }
      } else {
        for (const login of event.reviewerLogins) {
          if (isBot(login) || login === data.author.login) continue;
          if (event.kind === 'ReviewRequestedEvent') {
            explicitRequestAt.set(login, event.createdAt);
          } else {
            explicitRequestAt.delete(login);
          }
        }
      }
      continue;
    }
    if (isBot(event.authorLogin) || event.authorLogin === data.author.login) continue;
    if (emitted.has(event.authorLogin)) continue;
    const reviewAt = event.submittedAt;
    // Pick the earliest still-active request (explicit or team) at or before the
    // review. The reviewer was on the hook from the earliest request they saw.
    const candidates: string[] = [];
    const explicitAt = explicitRequestAt.get(event.authorLogin);
    if (explicitAt !== undefined && explicitAt <= reviewAt) candidates.push(explicitAt);
    for (const t of teamRequestAt.values()) {
      if (t <= reviewAt) candidates.push(t);
    }
    let requestAt = earliest(candidates);
    if (requestAt === undefined && !hasAnyRequestEvent && data.createdAt <= reviewAt) {
      requestAt = data.createdAt;
    }
    if (requestAt === undefined) continue;
    emitted.set(event.authorLogin, { requestedAt: requestAt, firstActionAt: reviewAt });
  }

  const samples: GithubSample[] = [];
  for (const [reviewer, { requestedAt, firstActionAt }] of emitted) {
    samples.push({
      source: 'github',
      id: asPrNumber(data.number),
      reviewer: asReviewerLogin(reviewer),
      requestedAt: asIsoTimestamp(requestedAt),
      firstActionAt: asIsoTimestamp(firstActionAt),
    });
  }

  // Pending = explicit per-reviewer requests still active at the end of the
  // timeline for reviewers who never produced a sample. Team-only requests are
  // skipped: we can't attribute them to a named reviewer.
  const pending: GithubPendingSample[] = [];
  for (const [reviewer, requestedAt] of explicitRequestAt) {
    if (emitted.has(reviewer)) continue;
    pending.push({
      source: 'github',
      id: asPrNumber(data.number),
      reviewer: asReviewerLogin(reviewer),
      requestedAt: asIsoTimestamp(requestedAt),
    });
  }

  return { samples, pending };
};

const TIMELINE_FIELDS = `
  nodes {
    __typename
    ... on ReviewRequestedEvent {
      createdAt
      requestedReviewer {
        __typename
        ... on User { login }
        ... on Team { slug }
      }
    }
    ... on ReviewRequestRemovedEvent {
      createdAt
      requestedReviewer {
        __typename
        ... on User { login }
        ... on Team { slug }
      }
    }
    ... on PullRequestReview {
      submittedAt
      author { login }
    }
  }
`;

const PR_QUERY = `
  query PullRequestPage($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequests(first: 100, after: $cursor, orderBy: { field: UPDATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number
          isDraft
          createdAt
          updatedAt
          author { login }
          timelineItems(
            first: 100
            itemTypes: [REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT, PULL_REQUEST_REVIEW]
          ) {
            pageInfo { hasNextPage endCursor }
            ${TIMELINE_FIELDS}
          }
        }
      }
    }
  }
`;

// Open PRs only, regardless of last-updated time. Catches stale-but-still-open
// PRs that the recent-updates query would miss, so pending review requests on
// an untouched old PR are still discovered. Capped via OPEN_PR_HARD_CAP below.
const OPEN_PR_QUERY = `
  query OpenPullRequestPage($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequests(
        first: 100
        after: $cursor
        states: [OPEN]
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number
          isDraft
          createdAt
          updatedAt
          author { login }
          timelineItems(
            first: 100
            itemTypes: [REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT, PULL_REQUEST_REVIEW]
          ) {
            pageInfo { hasNextPage endCursor }
            ${TIMELINE_FIELDS}
          }
        }
      }
    }
  }
`;

// Hard cap on the open-state query to stay well inside GitHub's 500k-node
// budget. 200 PRs × 100 timeline nodes = ~20k nodes.
const OPEN_PR_HARD_CAP = 200;

const TIMELINE_TAIL_QUERY = `
  query PullRequestTimelineTail($owner: String!, $repo: String!, $number: Int!, $cursor: String!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        timelineItems(
          first: 100
          after: $cursor
          itemTypes: [REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT, PULL_REQUEST_REVIEW]
        ) {
          pageInfo { hasNextPage endCursor }
          ${TIMELINE_FIELDS}
        }
      }
    }
  }
`;

const requestedReviewerSchema = z
  .object({ __typename: z.string(), login: z.string().optional(), slug: z.string().optional() })
  .passthrough()
  .nullable();

const timelineNodeSchema = z.discriminatedUnion('__typename', [
  z.object({
    __typename: z.literal('ReviewRequestedEvent'),
    createdAt: z.string(),
    requestedReviewer: requestedReviewerSchema,
  }),
  z.object({
    __typename: z.literal('ReviewRequestRemovedEvent'),
    createdAt: z.string(),
    requestedReviewer: requestedReviewerSchema,
  }),
  z.object({
    __typename: z.literal('PullRequestReview'),
    submittedAt: z.string().nullable(),
    author: z.object({ login: z.string() }).nullable(),
  }),
]);

const timelinePageSchema = z.object({
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  nodes: z.array(timelineNodeSchema),
});

const pullRequestNodeSchema = z.object({
  number: z.number(),
  isDraft: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  author: z.object({ login: z.string() }).nullable(),
  timelineItems: timelinePageSchema,
});

const pageSchema = z.object({
  repository: z.object({
    pullRequests: z.object({
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
      nodes: z.array(pullRequestNodeSchema),
    }),
  }),
});

const timelineTailSchema = z.object({
  repository: z.object({
    pullRequest: z.object({ timelineItems: timelinePageSchema }),
  }),
});

const toPullRequestData = (node: z.infer<typeof pullRequestNodeSchema>): PullRequestData => {
  const timeline: TimelineEvent[] = [];
  for (const item of node.timelineItems.nodes) {
    if (
      item.__typename === 'ReviewRequestedEvent' ||
      item.__typename === 'ReviewRequestRemovedEvent'
    ) {
      const reviewer = item.requestedReviewer;
      const reviewerLogins =
        reviewer !== null && reviewer.__typename === 'User' && reviewer.login !== undefined
          ? [reviewer.login]
          : [];
      const teamSlug =
        reviewer !== null && reviewer.__typename === 'Team' && reviewer.slug !== undefined
          ? reviewer.slug
          : undefined;
      if (item.__typename === 'ReviewRequestedEvent') {
        timeline.push({
          kind: 'ReviewRequestedEvent',
          createdAt: item.createdAt,
          reviewerLogins,
          ...(teamSlug === undefined ? {} : { teamSlug }),
        });
      } else {
        timeline.push({
          kind: 'ReviewRequestRemovedEvent',
          createdAt: item.createdAt,
          reviewerLogins,
          ...(teamSlug === undefined ? {} : { teamSlug }),
        });
      }
    } else {
      if (item.submittedAt === null || item.author === null) continue;
      timeline.push({
        kind: 'PullRequestReview',
        submittedAt: item.submittedAt,
        authorLogin: item.author.login,
      });
    }
  }
  return {
    number: node.number,
    isDraft: node.isDraft,
    author: { login: node.author?.login ?? '' },
    createdAt: node.createdAt,
    timeline,
  };
};

const fetchRemainingTimeline = async (
  client: GraphqlClient,
  owner: string,
  repo: string,
  number: number,
  initialCursor: string,
): Promise<z.infer<typeof timelineNodeSchema>[]> => {
  const extra: z.infer<typeof timelineNodeSchema>[] = [];
  let cursor: string | null = initialCursor;
  while (cursor !== null) {
    const raw = await client.request<unknown>(TIMELINE_TAIL_QUERY, {
      owner,
      repo,
      number,
      cursor,
    });
    const parsed = timelineTailSchema.parse(raw);
    const page = parsed.repository.pullRequest.timelineItems;
    extra.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  }
  return extra;
};

const hydratePullRequest = async (
  client: GraphqlClient,
  owner: string,
  repo: string,
  node: z.infer<typeof pullRequestNodeSchema>,
): Promise<PullRequestData> => {
  const tailCursor = node.timelineItems.pageInfo.endCursor;
  const combinedNodes =
    node.timelineItems.pageInfo.hasNextPage && tailCursor !== null
      ? [
          ...node.timelineItems.nodes,
          ...(await fetchRemainingTimeline(client, owner, repo, node.number, tailCursor)),
        ]
      : node.timelineItems.nodes;
  return toPullRequestData({
    ...node,
    timelineItems: { pageInfo: node.timelineItems.pageInfo, nodes: combinedNodes },
  });
};

const collectRecentlyUpdatedPullRequests = async (
  client: GraphqlClient,
  owner: string,
  repo: string,
  cutoffIso: string,
): Promise<PullRequestData[]> => {
  const results: PullRequestData[] = [];
  let cursor: string | null = null;
  let stop = false;
  while (!stop) {
    const raw = await client.request<unknown>(PR_QUERY, { owner, repo, cursor });
    const parsed = pageSchema.parse(raw);
    const page = parsed.repository.pullRequests;
    for (const node of page.nodes) {
      if (node.updatedAt < cutoffIso) {
        stop = true;
        break;
      }
      results.push(await hydratePullRequest(client, owner, repo, node));
    }
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) {
      stop = true;
    } else {
      cursor = page.pageInfo.endCursor;
    }
  }
  return results;
};

const collectOpenPullRequests = async (
  client: GraphqlClient,
  owner: string,
  repo: string,
): Promise<PullRequestData[]> => {
  const results: PullRequestData[] = [];
  let cursor: string | null = null;
  while (results.length < OPEN_PR_HARD_CAP) {
    const raw = await client.request<unknown>(OPEN_PR_QUERY, { owner, repo, cursor });
    const parsed = pageSchema.parse(raw);
    const page = parsed.repository.pullRequests;
    for (const node of page.nodes) {
      if (results.length >= OPEN_PR_HARD_CAP) break;
      results.push(await hydratePullRequest(client, owner, repo, node));
    }
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) break;
    cursor = page.pageInfo.endCursor;
  }
  return results;
};

export const fetchGithubSamples = async (params: {
  readonly client: GraphqlClient;
  readonly owner: string;
  readonly repo: string;
  readonly lookbackDays: number;
  readonly now?: Date;
}): Promise<{ samples: GithubSample[]; pending: GithubPendingSample[] }> => {
  const { client, owner, repo, lookbackDays } = params;
  const now = params.now ?? new Date();
  const cutoff = new Date(now.getTime() - lookbackDays * 86_400 * 1000).toISOString();

  // Two independent PR fetches, deduped by number:
  // 1. Recently-updated PRs (any state) — picks up newly completed reviews.
  // 2. Open PRs (any update time) — authoritative current pending state.
  const [recent, open] = await Promise.all([
    collectRecentlyUpdatedPullRequests(client, owner, repo, cutoff),
    collectOpenPullRequests(client, owner, repo),
  ]);
  const byNumber = new Map<number, PullRequestData>();
  for (const pr of [...recent, ...open]) byNumber.set(pr.number, pr);

  const samples: GithubSample[] = [];
  const pending: GithubPendingSample[] = [];
  for (const pr of byNumber.values()) {
    const extracted = extractSamplesFromPullRequest(pr);
    samples.push(...extracted.samples);
    pending.push(...extracted.pending);
  }
  return { samples, pending };
};

export const createGithubClient = (token: string): GraphqlClient => {
  const instance = graphql.defaults({
    headers: { authorization: `token ${token}` },
  });
  return {
    request: async <T>(query: string, variables: Record<string, unknown>): Promise<T> =>
      instance<T>(query, variables),
  };
};
