import { describe, expect, it } from 'vitest';

import {
  asBusinessHours,
  asIsoTimestamp,
  asPrNumber,
  asReviewerLogin,
  asRevisionPhid,
} from '../types/brand';

import { mergeAuthors } from './backfillAuthors';
import type { PendingSample, Sample } from './collect';

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
