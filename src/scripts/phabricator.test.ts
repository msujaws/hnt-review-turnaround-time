import { describe, expect, it, vi } from 'vitest';

import {
  createConduitClient,
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
]);

describe('extractSamplesFromTransactions', () => {
  it('returns no samples when there are no transactions', () => {
    expect(extractSamplesFromTransactions(revision(), [], loginByPhid)).toEqual([]);
  });

  it('returns no sample when a reviewer is added but never acts', () => {
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
    expect(extractSamplesFromTransactions(revision(), txs, loginByPhid)).toEqual([]);
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
    const samples = extractSamplesFromTransactions(revision(), txs, loginByPhid);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      source: 'phab',
      id: 'PHID-DREV-abcdefghijklmnopqrst',
      reviewer: 'alice',
    });
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
    expect(extractSamplesFromTransactions(revision(), txs, loginByPhid)).toHaveLength(1);
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
    expect(extractSamplesFromTransactions(revision(), txs, loginByPhid)).toEqual([]);
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
    const samples = extractSamplesFromTransactions(revision(), txs, loginByPhid);
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
    const samples = extractSamplesFromTransactions(revision(), txs, loginByPhid);
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
    expect(extractSamplesFromTransactions(revision(), txs, loginByPhid)).toEqual([]);
  });
});

describe('fetchPhabSamples', () => {
  it('orchestrates project lookup, revision search, and transaction extraction', async () => {
    const call = vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'project.search') {
        return { data: [{ phid: 'PHID-PROJ-newtabaaaaaaaaaaaaaa' }] };
      }
      if (method === 'differential.revision.search') {
        return {
          data: [
            {
              id: 1,
              phid: 'PHID-DREV-abcdefghijklmnopqrst',
              fields: { authorPHID: 'PHID-USER-authoraaaaaaaaaaaaaa' },
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

    const samples = await fetchPhabSamples({
      client,
      projectSlugs: ['home-newtab-reviewers'],
      lookbackDays: 21,
      now: new Date('2026-04-20T12:00:00Z'),
    });

    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ source: 'phab', reviewer: 'alice' });
    expect(call).toHaveBeenCalledWith(
      'project.search',
      expect.objectContaining({ constraints: { slugs: ['home-newtab-reviewers'] } }),
    );
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

  it('unions revisions across multiple project slugs', async () => {
    const call = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
      if (method === 'project.search') {
        return {
          data: [
            { phid: 'PHID-PROJ-aaaaaaaaaaaaaaaaaaaa' },
            { phid: 'PHID-PROJ-bbbbbbbbbbbbbbbbbbbb' },
          ],
        };
      }
      if (method === 'differential.revision.search') {
        const p = params as { constraints: { projects: string[] } };
        expect(p.constraints.projects).toEqual([
          'PHID-PROJ-aaaaaaaaaaaaaaaaaaaa',
          'PHID-PROJ-bbbbbbbbbbbbbbbbbbbb',
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
      expect.objectContaining({ constraints: { slugs: ['slug-a', 'slug-b'] } }),
    );
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
});
