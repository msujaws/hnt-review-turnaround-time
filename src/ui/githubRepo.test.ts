import { describe, expect, it } from 'vitest';

import { githubPrUrl, githubRepoShortName } from './githubRepo';

describe('githubPrUrl', () => {
  it('builds a PR URL for an explicit repo slug', () => {
    expect(githubPrUrl('mozilla-services/merino-py', 123)).toBe(
      'https://github.com/mozilla-services/merino-py/pull/123',
    );
  });

  it('defaults a repo-less (legacy) row to content-monorepo', () => {
    expect(githubPrUrl(undefined, 42)).toBe('https://github.com/Pocket/content-monorepo/pull/42');
  });
});

describe('githubRepoShortName', () => {
  it('returns the repo portion after the owner', () => {
    expect(githubRepoShortName('mozilla-services/merino-py')).toBe('merino-py');
  });

  it('defaults a repo-less row to the content-monorepo short name', () => {
    const noRepo: string | undefined = undefined;
    expect(githubRepoShortName(noRepo)).toBe('content-monorepo');
  });
});
