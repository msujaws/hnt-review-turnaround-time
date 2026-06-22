import { isSampleInWindow, type Sample } from '../scripts/collect';

// A review is "fast" when its turnaround beat `fastHours` business hours.
// Strictly under: a sample sitting exactly on the threshold is NOT celebrated.
// This intentionally differs from computeStats' pctUnderSLA (which uses `<=`,
// since "under SLA" includes the boundary) — "under 2h" reads as exclusive.
export const isFastSample = (sample: Sample, fastHours: number): boolean =>
  sample.tatBusinessHours < fastHours;

// Count fast samples whose request falls inside the N-day ET window anchored on
// `now`. Reuses isSampleInWindow so "in window" matches the dashboard exactly.
export const countFastInWindow = (
  samples: readonly Sample[],
  windowDays: number,
  now: Date,
  fastHours: number,
): number =>
  samples.filter(
    (sample) => isSampleInWindow(sample, windowDays, now) && isFastSample(sample, fastHours),
  ).length;
