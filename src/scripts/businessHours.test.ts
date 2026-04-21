import { describe, expect, it } from 'vitest';

import { asIanaTimezone, asIsoTimestamp } from '../types/brand';

import { businessHoursBetween } from './businessHours';

const ts = (value: string): ReturnType<typeof asIsoTimestamp> => asIsoTimestamp(value);
const tz = (value: string): ReturnType<typeof asIanaTimezone> => asIanaTimezone(value);

describe('businessHoursBetween', () => {
  it('returns 0 for identical timestamps', () => {
    expect(businessHoursBetween(ts('2026-01-05T15:00:00Z'), ts('2026-01-05T15:00:00Z'))).toBe(0);
  });

  it('returns 0 when end precedes start', () => {
    expect(businessHoursBetween(ts('2026-01-05T16:00:00Z'), ts('2026-01-05T15:00:00Z'))).toBe(0);
  });

  it('counts a sub-hour span inside business hours', () => {
    // Mon 2026-01-05 10:00 ET → 11:30 ET (EST = UTC-5)
    expect(
      businessHoursBetween(ts('2026-01-05T15:00:00Z'), ts('2026-01-05T16:30:00Z')),
    ).toBeCloseTo(1.5, 5);
  });

  it('does not count time outside 09:00-17:00 ET', () => {
    // Mon 2026-01-05 06:00 ET → 08:00 ET (before open)
    expect(businessHoursBetween(ts('2026-01-05T11:00:00Z'), ts('2026-01-05T13:00:00Z'))).toBe(0);
  });

  it('handles an overnight span across two weekdays', () => {
    // Mon 17:00 ET → Tue 09:30 ET = 0.5h (only 09:00-09:30 Tue counts)
    expect(
      businessHoursBetween(ts('2026-01-05T22:00:00Z'), ts('2026-01-06T14:30:00Z')),
    ).toBeCloseTo(0.5, 5);
  });

  it('handles a weekend span', () => {
    // Fri 16:00 ET → Mon 10:00 ET = 1h (Fri 16-17) + 1h (Mon 09-10) = 2h
    expect(
      businessHoursBetween(ts('2026-01-09T21:00:00Z'), ts('2026-01-12T15:00:00Z')),
    ).toBeCloseTo(2, 5);
  });

  it('handles a request starting on a weekend', () => {
    // Sat 10:00 ET → Mon 10:00 ET = 1h (Mon 09-10)
    expect(
      businessHoursBetween(ts('2026-01-10T15:00:00Z'), ts('2026-01-12T15:00:00Z')),
    ).toBeCloseTo(1, 5);
  });

  it('counts a full working day', () => {
    // Mon 09:00 ET → Mon 17:00 ET = 8h
    expect(
      businessHoursBetween(ts('2026-01-05T14:00:00Z'), ts('2026-01-05T22:00:00Z')),
    ).toBeCloseTo(8, 5);
  });

  it('handles the spring-forward DST transition weekend', () => {
    // Fri 2026-03-06 09:00 EST → Mon 2026-03-09 11:00 EDT = 8h + 2h = 10h
    // Fri 09:00 EST = 14:00 UTC; Mon 11:00 EDT = 15:00 UTC
    expect(
      businessHoursBetween(ts('2026-03-06T14:00:00Z'), ts('2026-03-09T15:00:00Z')),
    ).toBeCloseTo(10, 5);
  });

  it('handles the fall-back DST transition weekend', () => {
    // Fri 2026-10-30 09:00 EDT → Mon 2026-11-02 11:00 EST = 8h + 2h = 10h
    // Fri 09:00 EDT = 13:00 UTC; Mon 11:00 EST = 16:00 UTC
    expect(
      businessHoursBetween(ts('2026-10-30T13:00:00Z'), ts('2026-11-02T16:00:00Z')),
    ).toBeCloseTo(10, 5);
  });

  it('respects a non-ET timezone for the business-hour window', () => {
    // Melbourne in June is AEST (UTC+10), no DST.
    // Request at 2026-06-01T00:00:00Z = Mon 10:00 AEST (inside 9-17)
    // First action at 2026-06-01T02:00:00Z = Mon 12:00 AEST → 2h
    expect(
      businessHoursBetween(
        ts('2026-06-01T00:00:00Z'),
        ts('2026-06-01T02:00:00Z'),
        tz('Australia/Melbourne'),
      ),
    ).toBeCloseTo(2, 5);
  });

  it('treats the same wall-clock span as outside business hours in ET and inside in Melbourne', () => {
    // 2026-06-01T01:00:00Z → 03:00:00Z
    // ET: 21:00 → 23:00 Sun (weekend, 0 business hours)
    // Melbourne: 11:00 → 13:00 Mon (inside business hours, 2h)
    expect(
      businessHoursBetween(
        ts('2026-06-01T01:00:00Z'),
        ts('2026-06-01T03:00:00Z'),
        tz('America/New_York'),
      ),
    ).toBe(0);
    expect(
      businessHoursBetween(
        ts('2026-06-01T01:00:00Z'),
        ts('2026-06-01T03:00:00Z'),
        tz('Australia/Melbourne'),
      ),
    ).toBeCloseTo(2, 5);
  });

  it('handles multiple full weeks', () => {
    // Mon 2026-01-05 09:00 ET → Mon 2026-01-12 09:00 ET
    // 5 weekdays × 8h = 40h
    expect(
      businessHoursBetween(ts('2026-01-05T14:00:00Z'), ts('2026-01-12T14:00:00Z')),
    ).toBeCloseTo(40, 5);
  });
});
