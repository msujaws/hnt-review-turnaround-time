import { describe, expect, it, vi } from 'vitest';

import { fetchBugbugSamples } from './bugbug';
import { extractSamplesFromTransactions, type ConduitClient } from './phabricator';

const PROJECT_PHID = 'PHID-PROJ-newtabaaaaaaaaaaaaaa';
const TEAM_MEMBER_A = 'PHID-USER-revieweraaaaaaaaaaaaa';
const TEAM_MEMBER_B = 'PHID-USER-reviewerbbbbbbbbbbbbb';
const OUTSIDER = 'PHID-USER-outsidereviewerccccc';
const AUTHOR = 'PHID-USER-authoraaaaaaaaaaaaaa';

// Build a bugbug-format revision record. Mirrors the raw Conduit shapes: keys
// use uppercase PHID, attachments.reviewers has {reviewers:[{reviewerPHID}]},
// transactions are embedded on the record (bugbug's combined dump).
const makeRecord = (options: {
  id: number;
  phid: string;
  reviewerPhids: readonly string[];
  transactions?: readonly Record<string, unknown>[];
  authorPhid?: string;
  dateCreated?: number;
  dateModified?: number;
  status?: string;
}): Record<string, unknown> => ({
  id: options.id,
  phid: options.phid,
  fields: {
    authorPHID: options.authorPhid ?? AUTHOR,
    dateCreated: options.dateCreated ?? 1_761_000_000,
    dateModified: options.dateModified ?? 1_761_000_000,
    status: { value: options.status ?? 'needs-review' },
  },
  attachments: {
    reviewers: {
      reviewers: options.reviewerPhids.map((phid) => ({ reviewerPHID: phid })),
    },
  },
  transactions: options.transactions ?? [],
});

const reviewersAddTx = (reviewerPhid: string, when: number): Record<string, unknown> => ({
  id: 100,
  phid: 'PHID-XACT-reviewersaaaaaaaaaaaa',
  type: 'reviewers',
  authorPHID: AUTHOR,
  dateCreated: when,
  fields: { operations: [{ operation: 'add', phid: reviewerPhid }] },
});

const commentTx = (authorPhid: string, when: number): Record<string, unknown> => ({
  id: 200,
  phid: 'PHID-XACT-commentaaaaaaaaaaaaaa',
  type: 'comment',
  authorPHID: authorPhid,
  dateCreated: when,
  fields: {},
});

const statusChangeTx = (
  oldStatus: string,
  newStatus: string,
  when: number,
): Record<string, unknown> => ({
  id: 300,
  phid: 'PHID-XACT-statusaaaaaaaaaaaaaaa',
  type: 'status',
  authorPHID: AUTHOR,
  dateCreated: when,
  fields: { old: oldStatus, new: newStatus },
});

// Build a ReadableStream of bytes from a JSONL text body.
const toBody = (text: string): ReadableStream<Uint8Array> => {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
};

const ok = (body: ReadableStream<Uint8Array>): Response =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'application/zstd' } });

// Shared stub: returns team projects + usernames for all known PHIDs. Tests
// override .call on a per-case basis; this is the common baseline.
const makeClient = (
  extraLogins: ReadonlyMap<string, string> = new Map(),
): { client: ConduitClient; calls: { method: string; params: unknown }[] } => {
  const calls: { method: string; params: unknown }[] = [];
  const baseLogins = new Map<string, string>([
    [AUTHOR, 'author-user'],
    [TEAM_MEMBER_A, 'alice'],
    [TEAM_MEMBER_B, 'bob'],
    [OUTSIDER, 'charlie'],
    ...extraLogins,
  ]);
  const call: ConduitClient['call'] = async (method, params) => {
    calls.push({ method, params });
    if (method === 'project.search') {
      return {
        data: [
          {
            phid: PROJECT_PHID,
            attachments: {
              members: {
                members: [{ phid: AUTHOR }, { phid: TEAM_MEMBER_A }, { phid: TEAM_MEMBER_B }],
              },
            },
          },
        ],
      };
    }
    if (method === 'user.search') {
      const phidConstraint = (params as { constraints: { phids: string[] } }).constraints.phids;
      return {
        data: phidConstraint
          .filter((phid) => baseLogins.has(phid))
          .map((phid) => ({ phid, fields: { username: baseLogins.get(phid) ?? '' } })),
        cursor: { after: null },
      };
    }
    throw new Error(`unexpected conduit call: ${method}`);
  };
  const client: ConduitClient = { call: vi.fn(call) };
  return { client, calls };
};

describe('fetchBugbugSamples', () => {
  it('filters out revisions whose reviewers do not intersect the team', async () => {
    const jsonl = [
      makeRecord({
        id: 1,
        phid: 'PHID-DREV-inclusionrev111111ab',
        reviewerPhids: [TEAM_MEMBER_A],
        transactions: [
          reviewersAddTx(TEAM_MEMBER_A, 1_761_000_000),
          commentTx(TEAM_MEMBER_A, 1_761_003_600),
        ],
      }),
      makeRecord({
        id: 2,
        phid: 'PHID-DREV-inclusionrev222222cd',
        reviewerPhids: [TEAM_MEMBER_B],
        transactions: [
          reviewersAddTx(TEAM_MEMBER_B, 1_761_100_000),
          commentTx(TEAM_MEMBER_B, 1_761_103_600),
        ],
      }),
      makeRecord({
        id: 3,
        phid: 'PHID-DREV-offteamrevision33333',
        reviewerPhids: [OUTSIDER],
        transactions: [reviewersAddTx(OUTSIDER, 1_761_200_000), commentTx(OUTSIDER, 1_761_203_600)],
      }),
    ]
      .map((r) => JSON.stringify(r))
      .join('\n');

    const { client } = makeClient();
    const fetchFn = vi.fn(async () => ok(toBody(jsonl)));
    const result = await fetchBugbugSamples({
      conduitClient: client,
      projectSlugs: ['home-newtab-reviewers'],
      zstdCommand: ['cat'],
      fetchFn,
      now: new Date('2026-10-21T00:00:00Z'),
    });

    expect(result.samples).toHaveLength(2);
    const reviewers = result.samples.map((s) => s.reviewer).sort();
    expect(reviewers).toEqual(['alice', 'bob']);
    expect(result.samples.some((s) => s.reviewer === 'charlie')).toBe(false);
  });

  it('produces samples deep-equal to extractSamplesFromTransactions on the same inputs', async () => {
    const txs = [
      reviewersAddTx(TEAM_MEMBER_A, 1_761_000_000),
      commentTx(TEAM_MEMBER_A, 1_761_003_600),
    ];
    const record = makeRecord({
      id: 42,
      phid: 'PHID-DREV-equivalencerev42aaaa',
      reviewerPhids: [TEAM_MEMBER_A],
      transactions: txs,
    });

    const { client } = makeClient();
    const fetchFn = vi.fn(async () => ok(toBody(JSON.stringify(record))));
    const bugbug = await fetchBugbugSamples({
      conduitClient: client,
      projectSlugs: ['home-newtab-reviewers'],
      zstdCommand: ['cat'],
      fetchFn,
      now: new Date('2026-10-21T00:00:00Z'),
    });

    const direct = extractSamplesFromTransactions(
      {
        id: 42,
        phid: 'PHID-DREV-equivalencerev42aaaa',
        authorPhid: AUTHOR,
        dateModified: 1_761_000_000,
        dateCreated: 1_761_000_000,
        status: 'needs-review',
      },
      [
        {
          id: 100,
          phid: 'PHID-XACT-reviewersaaaaaaaaaaaa',
          type: 'reviewers',
          authorPhid: AUTHOR,
          dateCreated: 1_761_000_000,
          fields: { operations: [{ operation: 'add', phid: TEAM_MEMBER_A }] },
        },
        {
          id: 200,
          phid: 'PHID-XACT-commentaaaaaaaaaaaaaa',
          type: 'comment',
          authorPhid: TEAM_MEMBER_A,
          dateCreated: 1_761_003_600,
          fields: {},
        },
      ],
      new Map([
        [AUTHOR, 'author-user'],
        [TEAM_MEMBER_A, 'alice'],
      ]),
      { allowedReviewerPhids: new Set([TEAM_MEMBER_A, TEAM_MEMBER_B]) },
    );

    expect(bugbug.samples).toEqual(direct.samples);
    expect(bugbug.pending).toEqual(direct.pending);
  });

  it('skips malformed JSONL lines without throwing', async () => {
    const valid1 = JSON.stringify(
      makeRecord({
        id: 1,
        phid: 'PHID-DREV-validonetransactionx',
        reviewerPhids: [TEAM_MEMBER_A],
        transactions: [
          reviewersAddTx(TEAM_MEMBER_A, 1_761_000_000),
          commentTx(TEAM_MEMBER_A, 1_761_003_600),
        ],
      }),
    );
    const garbage = '{ this is not: valid json';
    const valid2 = JSON.stringify(
      makeRecord({
        id: 2,
        phid: 'PHID-DREV-validtworesolveddevb',
        reviewerPhids: [TEAM_MEMBER_B],
        transactions: [
          reviewersAddTx(TEAM_MEMBER_B, 1_761_100_000),
          commentTx(TEAM_MEMBER_B, 1_761_103_600),
        ],
      }),
    );
    const jsonl = [valid1, garbage, valid2].join('\n');

    const { client } = makeClient();
    const fetchFn = vi.fn(async () => ok(toBody(jsonl)));
    const result = await fetchBugbugSamples({
      conduitClient: client,
      projectSlugs: ['home-newtab-reviewers'],
      zstdCommand: ['cat'],
      fetchFn,
      now: new Date('2026-10-21T00:00:00Z'),
    });

    expect(result.samples).toHaveLength(2);
  });

  it('returns empty arrays for an empty dump', async () => {
    // Note: user.search still fires on an empty dump now that teamLogins is
    // part of the return contract — every team-member PHID must resolve to a
    // login so the caller can purge legacy rows by login. The old "no
    // user.search on empty" assertion was specific to a pre-teamLogins era.
    const { client } = makeClient();
    const fetchFn = vi.fn(async () => ok(toBody('')));
    const result = await fetchBugbugSamples({
      conduitClient: client,
      projectSlugs: ['home-newtab-reviewers'],
      zstdCommand: ['cat'],
      fetchFn,
      now: new Date('2026-10-21T00:00:00Z'),
    });

    expect(result.samples).toEqual([]);
    expect(result.pending).toEqual([]);
    expect(result.landings).toEqual([]);
  });

  it('throws when the artifact endpoint returns 404', async () => {
    const { client } = makeClient();
    const fetchFn = vi.fn(
      async () =>
        new Response('', {
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
        }),
    );
    await expect(
      fetchBugbugSamples({
        conduitClient: client,
        projectSlugs: ['home-newtab-reviewers'],
        zstdCommand: ['cat'],
        fetchFn,
        now: new Date('2026-10-21T00:00:00Z'),
      }),
    ).rejects.toThrow(/404/);
  });

  it('ignores transactions authored by non-team users', async () => {
    // The revision itself passes the team filter (team member is in
    // attachments.reviewers), but the comment we care about is by an outsider.
    // extractSamplesFromTransactions must not emit a sample for the outsider.
    const record = makeRecord({
      id: 77,
      phid: 'PHID-DREV-offteamtxauthor77777',
      reviewerPhids: [TEAM_MEMBER_A],
      transactions: [
        reviewersAddTx(TEAM_MEMBER_A, 1_761_000_000),
        reviewersAddTx(OUTSIDER, 1_761_000_000),
        commentTx(OUTSIDER, 1_761_003_600),
      ],
    });
    const { client } = makeClient();
    const fetchFn = vi.fn(async () => ok(toBody(JSON.stringify(record))));
    const result = await fetchBugbugSamples({
      conduitClient: client,
      projectSlugs: ['home-newtab-reviewers'],
      zstdCommand: ['cat'],
      fetchFn,
      now: new Date('2026-10-21T00:00:00Z'),
    });

    expect(result.samples.some((s) => s.reviewer === 'charlie')).toBe(false);
  });

  it('preserves operations / old / new transaction fields through to landings', async () => {
    // A full revision lifecycle: reviewer added, accepts, close. The landing
    // extractor needs the `close` transaction type; status old/new round-trip
    // is exercised on the preceding status change.
    const record = makeRecord({
      id: 99,
      phid: 'PHID-DREV-fulllifecyclerev999a',
      reviewerPhids: [TEAM_MEMBER_A],
      status: 'published',
      transactions: [
        reviewersAddTx(TEAM_MEMBER_A, 1_761_000_000),
        {
          id: 400,
          phid: 'PHID-XACT-acceptaaaaaaaaaaaaaa',
          type: 'accept',
          authorPHID: TEAM_MEMBER_A,
          dateCreated: 1_761_003_600,
          fields: {},
        },
        statusChangeTx('needs-review', 'accepted', 1_761_003_600),
        {
          id: 500,
          phid: 'PHID-XACT-closeaaaaaaaaaaaaaaa',
          type: 'close',
          authorPHID: AUTHOR,
          dateCreated: 1_761_007_200,
          fields: {},
        },
      ],
    });

    const { client } = makeClient();
    const fetchFn = vi.fn(async () => ok(toBody(JSON.stringify(record))));
    const result = await fetchBugbugSamples({
      conduitClient: client,
      projectSlugs: ['home-newtab-reviewers'],
      zstdCommand: ['cat'],
      fetchFn,
      now: new Date('2026-10-21T00:00:00Z'),
    });

    expect(result.landings).toHaveLength(1);
    expect(result.landings[0]).toMatchObject({
      source: 'phab',
      id: 'PHID-DREV-fulllifecyclerev999a',
      revisionId: 99,
      author: 'author-user',
      landedAt: new Date(1_761_007_200 * 1000).toISOString(),
      firstReviewAt: new Date(1_761_003_600 * 1000).toISOString(),
      reviewRounds: 1,
    });
  });

  it('drops revisions authored by a non-team member, even when a team reviewer acted', async () => {
    // A team reviewer comments on an outsider's revision. Previously this
    // would emit a sample + landing; with the author gate on, both drop out.
    const outsiderAuthor = 'PHID-USER-outsideauthoraaaaaa';
    const record = makeRecord({
      id: 88,
      phid: 'PHID-DREV-outsideauthorrev88xx',
      reviewerPhids: [TEAM_MEMBER_A],
      authorPhid: outsiderAuthor,
      status: 'published',
      transactions: [
        {
          id: 100,
          phid: 'PHID-XACT-reviewersaaaaaaaaaaaa',
          type: 'reviewers',
          authorPHID: outsiderAuthor,
          dateCreated: 1_761_000_000,
          fields: { operations: [{ operation: 'add', phid: TEAM_MEMBER_A }] },
        },
        commentTx(TEAM_MEMBER_A, 1_761_003_600),
        {
          id: 500,
          phid: 'PHID-XACT-closeaaaaaaaaaaaaaaa',
          type: 'close',
          authorPHID: outsiderAuthor,
          dateCreated: 1_761_007_200,
          fields: {},
        },
      ],
    });

    const { client } = makeClient(new Map([[outsiderAuthor, 'outsider']]));
    const fetchFn = vi.fn(async () => ok(toBody(JSON.stringify(record))));
    const result = await fetchBugbugSamples({
      conduitClient: client,
      projectSlugs: ['home-newtab-reviewers'],
      zstdCommand: ['cat'],
      fetchFn,
      now: new Date('2026-10-21T00:00:00Z'),
    });

    expect(result.samples).toEqual([]);
    expect(result.pending).toEqual([]);
    expect(result.landings).toEqual([]);
  });

  it('returns teamLogins resolved from the project members', async () => {
    const { client } = makeClient();
    const fetchFn = vi.fn(async () => ok(toBody('')));
    const result = await fetchBugbugSamples({
      conduitClient: client,
      projectSlugs: ['home-newtab-reviewers'],
      zstdCommand: ['cat'],
      fetchFn,
      now: new Date('2026-10-21T00:00:00Z'),
    });
    expect([...result.teamLogins].sort()).toEqual(['alice', 'author-user', 'bob']);
  });
});
