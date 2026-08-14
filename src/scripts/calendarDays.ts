import { asCalendarDays, type CalendarDays, type IsoTimestamp } from '../types/brand';

const MS_PER_DAY = 86_400_000;

// Elapsed wall-clock days between two instants, fractional and unclipped:
// weekends, nights, and holidays all count. Deliberately not in
// businessHours.ts, and deliberately zone-free — both inputs are absolute
// instants, so a DST transition cannot add or drop an hour the way a
// zone-aware day count would. This is the right clock for a bug's lifetime:
// a bug filed Friday evening and fixed Monday morning waited the whole
// weekend, even though almost no business hours elapsed.
//
// Zero on a reversed or unparseable pair rather than throwing. CalendarDays is
// a nonnegative brand, so a negative span would throw at the constructor, and a
// single clock-skewed or hand-edited row must not fail an entire collect run.
export const calendarDaysBetween = (from: IsoTimestamp, to: IsoTimestamp): CalendarDays => {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return asCalendarDays(0);
  return asCalendarDays(Math.max(0, (end - start) / MS_PER_DAY));
};
