import { describe, expect, it } from 'vitest';

import {
  asBusinessHours,
  asGithubRepoSlug,
  asGroupId,
  asIsoTimestamp,
  asPrNumber,
  asReviewerLogin,
  asRevisionPhid,
} from './brand';

describe('asRevisionPhid', () => {
  it('accepts a valid Phabricator revision PHID', () => {
    const value = 'PHID-DREV-abcdefghijklmnopqrst';
    expect(asRevisionPhid(value)).toBe(value);
  });

  it('rejects empty string', () => {
    expect(() => asRevisionPhid('')).toThrow();
  });

  it('rejects PHID with the wrong type prefix', () => {
    expect(() => asRevisionPhid('PHID-USER-abcdefghijklmnopqrst')).toThrow();
  });

  it('rejects PHID with the wrong payload length', () => {
    expect(() => asRevisionPhid('PHID-DREV-tooshort')).toThrow();
  });
});

describe('asPrNumber', () => {
  it('accepts a positive integer', () => {
    expect(asPrNumber(42)).toBe(42);
  });

  it('rejects zero', () => {
    expect(() => asPrNumber(0)).toThrow();
  });

  it('rejects negative numbers', () => {
    expect(() => asPrNumber(-1)).toThrow();
  });

  it('rejects non-integers', () => {
    expect(() => asPrNumber(1.5)).toThrow();
  });
});

describe('asReviewerLogin', () => {
  it('accepts a non-empty string', () => {
    expect(asReviewerLogin('alice')).toBe('alice');
  });

  it('rejects empty string', () => {
    expect(() => asReviewerLogin('')).toThrow();
  });

  it('rejects whitespace-only string', () => {
    expect(() => asReviewerLogin('   ')).toThrow();
  });
});

describe('asBusinessHours', () => {
  it('accepts zero', () => {
    expect(asBusinessHours(0)).toBe(0);
  });

  it('accepts positive values', () => {
    expect(asBusinessHours(2.5)).toBe(2.5);
  });

  it('rejects negative values', () => {
    expect(() => asBusinessHours(-0.1)).toThrow();
  });

  it('rejects NaN', () => {
    expect(() => asBusinessHours(Number.NaN)).toThrow();
  });

  it('rejects Infinity', () => {
    expect(() => asBusinessHours(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('asIsoTimestamp', () => {
  it('accepts a valid ISO 8601 UTC timestamp', () => {
    const value = '2026-04-20T14:02:00.000Z';
    expect(asIsoTimestamp(value)).toBe(value);
  });

  it('accepts a timestamp without milliseconds', () => {
    const value = '2026-04-20T14:02:00Z';
    expect(asIsoTimestamp(value)).toBe(value);
  });

  it('rejects a string that is not a timestamp', () => {
    expect(() => asIsoTimestamp('yesterday')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => asIsoTimestamp('')).toThrow();
  });
});

describe('asGroupId', () => {
  it('accepts a lowercase hyphenated slug', () => {
    expect(asGroupId('home-newtab')).toBe('home-newtab');
  });

  it('accepts a single lowercase word', () => {
    expect(asGroupId('sharing')).toBe('sharing');
  });

  it('rejects empty string', () => {
    expect(() => asGroupId('')).toThrow();
  });

  it('rejects uppercase characters', () => {
    expect(() => asGroupId('Home-Newtab')).toThrow();
  });

  it('rejects underscores and spaces', () => {
    expect(() => asGroupId('home_newtab')).toThrow();
    expect(() => asGroupId('home newtab')).toThrow();
  });

  it('rejects a leading hyphen or digit', () => {
    expect(() => asGroupId('-home')).toThrow();
    expect(() => asGroupId('1home')).toThrow();
  });
});

describe('asGithubRepoSlug', () => {
  it('accepts an owner/repo slug', () => {
    expect(asGithubRepoSlug('Pocket/content-monorepo')).toBe('Pocket/content-monorepo');
  });

  it('preserves case for URL building', () => {
    expect(asGithubRepoSlug('mozilla-services/merino-py')).toBe('mozilla-services/merino-py');
  });

  it('rejects empty string', () => {
    expect(() => asGithubRepoSlug('')).toThrow();
  });

  it('rejects a slug with no slash', () => {
    expect(() => asGithubRepoSlug('content-monorepo')).toThrow();
  });

  it('rejects a slug with more than one slash', () => {
    expect(() => asGithubRepoSlug('Pocket/content/monorepo')).toThrow();
  });

  it('rejects empty owner or repo segments', () => {
    expect(() => asGithubRepoSlug('/content-monorepo')).toThrow();
    expect(() => asGithubRepoSlug('Pocket/')).toThrow();
  });

  it('rejects whitespace in a segment', () => {
    expect(() => asGithubRepoSlug('Pocket/content monorepo')).toThrow();
  });
});
