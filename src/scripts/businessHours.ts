import { DateTime, type DateTime as LuxonDateTime, Interval } from 'luxon';

import { asBusinessHours, type BusinessHours, type IsoTimestamp } from '../types/brand';

const ZONE = 'America/New_York';
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 17;

const workingWindowForDay = (day: LuxonDateTime): Interval | null => {
  const weekday = day.weekday;
  if (weekday === 6 || weekday === 7) {
    return null;
  }
  const open = day.set({ hour: WORK_START_HOUR, minute: 0, second: 0, millisecond: 0 });
  const close = day.set({ hour: WORK_END_HOUR, minute: 0, second: 0, millisecond: 0 });
  return Interval.fromDateTimes(open, close);
};

export const businessHoursBetween = (start: IsoTimestamp, end: IsoTimestamp): BusinessHours => {
  const startDateTime = DateTime.fromISO(start, { zone: ZONE });
  const endDateTime = DateTime.fromISO(end, { zone: ZONE });

  if (!startDateTime.isValid || !endDateTime.isValid || endDateTime <= startDateTime) {
    return asBusinessHours(0);
  }

  const requestInterval = Interval.fromDateTimes(startDateTime, endDateTime);
  let totalMinutes = 0;
  let cursor = startDateTime.startOf('day');
  const lastDay = endDateTime.startOf('day');

  while (cursor <= lastDay) {
    const window = workingWindowForDay(cursor);
    if (window !== null) {
      const overlap = requestInterval.intersection(window);
      if (overlap !== null) {
        totalMinutes += overlap.length('minutes');
      }
    }
    cursor = cursor.plus({ days: 1 });
  }

  return asBusinessHours(totalMinutes / 60);
};
