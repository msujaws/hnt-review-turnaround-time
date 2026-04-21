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

export type TimelineEvent =
  | {
      readonly kind: 'ReviewRequestedEvent';
      readonly createdAt: string;
      readonly reviewerLogins: readonly string[];
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
  readonly timeline: readonly TimelineEvent[];
}

export interface GraphqlClient {
  request: <T>(query: string, variables: Record<string, unknown>) => Promise<T>;
}

const isBot = (login: string): boolean => login.endsWith('[bot]');

export const extractSamplesFromPullRequest = (data: PullRequestData): GithubSample[] => {
  if (data.isDraft) return [];

  const requestedAtByReviewer = new Map<string, string>();
  for (const event of data.timeline) {
    if (event.kind !== 'ReviewRequestedEvent') continue;
    for (const login of event.reviewerLogins) {
      if (isBot(login)) continue;
      if (login === data.author.login) continue;
      if (!requestedAtByReviewer.has(login)) {
        requestedAtByReviewer.set(login, event.createdAt);
      }
    }
  }

  const samples: GithubSample[] = [];
  for (const [reviewer, requestedAt] of requestedAtByReviewer) {
    const firstAction = data.timeline
      .filter(
        (event): event is Extract<TimelineEvent, { kind: 'PullRequestReview' }> =>
          event.kind === 'PullRequestReview' &&
          event.authorLogin === reviewer &&
          event.submittedAt >= requestedAt,
      )
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))[0];
    if (firstAction === undefined) continue;
    samples.push({
      source: 'github',
      id: asPrNumber(data.number),
      reviewer: asReviewerLogin(reviewer),
      requestedAt: asIsoTimestamp(requestedAt),
      firstActionAt: asIsoTimestamp(firstAction.submittedAt),
    });
  }
  return samples;
};

const PR_QUERY = `
  query PullRequestPage($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequests(first: 25, after: $cursor, orderBy: { field: UPDATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number
          isDraft
          updatedAt
          author { login }
          timelineItems(first: 100, itemTypes: [REVIEW_REQUESTED_EVENT, PULL_REQUEST_REVIEW]) {
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
              ... on PullRequestReview {
                submittedAt
                author { login }
              }
            }
          }
        }
      }
    }
  }
`;

const userReviewerSchema = z.object({ __typename: z.literal('User'), login: z.string() });
const teamReviewerSchema = z.object({
  __typename: z.literal('Team'),
  slug: z.string(),
});

const timelineNodeSchema = z.discriminatedUnion('__typename', [
  z.object({
    __typename: z.literal('ReviewRequestedEvent'),
    createdAt: z.string(),
    requestedReviewer: z.union([userReviewerSchema, teamReviewerSchema]).nullable(),
  }),
  z.object({
    __typename: z.literal('PullRequestReview'),
    submittedAt: z.string().nullable(),
    author: z.object({ login: z.string() }).nullable(),
  }),
]);

const pullRequestNodeSchema = z.object({
  number: z.number(),
  isDraft: z.boolean(),
  updatedAt: z.string(),
  author: z.object({ login: z.string() }).nullable(),
  timelineItems: z.object({ nodes: z.array(timelineNodeSchema) }),
});

const pageSchema = z.object({
  repository: z.object({
    pullRequests: z.object({
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
      nodes: z.array(pullRequestNodeSchema),
    }),
  }),
});

const toPullRequestData = (node: z.infer<typeof pullRequestNodeSchema>): PullRequestData => {
  const timeline: TimelineEvent[] = [];
  for (const item of node.timelineItems.nodes) {
    if (item.__typename === 'ReviewRequestedEvent') {
      const reviewer = item.requestedReviewer;
      if (reviewer === null) continue;
      if (reviewer.__typename !== 'User') continue;
      timeline.push({
        kind: 'ReviewRequestedEvent',
        createdAt: item.createdAt,
        reviewerLogins: [reviewer.login],
      });
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
    timeline,
  };
};

export const fetchGithubSamples = async (params: {
  readonly client: GraphqlClient;
  readonly owner: string;
  readonly repo: string;
  readonly lookbackDays: number;
  readonly now?: Date;
}): Promise<GithubSample[]> => {
  const { client, owner, repo, lookbackDays } = params;
  const now = params.now ?? new Date();
  const cutoff = new Date(now.getTime() - lookbackDays * 86_400 * 1000).toISOString();

  const samples: GithubSample[] = [];
  let cursor: string | null = null;
  let stop = false;
  while (!stop) {
    const raw = await client.request<unknown>(PR_QUERY, { owner, repo, cursor });
    const parsed = pageSchema.parse(raw);
    const page = parsed.repository.pullRequests;
    for (const node of page.nodes) {
      if (node.updatedAt < cutoff) {
        stop = true;
        continue;
      }
      samples.push(...extractSamplesFromPullRequest(toPullRequestData(node)));
    }
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) {
      stop = true;
    } else {
      cursor = page.pageInfo.endCursor;
    }
  }
  return samples;
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
