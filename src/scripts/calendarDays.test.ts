import { describe, expect, it } from 'vitest';

import { asIsoTimestamp } from '../types/brand';

import { calendarDaysBetween } from './calendarDays';

const ts = (value: string): ReturnType<typeof asIsoTimestamp> => asIsoTimestamp(value);

describe('calendarDaysBetween', () => {
  it('counts a whole day', () => {
    expect(calendarDaysBetween(ts('2026-05-01T00:00:00Z'), ts('2026-05-02T00:00:00Z'))).toBe(1);
  });

  it('counts fractional days', () => {
    expect(calendarDaysBetween(ts('2026-05-01T00:00:00Z'), ts('2026-05-01T12:00:00Z'))).toBe(0.5);
  });

  it('reproduces a real bug lifetime to one decimal', () => {
    // Bug 2036233: filed 2026-05-01T01:31:25Z, resolved 2026-05-04T20:27:23Z.
    const days = calendarDaysBetween(ts('2026-05-01T01:31:25Z'), ts('2026-05-04T20:27:23Z'));
    expect(days).toBeCloseTo(3.79, 2);
  });

  it('returns zero for identical timestamps', () => {
    expect(calendarDaysBetween(ts('2026-05-01T00:00:00Z'), ts('2026-05-01T00:00:00Z'))).toBe(0);
  });

  it('clamps a reversed pair to zero rather than throwing', () => {
    // CalendarDays is a nonnegative brand, so a negative span would throw at the
    // constructor. A clock-skewed or migrated bug must not fail the whole run.
    expect(calendarDaysBetween(ts('2026-05-02T00:00:00Z'), ts('2026-05-01T00:00:00Z'))).toBe(0);
  });

  it('counts weekends, unlike businessHoursBetween', () => {
    // 2026-05-02 is a Saturday; Fri 18:00 -> Mon 06:00 is 2.5 wall-clock days
    // even though it contains almost no business hours.
    expect(calendarDaysBetween(ts('2026-05-01T18:00:00Z'), ts('2026-05-04T06:00:00Z'))).toBe(2.5);
  });

  it('is unaffected by a DST transition', () => {
    // US DST ends 2026-11-01. Both inputs are absolute instants, so a 90-day
    // span stays exactly 90 rather than gaining the extra hour a zone-aware
    // day count would introduce.
    expect(calendarDaysBetween(ts('2026-10-01T12:00:00Z'), ts('2026-12-30T12:00:00Z'))).toBe(90);
  });

  it('returns zero when a timestamp is unparseable', () => {
    // asIsoTimestamp guards the boundary, but bugs.json is read from disk and a
    // hand-edited file should degrade to zero rather than NaN.
    const bogus = 'not-a-date' as unknown as ReturnType<typeof asIsoTimestamp>;
    expect(calendarDaysBetween(bogus, ts('2026-05-01T00:00:00Z'))).toBe(0);
    expect(calendarDaysBetween(ts('2026-05-01T00:00:00Z'), bogus)).toBe(0);
  });
});
