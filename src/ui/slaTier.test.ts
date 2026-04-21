import { describe, expect, it } from 'vitest';

import { TIER_CARD_CLASSES, TIER_TEXT_CLASSES, tierForHours, tierForPctUnderSla } from './slaTier';

describe('tierForHours', () => {
  const SLA = 4;

  it('returns "good" when hours equal the SLA', () => {
    expect(tierForHours(SLA, SLA)).toBe('good');
  });

  it('returns "good" when hours are below the SLA', () => {
    expect(tierForHours(1.3, SLA)).toBe('good');
    expect(tierForHours(0, SLA)).toBe('good');
  });

  it('returns "warn" when hours are strictly above the SLA but at or below 2x', () => {
    expect(tierForHours(4.01, SLA)).toBe('warn');
    expect(tierForHours(6, SLA)).toBe('warn');
    expect(tierForHours(SLA * 2, SLA)).toBe('warn');
  });

  it('returns "bad" when hours exceed 2x the SLA', () => {
    expect(tierForHours(8.01, SLA)).toBe('bad');
    expect(tierForHours(40, SLA)).toBe('bad');
  });

  it('scales with a different SLA value', () => {
    expect(tierForHours(2, 2)).toBe('good');
    expect(tierForHours(3, 2)).toBe('warn');
    expect(tierForHours(4, 2)).toBe('warn');
    expect(tierForHours(4.01, 2)).toBe('bad');
  });
});

describe('tierForPctUnderSla', () => {
  it('returns "good" at or above 90%', () => {
    expect(tierForPctUnderSla(100)).toBe('good');
    expect(tierForPctUnderSla(90)).toBe('good');
  });

  it('returns "warn" between 70% (inclusive) and 90% (exclusive)', () => {
    expect(tierForPctUnderSla(89.99)).toBe('warn');
    expect(tierForPctUnderSla(83)).toBe('warn');
    expect(tierForPctUnderSla(70)).toBe('warn');
  });

  it('returns "bad" below 70%', () => {
    expect(tierForPctUnderSla(69.99)).toBe('bad');
    expect(tierForPctUnderSla(0)).toBe('bad');
  });
});

describe('tier class maps', () => {
  it('maps every tier to a card class string', () => {
    expect(TIER_CARD_CLASSES.good).toMatch(/emerald/);
    expect(TIER_CARD_CLASSES.warn).toMatch(/amber/);
    expect(TIER_CARD_CLASSES.bad).toMatch(/rose/);
  });

  it('maps every tier to a text class string', () => {
    expect(TIER_TEXT_CLASSES.good).toMatch(/emerald/);
    expect(TIER_TEXT_CLASSES.warn).toMatch(/amber/);
    expect(TIER_TEXT_CLASSES.bad).toMatch(/rose/);
  });
});
