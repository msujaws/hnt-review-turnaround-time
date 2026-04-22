import { describe, expect, it, vi } from 'vitest';

import {
  asBusinessHours,
  asIsoTimestamp,
  asPrNumber,
  asReviewerLogin,
  asRevisionPhid,
} from '../types/brand';

import { lookupPhabAuthors, mergeAuthors } from './backfillAuthors';
import type { PendingSample, Sample } from './collect';
import type { ConduitClient } from './phabricator';

const phabSample = (
  overrides: Partial<Extract<Sample, { source: 'phab' }>> = {},
): Extract<Sample, { source: 'phab' }> => ({
  source: 'phab',
  id: asRevisionPhid('PHID-DREV-aaaaaaaaaaaaaaaaaaaa'),
  revisionId: 12_345,
  reviewer: asReviewerLogin('alice'),
  requestedAt: asIsoTimestamp('2026-04-10T10:00:00Z'),
  firstActionAt: asIsoTimestamp('2026-04-10T12:00:00Z'),
  tatBusinessHours: asBusinessHours(2),
  ...overrides,
});

const ghSample = (
  overrides: Partial<Extract<Sample, { source: 'github' }>> = {},
): Extract<Sample, { source: 'github' }> => ({
  source: 'github',
  id: asPrNumber(42),
  reviewer: asReviewerLogin('alice'),
  requestedAt: asIsoTimestamp('2026-04-10T10:00:00Z'),
  firstActionAt: asIsoTimestamp('2026-04-10T12:00:00Z'),
  tatBusinessHours: asBusinessHours(2),
  ...overrides,
});

const phabPending = (
  overrides: Partial<Extract<PendingSample, { source: 'phab' }>> = {},
): Extract<PendingSample, { source: 'phab' }> => ({
  source: 'phab',
  id: asRevisionPhid('PHID-DREV-bbbbbbbbbbbbbbbbbbbb'),
  revisionId: 67_890,
  reviewer: asReviewerLogin('bob'),
  requestedAt: asIsoTimestamp('2026-04-10T10:00:00Z'),
  ...overrides,
});

describe('mergeAuthors', () => {
  it('fills in phab author on samples missing it using the phid lookup', () => {
    const samples: Sample[] = [phabSample()];
    const merged = mergeAuthors({
      samples,
      pending: [],
      phabAuthorByRevisionPhid: new Map([
        ['PHID-DREV-aaaaaaaaaaaaaaaaaaaa', asReviewerLogin('connie')],
      ]),
      githubAuthorByPrNumber: new Map(),
    });
    expect(merged.samples[0]?.author).toBe('connie');
  });

  it('fills in github author on samples missing it using the PR lookup', () => {
    const samples: Sample[] = [ghSample({ id: asPrNumber(382) })];
    const merged = mergeAuthors({
      samples,
      pending: [],
      phabAuthorByRevisionPhid: new Map(),
      githubAuthorByPrNumber: new Map([[382, asReviewerLogin('dave')]]),
    });
    expect(merged.samples[0]?.author).toBe('dave');
  });

  it('fills in author on pending samples, not just completed samples', () => {
    const pending: PendingSample[] = [phabPending()];
    const merged = mergeAuthors({
      samples: [],
      pending,
      phabAuthorByRevisionPhid: new Map([
        ['PHID-DREV-bbbbbbbbbbbbbbbbbbbb', asReviewerLogin('connie')],
      ]),
      githubAuthorByPrNumber: new Map(),
    });
    expect(merged.pending[0]?.author).toBe('connie');
  });

  it('leaves samples that already have an author untouched', () => {
    const samples: Sample[] = [phabSample({ author: asReviewerLogin('existing') })];
    const merged = mergeAuthors({
      samples,
      pending: [],
      phabAuthorByRevisionPhid: new Map([
        ['PHID-DREV-aaaaaaaaaaaaaaaaaaaa', asReviewerLogin('should-not-overwrite')],
      ]),
      githubAuthorByPrNumber: new Map(),
    });
    expect(merged.samples[0]?.author).toBe('existing');
  });

  it('leaves samples whose id is missing from the lookup untouched', () => {
    const samples: Sample[] = [phabSample()];
    const merged = mergeAuthors({
      samples,
      pending: [],
      phabAuthorByRevisionPhid: new Map(),
      githubAuthorByPrNumber: new Map(),
    });
    expect(merged.samples[0]?.author).toBeUndefined();
  });
});

describe('lookupPhabAuthors', () => {
  it('paginates user.search so author PHIDs past the first page resolve', async () => {
    const userSearchCalls: { phids: string[]; after: string | undefined }[] = [];
    const call = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
      if (method === 'differential.revision.search') {
        return {
          data: [
            {
              phid: 'PHID-DREV-aaaaaaaaaaaaaaaaaaaa',
              fields: { authorPHID: 'PHID-USER-aaaaaaaaaaaaaaaaaaaa' },
            },
            {
              phid: 'PHID-DREV-bbbbbbbbbbbbbbbbbbbb',
              fields: { authorPHID: 'PHID-USER-bbbbbbbbbbbbbbbbbbbb' },
            },
          ],
          cursor: { after: null },
        };
      }
      if (method === 'user.search') {
        const p = params as { constraints: { phids: string[] }; after?: string };
        userSearchCalls.push({ phids: p.constraints.phids, after: p.after });
        if (p.after === undefined) {
          return {
            data: [{ phid: 'PHID-USER-aaaaaaaaaaaaaaaaaaaa', fields: { username: 'alice' } }],
            cursor: { after: 'CURSOR-PAGE-2' },
          };
        }
        return {
          data: [{ phid: 'PHID-USER-bbbbbbbbbbbbbbbbbbbb', fields: { username: 'bob' } }],
          cursor: { after: null },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const client: ConduitClient = { call };
    const byRev = await lookupPhabAuthors(client, [
      'PHID-DREV-aaaaaaaaaaaaaaaaaaaa',
      'PHID-DREV-bbbbbbbbbbbbbbbbbbbb',
    ]);
    expect(userSearchCalls.length).toBeGreaterThanOrEqual(2);
    expect(byRev.get('PHID-DREV-aaaaaaaaaaaaaaaaaaaa')).toBe('alice');
    expect(byRev.get('PHID-DREV-bbbbbbbbbbbbbbbbbbbb')).toBe('bob');
  });

  it('chunks the revision phids constraint into batches of at most 100', async () => {
    const revisionSearchBatches: string[][] = [];
    const revisionPhids = Array.from(
      { length: 120 },
      (_, index) => `PHID-DREV-${String(index).padStart(20, '0')}`,
    );
    const call = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
      if (method === 'differential.revision.search') {
        const p = params as { constraints: { phids: string[] } };
        revisionSearchBatches.push([...p.constraints.phids]);
        return {
          data: p.constraints.phids.map((phid) => ({
            phid,
            fields: { authorPHID: `PHID-USER-${phid.slice(-11)}` },
          })),
          cursor: { after: null },
        };
      }
      if (method === 'user.search') {
        const p = params as { constraints: { phids: string[] } };
        return {
          data: p.constraints.phids.map((phid) => ({
            phid,
            fields: { username: `u${phid.slice(-5)}` },
          })),
          cursor: { after: null },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const client: ConduitClient = { call };
    const byRev = await lookupPhabAuthors(client, revisionPhids);
    expect(revisionSearchBatches.length).toBeGreaterThanOrEqual(2);
    for (const batch of revisionSearchBatches) {
      expect(batch.length).toBeLessThanOrEqual(100);
    }
    expect(byRev.size).toBe(revisionPhids.length);
  });
});
