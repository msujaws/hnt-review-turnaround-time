import { describe, expect, it } from 'vitest';

import {
  asBusinessHours,
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
