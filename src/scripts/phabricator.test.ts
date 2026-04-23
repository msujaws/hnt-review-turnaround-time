import { describe, expect, it, vi } from 'vitest';

import {
  createConduitClient,
  extractLandingFromTransactions,
  extractSamplesFromTransactions,
  fetchPhabSamples,
  type ConduitClient,
  type PhabRevision,
  type PhabTransaction,
} from './phabricator';

const revision = (): PhabRevision => ({
  id: 234_567,
  phid: 'PHID-DREV-abcdefghijklmnopqrst',
  authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
  dateModified: 1_761_000_000,
});

const mkTransaction = (partial: Partial<PhabTransaction>): PhabTransaction => ({
  id: 1,
  phid: 'PHID-XACT-DREV-aaaaaaaaaaaaaaaaaaaa',
  type: 'comment',
  authorPhid: 'PHID-USER-revieweraaaaaaaaaaaaa',
  dateCreated: 1_761_000_000,
  fields: {},
  ...partial,
});

const loginByPhid = new Map<string, string>([
  ['PHID-USER-authoraaaaaaaaaaaaaa', 'author-user'],
  ['PHID-USER-revieweraaaaaaaaaaaaa', 'alice'],
  ['PHID-USER-reviewerbbbbbbbbbbbbb', 'bob'],
  ['PHID-USER-outsidereviewerccccc', 'charlie'],
]);

// Shared fixture: reviewer 'alice' is requested and never acts. Under an open
// revision status we'd emit pending; under a terminal status we must not.
const requestedButNeverActed = (): PhabTransaction[] => [
  mkTransaction({
    id: 1,
    type: 'reviewers',
    authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
    dateCreated: 1_761_000_000,
    fields: {
      operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
    },
  }),
];

describe('extractSamplesFromTransactions', () => {
  it('returns no samples when there are no transactions', () => {
    const result = extractSamplesFromTransactions(revision(), [], loginByPhid);
    expect(result.samples).toEqual([]);
    expect(result.pending).toEqual([]);
  });

  it('returns no sample but emits pending when a reviewer is added and never acts', () => {
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'reviewers',
        authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
        dateCreated: 1_761_000_000,
        fields: {
          operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
        },
      }),
    ];
    const { samples, pending } = extractSamplesFromTransactions(revision(), txs, loginByPhid);
    expect(samples).toEqual([]);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      source: 'phab',
      id: 'PHID-DREV-abcdefghijklmnopqrst',
      revisionId: 234_567,
      author: 'author-user',
      reviewer: 'alice',
      requestedAt: new Date(1_761_000_000 * 1000).toISOString(),
    });
  });

  it('emits a sample when a reviewer is added and later comments', () => {
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'reviewers',
        authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
        dateCreated: 1_761_000_000,
        fields: {
          operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
        },
      }),
      mkTransaction({
        id: 2,
        type: 'comment',
        authorPhid: 'PHID-USER-revieweraaaaaaaaaaaaa',
        dateCreated: 1_761_003_600,
      }),
    ];
    const { samples, pending } = extractSamplesFromTransactions(revision(), txs, loginByPhid);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      source: 'phab',
      id: 'PHID-DREV-abcdefghijklmnopqrst',
      revisionId: 234_567,
      author: 'author-user',
      reviewer: 'alice',
    });
    expect(pending).toEqual([]);
  });

  it('treats accept as a reviewer action', () => {
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'reviewers',
        authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
        dateCreated: 1_761_000_000,
        fields: {
          operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
        },
      }),
      mkTransaction({
        id: 2,
        type: 'accept',
        authorPhid: 'PHID-USER-revieweraaaaaaaaaaaaa',
        dateCreated: 1_761_007_200,
      }),
    ];
    expect(extractSamplesFromTransactions(revision(), txs, loginByPhid).samples).toHaveLength(1);
  });

  it('ignores comments by the revision author', () => {
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'reviewers',
        authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
        dateCreated: 1_761_000_000,
        fields: {
          operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
        },
      }),
      mkTransaction({
        id: 2,
        type: 'comment',
        authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
        dateCreated: 1_761_003_600,
      }),
    ];
    const { samples } = extractSamplesFromTransactions(revision(), txs, loginByPhid);
    expect(samples).toEqual([]);
  });

  it('emits one sample per reviewer', () => {
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'reviewers',
        authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
        dateCreated: 1_761_000_000,
        fields: {
          operations: [
            { operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' },
            { operation: 'add', phid: 'PHID-USER-reviewerbbbbbbbbbbbbb' },
          ],
        },
      }),
      mkTransaction({
        id: 2,
        type: 'comment',
        authorPhid: 'PHID-USER-revieweraaaaaaaaaaaaa',
        dateCreated: 1_761_003_600,
      }),
      mkTransaction({
        id: 3,
        type: 'accept',
        authorPhid: 'PHID-USER-reviewerbbbbbbbbbbbbb',
        dateCreated: 1_761_010_800,
      }),
    ];
    const { samples } = extractSamplesFromTransactions(revision(), txs, loginByPhid);
    expect(samples.map((s) => s.reviewer).sort()).toEqual(['alice', 'bob']);
  });

  it('uses the earliest action after the request timestamp', () => {
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'reviewers',
        authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
        dateCreated: 1_761_000_000,
        fields: {
          operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
        },
      }),
      mkTransaction({
        id: 2,
        type: 'comment',
        authorPhid: 'PHID-USER-revieweraaaaaaaaaaaaa',
        dateCreated: 1_761_007_200,
      }),
      mkTransaction({
        id: 3,
        type: 'accept',
        authorPhid: 'PHID-USER-revieweraaaaaaaaaaaaa',
        dateCreated: 1_761_010_800,
      }),
    ];
    const { samples } = extractSamplesFromTransactions(revision(), txs, loginByPhid);
    expect(samples[0]?.firstActionAt).toBe(new Date(1_761_007_200 * 1000).toISOString());
  });

  it('ignores actions that happened before the reviewer was added', () => {
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'comment',
        authorPhid: 'PHID-USER-revieweraaaaaaaaaaaaa',
        dateCreated: 1_761_000_000,
      }),
      mkTransaction({
        id: 2,
        type: 'reviewers',
        authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
        dateCreated: 1_761_003_600,
        fields: {
          operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
        },
      }),
    ];
    // The pre-request comment doesn't count; alice is now pending because the
    // post-request request never had a follow-up action.
    const { samples, pending } = extractSamplesFromTransactions(revision(), txs, loginByPhid);
    expect(samples).toEqual([]);
    expect(pending.map((p) => p.reviewer)).toEqual(['alice']);
  });

  it('filters samples to the allowed reviewer phids when provided', () => {
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'reviewers',
        authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
        dateCreated: 1_761_000_000,
        fields: {
          operations: [
            { operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' },
            { operation: 'add', phid: 'PHID-USER-outsidereviewerccccc' },
          ],
        },
      }),
      mkTransaction({
        id: 2,
        type: 'accept',
        authorPhid: 'PHID-USER-revieweraaaaaaaaaaaaa',
        dateCreated: 1_761_003_600,
      }),
      mkTransaction({
        id: 3,
        type: 'accept',
        authorPhid: 'PHID-USER-outsidereviewerccccc',
        dateCreated: 1_761_003_600,
      }),
    ];
    const { samples } = extractSamplesFromTransactions(revision(), txs, loginByPhid, {
      allowedReviewerPhids: new Set(['PHID-USER-revieweraaaaaaaaaaaaa']),
    });
    expect(samples.map((s) => s.reviewer)).toEqual(['alice']);
  });

  it('uses the latest request after a remove/re-request cycle, not the first one', () => {
    // Reviewer added at T1, removed at T2, re-added at T3, acts at T4.
    // The sample's requestedAt should be T3 (latest active request), not T1.
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'reviewers',
        authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
        dateCreated: 1_761_000_000,
        fields: {
          operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
        },
      }),
      mkTransaction({
        id: 2,
        type: 'reviewers',
        authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
        dateCreated: 1_761_003_600,
        fields: {
          operations: [{ operation: 'remove', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
        },
      }),
      mkTransaction({
        id: 3,
        type: 'reviewers',
        authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
        dateCreated: 1_761_007_200,
        fields: {
          operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
        },
      }),
      mkTransaction({
        id: 4,
        type: 'accept',
        authorPhid: 'PHID-USER-revieweraaaaaaaaaaaaa',
        dateCreated: 1_761_010_800,
      }),
    ];
    const { samples } = extractSamplesFromTransactions(revision(), txs, loginByPhid);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.requestedAt).toBe(new Date(1_761_007_200 * 1000).toISOString());
  });

  it('pairs the reviewer action with the request that immediately preceded it when there are multiple cycles', () => {
    // Request T1 → review T2 → remove T3 → re-request T4 → (no further action).
    // Only the first completed cycle should produce a sample (T1, T2). No pending
    // re-opens once the reviewer has already acted — they're not "still waiting."
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'reviewers',
        authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
        dateCreated: 1_761_000_000,
        fields: {
          operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
        },
      }),
      mkTransaction({
        id: 2,
        type: 'accept',
        authorPhid: 'PHID-USER-revieweraaaaaaaaaaaaa',
        dateCreated: 1_761_003_600,
      }),
      mkTransaction({
        id: 3,
        type: 'reviewers',
        authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
        dateCreated: 1_761_007_200,
        fields: {
          operations: [{ operation: 'remove', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
        },
      }),
      mkTransaction({
        id: 4,
        type: 'reviewers',
        authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
        dateCreated: 1_761_010_800,
        fields: {
          operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
        },
      }),
    ];
    const { samples, pending } = extractSamplesFromTransactions(revision(), txs, loginByPhid);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.requestedAt).toBe(new Date(1_761_000_000 * 1000).toISOString());
    expect(samples[0]?.firstActionAt).toBe(new Date(1_761_003_600 * 1000).toISOString());
    expect(pending).toEqual([]);
  });

  describe('pending extraction', () => {
    it('does not emit pending when add is followed by remove', () => {
      const txs: PhabTransaction[] = [
        mkTransaction({
          id: 1,
          type: 'reviewers',
          authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
          dateCreated: 1_761_000_000,
          fields: {
            operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
          },
        }),
        mkTransaction({
          id: 2,
          type: 'reviewers',
          authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
          dateCreated: 1_761_003_600,
          fields: {
            operations: [{ operation: 'remove', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
          },
        }),
      ];
      const { samples, pending } = extractSamplesFromTransactions(revision(), txs, loginByPhid);
      expect(samples).toEqual([]);
      expect(pending).toEqual([]);
    });

    it('skips pending for reviewers outside the allowed set', () => {
      const txs: PhabTransaction[] = [
        mkTransaction({
          id: 1,
          type: 'reviewers',
          authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
          dateCreated: 1_761_000_000,
          fields: {
            operations: [
              { operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' },
              { operation: 'add', phid: 'PHID-USER-outsidereviewerccccc' },
            ],
          },
        }),
      ];
      const { pending } = extractSamplesFromTransactions(revision(), txs, loginByPhid, {
        allowedReviewerPhids: new Set(['PHID-USER-revieweraaaaaaaaaaaaa']),
      });
      expect(pending.map((p) => p.reviewer)).toEqual(['alice']);
    });

    it('uses the latest active request timestamp for a pending reviewer after a remove/re-add cycle', () => {
      const txs: PhabTransaction[] = [
        mkTransaction({
          id: 1,
          type: 'reviewers',
          authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
          dateCreated: 1_761_000_000,
          fields: {
            operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
          },
        }),
        mkTransaction({
          id: 2,
          type: 'reviewers',
          authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
          dateCreated: 1_761_003_600,
          fields: {
            operations: [{ operation: 'remove', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
          },
        }),
        mkTransaction({
          id: 3,
          type: 'reviewers',
          authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
          dateCreated: 1_761_007_200,
          fields: {
            operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
          },
        }),
      ];
      const { pending } = extractSamplesFromTransactions(revision(), txs, loginByPhid);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.requestedAt).toBe(new Date(1_761_007_200 * 1000).toISOString());
    });

    it('skips pending for the revision author (self-pending)', () => {
      const txs: PhabTransaction[] = [
        mkTransaction({
          id: 1,
          type: 'reviewers',
          authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
          dateCreated: 1_761_000_000,
          fields: {
            operations: [{ operation: 'add', phid: 'PHID-USER-authoraaaaaaaaaaaaaa' }],
          },
        }),
      ];
      const { pending } = extractSamplesFromTransactions(revision(), txs, loginByPhid);
      expect(pending).toEqual([]);
    });

    it('drops pending for reviewers whose phid has no login mapping', () => {
      const txs: PhabTransaction[] = [
        mkTransaction({
          id: 1,
          type: 'reviewers',
          authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
          dateCreated: 1_761_000_000,
          fields: {
            operations: [{ operation: 'add', phid: 'PHID-USER-unknownxxxxxxxxxxxxx' }],
          },
        }),
      ];
      const { pending } = extractSamplesFromTransactions(revision(), txs, loginByPhid);
      expect(pending).toEqual([]);
    });

    it('emits separate pending entries for multiple unacted-on reviewers', () => {
      const txs: PhabTransaction[] = [
        mkTransaction({
          id: 1,
          type: 'reviewers',
          authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
          dateCreated: 1_761_000_000,
          fields: {
            operations: [
              { operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' },
              { operation: 'add', phid: 'PHID-USER-reviewerbbbbbbbbbbbbb' },
            ],
          },
        }),
      ];
      const { pending } = extractSamplesFromTransactions(revision(), txs, loginByPhid);
      expect(pending.map((p) => p.reviewer).sort()).toEqual(['alice', 'bob']);
    });
  });

  describe('revision status gate on pending emission', () => {
    for (const terminal of ['abandoned', 'published', 'draft', 'accepted'] as const) {
      it(`emits no pending when revision.status is ${terminal}, even with an active reviewer request`, () => {
        const { samples, pending } = extractSamplesFromTransactions(
          { ...revision(), status: terminal },
          requestedButNeverActed(),
          loginByPhid,
        );
        expect(samples).toEqual([]);
        expect(pending).toEqual([]);
      });
    }

    it('still emits pending when revision.status is needs-review', () => {
      const { pending } = extractSamplesFromTransactions(
        { ...revision(), status: 'needs-review' },
        requestedButNeverActed(),
        loginByPhid,
      );
      expect(pending).toHaveLength(1);
      expect(pending[0]?.reviewer).toBe('alice');
    });

    it('treats undefined revision.status as open so legacy fixtures keep emitting pending', () => {
      // revision() does not set status; this is the back-compat path for every
      // pre-existing test in this file and for any caller that builds a
      // PhabRevision inline without going through fetchRevisions.
      const { pending } = extractSamplesFromTransactions(
        revision(),
        requestedButNeverActed(),
        loginByPhid,
      );
      expect(pending).toHaveLength(1);
    });
  });
});

describe('extractLandingFromTransactions', () => {
  const authorPhid = 'PHID-USER-authoraaaaaaaaaaaaaa';
  const reviewerA = 'PHID-USER-revieweraaaaaaaaaaaaa';
  const reviewerB = 'PHID-USER-reviewerbbbbbbbbbbbbb';

  it('returns null when the revision never reached published status', () => {
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'reviewers',
        authorPhid,
        dateCreated: 1_761_000_000,
        fields: { operations: [{ operation: 'add', phid: reviewerA }] },
      }),
      mkTransaction({
        id: 2,
        type: 'comment',
        authorPhid: reviewerA,
        dateCreated: 1_761_003_600,
      }),
    ];
    const revisionCreatedAt = 1_760_990_000;
    expect(
      extractLandingFromTransactions(revision(), txs, loginByPhid, revisionCreatedAt),
    ).toBeNull();
  });

  it('returns null when the revision was abandoned, not published', () => {
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'status',
        authorPhid,
        dateCreated: 1_761_500_000,
        fields: { old: 'needs-review', new: 'abandoned' },
      }),
    ];
    expect(extractLandingFromTransactions(revision(), txs, loginByPhid, 1_761_000_000)).toBeNull();
  });

  it('emits a landing when the status transitions to published', () => {
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'reviewers',
        authorPhid,
        dateCreated: 1_761_000_100,
        fields: { operations: [{ operation: 'add', phid: reviewerA }] },
      }),
      mkTransaction({
        id: 2,
        type: 'accept',
        authorPhid: reviewerA,
        dateCreated: 1_761_003_600,
      }),
      mkTransaction({
        id: 3,
        type: 'status',
        authorPhid,
        dateCreated: 1_761_100_000,
        fields: { old: 'accepted', new: 'published' },
      }),
    ];
    const createdAt = 1_761_000_000;
    const landing = extractLandingFromTransactions(revision(), txs, loginByPhid, createdAt);
    expect(landing).not.toBeNull();
    expect(landing).toMatchObject({
      source: 'phab',
      id: 'PHID-DREV-abcdefghijklmnopqrst',
      revisionId: 234_567,
      author: 'author-user',
      createdAt: new Date(createdAt * 1000).toISOString(),
      firstReviewAt: new Date(1_761_003_600 * 1000).toISOString(),
      landedAt: new Date(1_761_100_000 * 1000).toISOString(),
      reviewRounds: 1,
    });
  });

  it('counts reviewRounds as 1 + number of request-changes transactions', () => {
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'request-changes',
        authorPhid: reviewerA,
        dateCreated: 1_761_010_000,
      }),
      mkTransaction({
        id: 2,
        type: 'request-changes',
        authorPhid: reviewerB,
        dateCreated: 1_761_020_000,
      }),
      mkTransaction({
        id: 3,
        type: 'accept',
        authorPhid: reviewerA,
        dateCreated: 1_761_030_000,
      }),
      mkTransaction({
        id: 4,
        type: 'status',
        authorPhid,
        dateCreated: 1_761_040_000,
        fields: { old: 'accepted', new: 'published' },
      }),
    ];
    const landing = extractLandingFromTransactions(revision(), txs, loginByPhid, 1_761_000_000);
    expect(landing?.reviewRounds).toBe(3);
    expect(landing?.firstReviewAt).toBe(new Date(1_761_010_000 * 1000).toISOString());
  });

  it('returns firstReviewAt=null when no non-author reviewer action exists before land', () => {
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'status',
        authorPhid,
        dateCreated: 1_761_100_000,
        fields: { old: 'needs-review', new: 'published' },
      }),
    ];
    const landing = extractLandingFromTransactions(revision(), txs, loginByPhid, 1_761_000_000);
    expect(landing).not.toBeNull();
    expect(landing?.firstReviewAt).toBeNull();
    expect(landing?.reviewRounds).toBe(1);
  });

  it("ignores the author's own reviewer-type transactions when deciding firstReviewAt", () => {
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'comment',
        authorPhid,
        dateCreated: 1_761_001_000,
      }),
      mkTransaction({
        id: 2,
        type: 'accept',
        authorPhid: reviewerA,
        dateCreated: 1_761_050_000,
      }),
      mkTransaction({
        id: 3,
        type: 'status',
        authorPhid,
        dateCreated: 1_761_060_000,
        fields: { old: 'accepted', new: 'published' },
      }),
    ];
    const landing = extractLandingFromTransactions(revision(), txs, loginByPhid, 1_761_000_000);
    expect(landing?.firstReviewAt).toBe(new Date(1_761_050_000 * 1000).toISOString());
  });

  it('uses the earliest status→published transaction when a revision reopens and re-lands', () => {
    const txs: PhabTransaction[] = [
      mkTransaction({
        id: 1,
        type: 'status',
        authorPhid,
        dateCreated: 1_761_100_000,
        fields: { old: 'accepted', new: 'published' },
      }),
      mkTransaction({
        id: 2,
        type: 'status',
        authorPhid,
        dateCreated: 1_761_200_000,
        fields: { old: 'published', new: 'needs-review' },
      }),
      mkTransaction({
        id: 3,
        type: 'status',
        authorPhid,
        dateCreated: 1_761_300_000,
        fields: { old: 'accepted', new: 'published' },
      }),
    ];
    const landing = extractLandingFromTransactions(revision(), txs, loginByPhid, 1_761_000_000);
    expect(landing?.landedAt).toBe(new Date(1_761_100_000 * 1000).toISOString());
  });
});

describe('fetchPhabSamples', () => {
  it('orchestrates project lookup, revision search, and transaction extraction', async () => {
    const call = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            {
              phid: 'PHID-PROJ-newtabaaaaaaaaaaaaaa',
              attachments: {
                members: {
                  members: [{ phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
                },
              },
            },
          ],
        };
      }
      if (method === 'differential.revision.search') {
        const constraints = (params as { constraints: Record<string, unknown> }).constraints;
        // Recent-updates query uses modifiedStart; open-state query uses statuses.
        // Return the revision only for the recent query so we don't double-extract.
        if ('modifiedStart' in constraints) {
          return {
            data: [
              {
                id: 1,
                phid: 'PHID-DREV-abcdefghijklmnopqrst',
                fields: {
                  authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa',
                  dateModified: 1_761_000_000,
                },
              },
            ],
            cursor: { after: null },
          };
        }
        return { data: [], cursor: { after: null } };
      }
      if (method === 'transaction.search') {
        return {
          data: [
            {
              id: 1,
              phid: 'PHID-XACT-aaaaaaaaaaaaaaaaaaaa',
              type: 'reviewers',
              authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa',
              dateCreated: 1_761_000_000,
              fields: {
                operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
              },
            },
            {
              id: 2,
              phid: 'PHID-XACT-bbbbbbbbbbbbbbbbbbbb',
              type: 'accept',
              authorPHID: 'PHID-USER-revieweraaaaaaaaaaaaa',
              dateCreated: 1_761_007_200,
              fields: {},
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'user.search') {
        return {
          data: [
            { phid: 'PHID-USER-authoraaaaaaaaaaaaaa', fields: { username: 'author-user' } },
            { phid: 'PHID-USER-revieweraaaaaaaaaaaaa', fields: { username: 'alice' } },
          ],
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const client: ConduitClient = { call };

    const { samples, revisionPhidsSeen } = await fetchPhabSamples({
      client,
      projectSlugs: ['home-newtab-reviewers'],
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
    });

    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ source: 'phab', reviewer: 'alice' });
    expect(revisionPhidsSeen).toEqual(['PHID-DREV-abcdefghijklmnopqrst']);
    expect(call).toHaveBeenCalledWith(
      'project.search',
      expect.objectContaining({
        constraints: { slugs: ['home-newtab-reviewers'] },
        attachments: { members: true },
      }),
    );
    expect(call).toHaveBeenCalledWith(
      'differential.revision.search',
      expect.objectContaining({
        constraints: expect.objectContaining({
          reviewerPHIDs: ['PHID-USER-revieweraaaaaaaaaaaaa'],
          modifiedStart: expect.any(Number) as number,
        }) as unknown,
      }),
    );
    // Open-state query runs too, constrained by status instead of modifiedStart.
    expect(call).toHaveBeenCalledWith(
      'differential.revision.search',
      expect.objectContaining({
        constraints: expect.objectContaining({
          reviewerPHIDs: ['PHID-USER-revieweraaaaaaaaaaaaa'],
          statuses: expect.any(Array) as unknown,
        }) as unknown,
      }),
    );
  });

  it('discovers pending requests on stale-but-open revisions via the open-state query', async () => {
    // Revision was modified months ago (outside modifiedStart) but is still
    // needs-review. Only the open-state query should surface it. Alice is
    // pending because she was added as a reviewer and never acted.
    const call = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            {
              phid: 'PHID-PROJ-newtabaaaaaaaaaaaaaa',
              attachments: {
                members: { members: [{ phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }] },
              },
            },
          ],
        };
      }
      if (method === 'differential.revision.search') {
        const constraints = (params as { constraints: Record<string, unknown> }).constraints;
        // Recent query returns nothing; open-state query returns the stale revision.
        if ('statuses' in constraints) {
          return {
            data: [
              {
                id: 99,
                phid: 'PHID-DREV-stalebutopenxxxxxxxx',
                fields: {
                  authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa',
                  dateModified: 1_761_000_000,
                },
              },
            ],
            cursor: { after: null },
          };
        }
        return { data: [], cursor: { after: null } };
      }
      if (method === 'transaction.search') {
        return {
          data: [
            {
              id: 1,
              phid: 'PHID-XACT-pendingxxxxxxxxxxxxx',
              type: 'reviewers',
              authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa',
              dateCreated: 1_750_000_000,
              fields: {
                operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
              },
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'user.search') {
        return {
          data: [{ phid: 'PHID-USER-revieweraaaaaaaaaaaaa', fields: { username: 'alice' } }],
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const client: ConduitClient = { call };

    const { samples, pending } = await fetchPhabSamples({
      client,
      projectSlugs: ['home-newtab-reviewers'],
      lookbackDays: 3,
      now: new Date('2026-04-20T12:00:00Z'),
    });

    expect(samples).toEqual([]);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      source: 'phab',
      id: 'PHID-DREV-stalebutopenxxxxxxxx',
      revisionId: 99,
      reviewer: 'alice',
    });
  });

  it('dedupes revisions that appear in both the recent-updates and open-state queries', async () => {
    // The same revision shows up in both queries → transactions fetched once,
    // sample emitted once.
    let transactionCallCount = 0;
    const call = vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            {
              phid: 'PHID-PROJ-newtabaaaaaaaaaaaaaa',
              attachments: {
                members: { members: [{ phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }] },
              },
            },
          ],
        };
      }
      if (method === 'differential.revision.search') {
        return {
          data: [
            {
              id: 7,
              phid: 'PHID-DREV-dupeaaaaaaaaaaaaaaaa',
              fields: { authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa', dateModified: 1_761_000_000 },
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'transaction.search') {
        transactionCallCount += 1;
        return {
          data: [
            {
              id: 1,
              phid: 'PHID-XACT-aaaaaaaaaaaaaaaaaaaa',
              type: 'reviewers',
              authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa',
              dateCreated: 1_761_000_000,
              fields: {
                operations: [{ operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
              },
            },
            {
              id: 2,
              phid: 'PHID-XACT-bbbbbbbbbbbbbbbbbbbb',
              type: 'accept',
              authorPHID: 'PHID-USER-revieweraaaaaaaaaaaaa',
              dateCreated: 1_761_007_200,
              fields: {},
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'user.search') {
        return {
          data: [{ phid: 'PHID-USER-revieweraaaaaaaaaaaaa', fields: { username: 'alice' } }],
        };
      }
      throw new Error(`unexpected method ${method}`);
    });

    const { samples } = await fetchPhabSamples({
      client: { call },
      projectSlugs: ['home-newtab-reviewers'],
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
    });

    expect(samples).toHaveLength(1);
    expect(transactionCallCount).toBe(1);
  });

  it('throws when no project slug resolves', async () => {
    const call = vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'project.search') return { data: [] };
      throw new Error(`unexpected method ${method}`);
    });
    await expect(
      fetchPhabSamples({
        client: { call },
        projectSlugs: ['nonexistent'],
        lookbackDays: 21,
        now: new Date('2026-04-20T12:00:00Z'),
      }),
    ).rejects.toThrow(/nonexistent/);
  });

  it('throws when the resolved projects have no members', async () => {
    const call = vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            {
              phid: 'PHID-PROJ-emptyaaaaaaaaaaaaaaa',
              attachments: { members: { members: [] } },
            },
          ],
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    await expect(
      fetchPhabSamples({
        client: { call },
        projectSlugs: ['empty-group'],
        lookbackDays: 21,
        now: new Date('2026-04-20T12:00:00Z'),
      }),
    ).rejects.toThrow(/members/);
  });

  it('unions reviewer phids across multiple project slugs and dedupes', async () => {
    const call = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            {
              phid: 'PHID-PROJ-aaaaaaaaaaaaaaaaaaaa',
              attachments: {
                members: {
                  members: [
                    { phid: 'PHID-USER-revieweraaaaaaaaaaaaa' },
                    { phid: 'PHID-USER-reviewerbbbbbbbbbbbbb' },
                  ],
                },
              },
            },
            {
              phid: 'PHID-PROJ-bbbbbbbbbbbbbbbbbbbb',
              attachments: {
                members: {
                  members: [
                    { phid: 'PHID-USER-reviewerbbbbbbbbbbbbb' },
                    { phid: 'PHID-USER-outsidereviewerccccc' },
                  ],
                },
              },
            },
          ],
        };
      }
      if (method === 'differential.revision.search') {
        const p = params as { constraints: { reviewerPHIDs: string[] } };
        expect([...p.constraints.reviewerPHIDs].sort()).toEqual([
          'PHID-USER-outsidereviewerccccc',
          'PHID-USER-revieweraaaaaaaaaaaaa',
          'PHID-USER-reviewerbbbbbbbbbbbbb',
        ]);
        return { data: [], cursor: { after: null } };
      }
      if (method === 'user.search') return { data: [] };
      throw new Error(`unexpected method ${method}`);
    });
    await fetchPhabSamples({
      client: { call },
      projectSlugs: ['slug-a', 'slug-b'],
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
    });
    expect(call).toHaveBeenCalledWith(
      'project.search',
      expect.objectContaining({
        constraints: { slugs: ['slug-a', 'slug-b'] },
        attachments: { members: true },
      }),
    );
  });

  it('passes limit=100 on transaction.search to max out pagination per call', async () => {
    const call = vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            {
              phid: 'PHID-PROJ-newtabaaaaaaaaaaaaaa',
              attachments: {
                members: { members: [{ phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }] },
              },
            },
          ],
        };
      }
      if (method === 'differential.revision.search') {
        return {
          data: [
            {
              id: 1,
              phid: 'PHID-DREV-aaaaaaaaaaaaaaaaaaaa',
              fields: { authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa', dateModified: 1_761_000_000 },
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'transaction.search') return { data: [], cursor: { after: null } };
      if (method === 'user.search') return { data: [] };
      throw new Error(`unexpected method ${method}`);
    });
    await fetchPhabSamples({
      client: { call },
      projectSlugs: ['home-newtab-reviewers'],
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
    });
    expect(call).toHaveBeenCalledWith(
      'transaction.search',
      expect.objectContaining({ limit: 100 }),
    );
  });

  it('scopes the open-state revision query with a modifiedStart bound', async () => {
    const openQueryConstraints: Record<string, unknown>[] = [];
    const call = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            {
              phid: 'PHID-PROJ-newtabaaaaaaaaaaaaaa',
              attachments: {
                members: { members: [{ phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }] },
              },
            },
          ],
        };
      }
      if (method === 'differential.revision.search') {
        const constraints = (params as { constraints: Record<string, unknown> }).constraints;
        if ('statuses' in constraints) openQueryConstraints.push(constraints);
        return { data: [], cursor: { after: null } };
      }
      if (method === 'user.search') return { data: [] };
      throw new Error(`unexpected method ${method}`);
    });
    await fetchPhabSamples({
      client: { call },
      projectSlugs: ['home-newtab-reviewers'],
      lookbackDays: 3,
      now: new Date('2026-04-20T12:00:00Z'),
    });
    expect(openQueryConstraints).toHaveLength(1);
    // The open-state query must now also carry modifiedStart — broader than
    // the recent-updates query's 3-day bound, but not unbounded.
    const openConstraints = openQueryConstraints[0]!;
    expect(openConstraints).toHaveProperty('modifiedStart');
    expect(typeof openConstraints.modifiedStart).toBe('number');
    // 90-day scope: ~7.776 million seconds. Assert it's within the 90-day
    // ballpark so we notice if the bound is silently widened or removed.
    const recentBound = Math.floor(new Date('2026-04-20T12:00:00Z').getTime() / 1000 - 3 * 86_400);
    expect(openConstraints.modifiedStart).toBeLessThan(recentBound);
    const ninetyDayBound = Math.floor(
      new Date('2026-04-20T12:00:00Z').getTime() / 1000 - 180 * 86_400,
    );
    expect(openConstraints.modifiedStart).toBeGreaterThan(ninetyDayBound);
  });

  it('skips transaction.search for cached revisions unchanged since cache creation', async () => {
    const transactionSearchCalls: string[] = [];
    const call = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            {
              phid: 'PHID-PROJ-newtabaaaaaaaaaaaaaa',
              attachments: {
                members: { members: [{ phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }] },
              },
            },
          ],
        };
      }
      if (method === 'differential.revision.search') {
        return {
          data: [
            {
              id: 1,
              phid: 'PHID-DREV-cachedaaaaaaaaaaaaaaa',
              fields: {
                authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa',
                // Unchanged since cache creation (cacheCreatedAt below) → reuse.
                dateModified: 1_760_000_000,
              },
            },
            {
              id: 2,
              phid: 'PHID-DREV-freshaaaaaaaaaaaaaaaa',
              fields: {
                authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa',
                dateModified: 1_760_000_000,
              },
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'transaction.search') {
        const p = params as { objectIdentifier: string };
        transactionSearchCalls.push(p.objectIdentifier);
        return { data: [], cursor: { after: null } };
      }
      if (method === 'user.search') return { data: [] };
      throw new Error(`unexpected method ${method}`);
    });

    const cached: PhabTransaction = {
      id: 99,
      phid: 'PHID-XACT-cacheaaaaaaaaaaaaaa',
      type: 'comment',
      authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
      dateCreated: 1_760_000_000,
      fields: {},
    };
    await fetchPhabSamples({
      client: { call },
      projectSlugs: ['home-newtab-reviewers'],
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
      resumeCache: {
        createdAt: 1_761_000_000, // strictly after the revisions' dateModified
        transactionsByRevisionPhid: new Map([['PHID-DREV-cachedaaaaaaaaaaaaaaa', [cached]]]),
      },
    });

    // Only the uncached revision should have hit transaction.search.
    expect(transactionSearchCalls).toEqual(['PHID-DREV-freshaaaaaaaaaaaaaaaa']);
  });

  it('fires onRevisionProcessed for every revision, distinguishing cache hits from fresh fetches', async () => {
    const call = vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            {
              phid: 'PHID-PROJ-newtabaaaaaaaaaaaaaa',
              attachments: {
                members: { members: [{ phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }] },
              },
            },
          ],
        };
      }
      if (method === 'differential.revision.search') {
        return {
          data: [
            {
              id: 1,
              phid: 'PHID-DREV-cachedaaaaaaaaaaaaaaa',
              fields: {
                authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa',
                dateModified: 1_760_000_000,
              },
            },
            {
              id: 2,
              phid: 'PHID-DREV-freshaaaaaaaaaaaaaaaa',
              fields: {
                authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa',
                dateModified: 1_760_000_000,
              },
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'transaction.search') return { data: [], cursor: { after: null } };
      if (method === 'user.search') return { data: [] };
      throw new Error(`unexpected method ${method}`);
    });

    const cached: PhabTransaction = {
      id: 99,
      phid: 'PHID-XACT-cacheaaaaaaaaaaaaaa',
      type: 'comment',
      authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
      dateCreated: 1_760_000_000,
      fields: {},
    };

    const events: { phid: string; cached: boolean; index: number; total: number }[] = [];
    await fetchPhabSamples({
      client: { call },
      projectSlugs: ['home-newtab-reviewers'],
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
      resumeCache: {
        createdAt: 1_761_000_000,
        transactionsByRevisionPhid: new Map([['PHID-DREV-cachedaaaaaaaaaaaaaaa', [cached]]]),
      },
      onRevisionProcessed: (event) => {
        events.push(event);
      },
    });

    expect(events).toHaveLength(2);
    expect(events).toEqual([
      { phid: 'PHID-DREV-cachedaaaaaaaaaaaaaaa', cached: true, index: 0, total: 2 },
      { phid: 'PHID-DREV-freshaaaaaaaaaaaaaaaa', cached: false, index: 1, total: 2 },
    ]);
  });

  it('re-fetches a cached revision that has been modified since cache creation', async () => {
    const transactionSearchCalls: string[] = [];
    const call = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            {
              phid: 'PHID-PROJ-newtabaaaaaaaaaaaaaa',
              attachments: {
                members: { members: [{ phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }] },
              },
            },
          ],
        };
      }
      if (method === 'differential.revision.search') {
        return {
          data: [
            {
              id: 1,
              phid: 'PHID-DREV-changedaaaaaaaaaaaaa',
              fields: {
                authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa',
                // Modified AFTER cache creation → must re-fetch, not reuse.
                dateModified: 1_762_000_000,
              },
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'transaction.search') {
        const p = params as { objectIdentifier: string };
        transactionSearchCalls.push(p.objectIdentifier);
        return { data: [], cursor: { after: null } };
      }
      if (method === 'user.search') return { data: [] };
      throw new Error(`unexpected method ${method}`);
    });

    const staleCache: PhabTransaction = {
      id: 1,
      phid: 'PHID-XACT-staleaaaaaaaaaaaaaa',
      type: 'comment',
      authorPhid: 'PHID-USER-authoraaaaaaaaaaaaaa',
      dateCreated: 1_760_000_000,
      fields: {},
    };
    await fetchPhabSamples({
      client: { call },
      projectSlugs: ['home-newtab-reviewers'],
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
      resumeCache: {
        createdAt: 1_761_000_000, // BEFORE the revision's dateModified
        transactionsByRevisionPhid: new Map([['PHID-DREV-changedaaaaaaaaaaaaa', [staleCache]]]),
      },
    });

    expect(transactionSearchCalls).toEqual(['PHID-DREV-changedaaaaaaaaaaaaa']);
  });

  it('invokes onRevisionTransactions after each revision fetched from the wire', async () => {
    const call = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            {
              phid: 'PHID-PROJ-newtabaaaaaaaaaaaaaa',
              attachments: {
                members: { members: [{ phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }] },
              },
            },
          ],
        };
      }
      if (method === 'differential.revision.search') {
        return {
          data: [
            {
              id: 1,
              phid: 'PHID-DREV-oneaaaaaaaaaaaaaaaaa',
              fields: { authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa', dateModified: 1_761_000_000 },
            },
            {
              id: 2,
              phid: 'PHID-DREV-twoaaaaaaaaaaaaaaaaa',
              fields: { authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa', dateModified: 1_761_000_000 },
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'transaction.search') {
        const p = params as { objectIdentifier: string };
        return {
          data: [
            {
              id: 1,
              phid: `PHID-XACT-${p.objectIdentifier.slice(-4)}`,
              type: 'comment',
              authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa',
              dateCreated: 1_761_000_000,
              fields: {},
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'user.search') return { data: [] };
      throw new Error(`unexpected method ${method}`);
    });
    const progressSink: { phid: string; count: number }[] = [];
    const onProgress = async (phid: string, txs: readonly PhabTransaction[]): Promise<void> => {
      progressSink.push({ phid, count: txs.length });
      return;
    };

    await fetchPhabSamples({
      client: { call },
      projectSlugs: ['home-newtab-reviewers'],
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
      onRevisionTransactions: onProgress,
    });

    expect(progressSink).toEqual([
      { phid: 'PHID-DREV-oneaaaaaaaaaaaaaaaaa', count: 1 },
      { phid: 'PHID-DREV-twoaaaaaaaaaaaaaaaaa', count: 1 },
    ]);
  });

  it('drops reviewers who are not group members', async () => {
    const call = vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            {
              phid: 'PHID-PROJ-newtabaaaaaaaaaaaaaa',
              attachments: {
                members: {
                  members: [{ phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }],
                },
              },
            },
          ],
        };
      }
      if (method === 'differential.revision.search') {
        return {
          data: [
            {
              id: 2,
              phid: 'PHID-DREV-bbbbbbbbbbbbbbbbbbbb',
              fields: { authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa', dateModified: 1_761_000_000 },
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'transaction.search') {
        return {
          data: [
            {
              id: 1,
              phid: 'PHID-XACT-aaaaaaaaaaaaaaaaaaaa',
              type: 'reviewers',
              authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa',
              dateCreated: 1_761_000_000,
              fields: {
                operations: [
                  { operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' },
                  { operation: 'add', phid: 'PHID-USER-outsidereviewerccccc' },
                ],
              },
            },
            {
              id: 2,
              phid: 'PHID-XACT-bbbbbbbbbbbbbbbbbbbb',
              type: 'accept',
              authorPHID: 'PHID-USER-revieweraaaaaaaaaaaaa',
              dateCreated: 1_761_003_600,
              fields: {},
            },
            {
              id: 3,
              phid: 'PHID-XACT-ccccccccccccccccccccc',
              type: 'accept',
              authorPHID: 'PHID-USER-outsidereviewerccccc',
              dateCreated: 1_761_003_600,
              fields: {},
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'user.search') {
        return {
          data: [
            { phid: 'PHID-USER-revieweraaaaaaaaaaaaa', fields: { username: 'alice' } },
            { phid: 'PHID-USER-outsidereviewerccccc', fields: { username: 'charlie' } },
          ],
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const { samples } = await fetchPhabSamples({
      client: { call },
      projectSlugs: ['home-newtab-reviewers'],
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
    });
    expect(samples.map((s) => s.reviewer)).toEqual(['alice']);
  });

  it('paginates user.search to pick up users past the first page', async () => {
    const userSearchCalls: { phids: string[]; after: string | undefined }[] = [];
    const call = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            {
              phid: 'PHID-PROJ-newtabaaaaaaaaaaaaaa',
              attachments: {
                members: {
                  members: [
                    { phid: 'PHID-USER-revieweraaaaaaaaaaaaa' },
                    { phid: 'PHID-USER-reviewerbbbbbbbbbbbbb' },
                  ],
                },
              },
            },
          ],
        };
      }
      if (method === 'differential.revision.search') {
        return {
          data: [
            {
              id: 1,
              phid: 'PHID-DREV-aaaaaaaaaaaaaaaaaaaa',
              fields: { authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa', dateModified: 1_761_000_000 },
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'transaction.search') {
        return {
          data: [
            {
              id: 1,
              phid: 'PHID-XACT-aaaaaaaaaaaaaaaaaaaa',
              type: 'reviewers',
              authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa',
              dateCreated: 1_761_000_000,
              fields: {
                operations: [
                  { operation: 'add', phid: 'PHID-USER-revieweraaaaaaaaaaaaa' },
                  { operation: 'add', phid: 'PHID-USER-reviewerbbbbbbbbbbbbb' },
                ],
              },
            },
            {
              id: 2,
              phid: 'PHID-XACT-bbbbbbbbbbbbbbbbbbbb',
              type: 'accept',
              authorPHID: 'PHID-USER-revieweraaaaaaaaaaaaa',
              dateCreated: 1_761_003_600,
              fields: {},
            },
            {
              id: 3,
              phid: 'PHID-XACT-ccccccccccccccccccccc',
              type: 'accept',
              authorPHID: 'PHID-USER-reviewerbbbbbbbbbbbbb',
              dateCreated: 1_761_003_600,
              fields: {},
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'user.search') {
        const p = params as { constraints: { phids: string[] }; after?: string };
        userSearchCalls.push({ phids: p.constraints.phids, after: p.after });
        // Phab splits users across pages. First page reveals alice only; the
        // rest (bob + revision author) land on page 2 behind a cursor.
        if (p.after === undefined) {
          return {
            data: [{ phid: 'PHID-USER-revieweraaaaaaaaaaaaa', fields: { username: 'alice' } }],
            cursor: { after: 'CURSOR-PAGE-2' },
          };
        }
        return {
          data: [
            { phid: 'PHID-USER-reviewerbbbbbbbbbbbbb', fields: { username: 'bob' } },
            { phid: 'PHID-USER-authoraaaaaaaaaaaaaa', fields: { username: 'author-user' } },
          ],
          cursor: { after: null },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const { samples } = await fetchPhabSamples({
      client: { call },
      projectSlugs: ['home-newtab-reviewers'],
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
    });
    expect(userSearchCalls.length).toBeGreaterThanOrEqual(2);
    expect(userSearchCalls[1]?.after).toBe('CURSOR-PAGE-2');
    expect(samples.map((s) => s.reviewer).sort()).toEqual(['alice', 'bob']);
  });

  it('chunks user.search input into batches of at most 100 phids', async () => {
    const memberPhids = Array.from(
      { length: 120 },
      (_, index) => `PHID-USER-reviewer${String(index).padStart(11, '0')}`,
    );
    const userSearchBatches: string[][] = [];
    const call = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            {
              phid: 'PHID-PROJ-newtabaaaaaaaaaaaaaa',
              attachments: { members: { members: memberPhids.map((phid) => ({ phid })) } },
            },
          ],
        };
      }
      if (method === 'differential.revision.search') {
        // Emit one revision per member so each authorPhid must be resolved —
        // forces the user.search input list past 100 unique PHIDs.
        return {
          data: memberPhids.map((phid, index) => ({
            id: index + 1,
            phid: `PHID-DREV-${String(index).padStart(20, '0')}`,
            fields: { authorPHID: phid, dateModified: 1_761_000_000 },
          })),
          cursor: { after: null },
        };
      }
      if (method === 'transaction.search') {
        return { data: [], cursor: { after: null } };
      }
      if (method === 'user.search') {
        const p = params as { constraints: { phids: string[] } };
        userSearchBatches.push(p.constraints.phids);
        return {
          data: p.constraints.phids.map((phid) => ({
            phid,
            fields: { username: `user-${phid.slice(-6)}` },
          })),
          cursor: { after: null },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    await fetchPhabSamples({
      client: { call },
      projectSlugs: ['home-newtab-reviewers'],
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
    });
    expect(userSearchBatches.length).toBeGreaterThanOrEqual(2);
    for (const batch of userSearchBatches) {
      expect(batch.length).toBeLessThanOrEqual(100);
    }
    const totalResolved = new Set(userSearchBatches.flat());
    expect(totalResolved.size).toBe(memberPhids.length);
  });

  it('emits a landing when conduit returns a status→published transaction with fields.new', async () => {
    const call = vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            {
              phid: 'PHID-PROJ-aaaaaaaaaaaaaaaaaaaa',
              attachments: { members: { members: [{ phid: 'PHID-USER-revieweraaaaaaaaaaaaa' }] } },
            },
          ],
        };
      }
      if (method === 'differential.revision.search') {
        return {
          data: [
            {
              id: 1,
              phid: 'PHID-DREV-abcdefghijklmnopqrst',
              fields: {
                authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa',
                dateCreated: 1_760_900_000,
                dateModified: 1_761_100_000,
              },
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'transaction.search') {
        return {
          data: [
            // Reviewer accepts first to produce a firstReviewAt.
            {
              id: 1,
              phid: 'PHID-XACT-DREV-aaaaaaaaaaaaaaaaaaaa',
              type: 'accept',
              authorPHID: 'PHID-USER-revieweraaaaaaaaaaaaa',
              dateCreated: 1_761_003_600,
              fields: {},
            },
            // Author closes by landing — status transitions to 'published'.
            {
              id: 2,
              phid: 'PHID-XACT-DREV-bbbbbbbbbbbbbbbbbbbb',
              type: 'status',
              authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa',
              dateCreated: 1_761_100_000,
              fields: { old: 'accepted', new: 'published' },
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'user.search') {
        return {
          data: [
            { phid: 'PHID-USER-authoraaaaaaaaaaaaaa', fields: { username: 'author-user' } },
            { phid: 'PHID-USER-revieweraaaaaaaaaaaaa', fields: { username: 'alice' } },
          ],
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const client: ConduitClient = { call };

    const { landings } = await fetchPhabSamples({
      client,
      projectSlugs: ['home-newtab-reviewers'],
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
    });

    expect(landings).toHaveLength(1);
    expect(landings[0]).toMatchObject({
      source: 'phab',
      id: 'PHID-DREV-abcdefghijklmnopqrst',
      revisionId: 1,
      author: 'author-user',
      landedAt: new Date(1_761_100_000 * 1000).toISOString(),
      firstReviewAt: new Date(1_761_003_600 * 1000).toISOString(),
      reviewRounds: 1,
    });
  });
});

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('createConduitClient', () => {
  it('serializes nested params in PHP-bracket form alongside api.token', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ result: { data: [] } }));
    const client = createConduitClient({
      endpoint: 'https://phab.example/api',
      apiToken: 'cli-abc123',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await client.call('project.search', { constraints: { slugs: ['home-newtab-reviewers'] } });

    expect(fetchFn).toHaveBeenCalledWith(
      'https://phab.example/api/project.search',
      expect.objectContaining({ method: 'POST' }),
    );
    const firstCall = fetchFn.mock.calls[0] as unknown as [string, { body: URLSearchParams }];
    const init = firstCall[1];
    expect(init.body.get('api.token')).toBe('cli-abc123');
    expect(init.body.get('constraints[slugs][0]')).toBe('home-newtab-reviewers');
    expect(init.body.get('params')).toBeNull();
  });

  it('serializes numeric params and arrays of PHIDs', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ result: { data: [], cursor: { after: null } } }),
    );
    const client = createConduitClient({
      endpoint: 'https://phab.example/api',
      apiToken: 'cli-abc123',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await client.call('differential.revision.search', {
      constraints: { projects: ['PHID-PROJ-aaa'], modifiedStart: 1_761_000_000 },
      order: 'newest',
    });

    const firstCall = fetchFn.mock.calls[0] as unknown as [string, { body: URLSearchParams }];
    const init = firstCall[1];
    expect(init.body.get('constraints[projects][0]')).toBe('PHID-PROJ-aaa');
    expect(init.body.get('constraints[modifiedStart]')).toBe('1761000000');
    expect(init.body.get('order')).toBe('newest');
  });

  it('surfaces Conduit error_info as a thrown error', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ result: null, error_info: 'Session key is not present.' }),
    );
    const client = createConduitClient({
      endpoint: 'https://phab.example/api',
      apiToken: 'cli-bad',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await expect(client.call('project.search', {})).rejects.toThrow(/Session key is not present/);
  });

  it('retries on HTTP 429 with Retry-After before giving up', async () => {
    const sleeps: number[] = [];
    const sleepFn = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });
    let attempt = 0;
    const fetchFn = vi.fn(async () => {
      attempt += 1;
      if (attempt < 3) {
        return new Response('Too Many Requests', {
          status: 429,
          headers: { 'Retry-After': '1' },
        });
      }
      return jsonResponse({ result: { data: [] } });
    });
    const client = createConduitClient({
      endpoint: 'https://phab.example/api',
      apiToken: 'cli-abc123',
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn,
    });

    await client.call('project.search', {});
    expect(attempt).toBe(3);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('throttles successive calls to stay under the min interval', async () => {
    const sleeps: number[] = [];
    const sleepFn = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });
    let nowMs = 0;
    const nowFn = vi.fn(() => nowMs);
    const fetchFn = vi.fn(async () => jsonResponse({ result: { data: [] } }));
    const client = createConduitClient({
      endpoint: 'https://phab.example/api',
      apiToken: 'cli-abc123',
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn,
      nowFn,
      minIntervalMs: 500,
    });

    await client.call('project.search', {});
    nowMs = 100;
    await client.call('project.search', {});
    expect(sleeps).toEqual([400]);
  });

  it('does not throttle when the min interval has already elapsed', async () => {
    const sleeps: number[] = [];
    const sleepFn = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });
    let nowMs = 0;
    const nowFn = vi.fn(() => nowMs);
    const fetchFn = vi.fn(async () => jsonResponse({ result: { data: [] } }));
    const client = createConduitClient({
      endpoint: 'https://phab.example/api',
      apiToken: 'cli-abc123',
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn,
      nowFn,
      minIntervalMs: 500,
    });

    await client.call('project.search', {});
    nowMs = 2000;
    await client.call('project.search', {});
    expect(sleeps).toEqual([]);
  });

  it('gives up after the configured max number of 429 retries', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('Too Many Requests', {
          status: 429,
          headers: { 'Retry-After': '0' },
        }),
    );
    const client = createConduitClient({
      endpoint: 'https://phab.example/api',
      apiToken: 'cli-abc123',
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: async () => {
        return;
      },
      maxRetries: 2,
    });

    await expect(client.call('project.search', {})).rejects.toThrow(/429/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('sleeps cooldownMs before the call that follows every Nth call to a configured method', async () => {
    const sleeps: number[] = [];
    const fetchFn = vi.fn(async () => jsonResponse({ result: { data: [] } }));
    const client = createConduitClient({
      endpoint: 'https://phab.example/api',
      apiToken: 'cli-abc123',
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: async (ms: number) => {
        sleeps.push(ms);
      },
      minIntervalMs: 0,
      methodCooldowns: [{ method: 'transaction.search', every: 3, cooldownMs: 1_800_000 }],
    });
    for (let index = 0; index < 4; index += 1) {
      await client.call('transaction.search', {});
    }
    // Calls 1-3 make it through without a cooldown. Right before call #4,
    // because prev count hit the threshold of 3, the 30-minute cooldown fires.
    expect(sleeps).toContain(1_800_000);
    // Only one cooldown by call #4 — not two.
    expect(sleeps.filter((ms) => ms === 1_800_000)).toHaveLength(1);
  });

  it('applies method cooldowns independently per method', async () => {
    const sleeps: number[] = [];
    const fetchFn = vi.fn(async () => jsonResponse({ result: { data: [] } }));
    const client = createConduitClient({
      endpoint: 'https://phab.example/api',
      apiToken: 'cli-abc123',
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: async (ms: number) => {
        sleeps.push(ms);
      },
      minIntervalMs: 0,
      methodCooldowns: [{ method: 'transaction.search', every: 3, cooldownMs: 1_800_000 }],
    });
    for (let index = 0; index < 5; index += 1) {
      await client.call('project.search', {});
    }
    // project.search isn't configured for a cooldown; no 30-minute sleep.
    expect(sleeps.filter((ms) => ms === 1_800_000)).toHaveLength(0);
  });

  it('includes the Retry-After header and response body when giving up on 429', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('{"error_info":"rate limited by phab"}', {
          status: 429,
          headers: { 'Retry-After': '17' },
        }),
    );
    const client = createConduitClient({
      endpoint: 'https://phab.example/api',
      apiToken: 'cli-abc123',
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: async () => {
        return;
      },
      maxRetries: 0,
    });
    const error = await client
      .call('project.search', {})
      .then((): Error => {
        throw new Error('expected rejection');
      })
      .catch((error_: unknown): Error => error_ as Error);
    expect(error.message).toMatch(/Retry-After=17/);
    expect(error.message).toMatch(/rate limited by phab/);
  });
});
