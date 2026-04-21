export type SlaTier = 'good' | 'warn' | 'bad';

const WARN_MULTIPLIER = 2;
const PCT_GOOD_THRESHOLD = 90;
const PCT_WARN_THRESHOLD = 70;

export const tierForHours = (hours: number, slaHours: number): SlaTier => {
  if (hours <= slaHours) return 'good';
  if (hours <= slaHours * WARN_MULTIPLIER) return 'warn';
  return 'bad';
};

export const tierForPctUnderSla = (pct: number): SlaTier => {
  if (pct >= PCT_GOOD_THRESHOLD) return 'good';
  if (pct >= PCT_WARN_THRESHOLD) return 'warn';
  return 'bad';
};

export const TIER_CARD_CLASSES: Record<SlaTier, string> = {
  good: 'bg-emerald-400/10 ring-1 ring-emerald-400/30',
  warn: 'bg-amber-400/10 ring-1 ring-amber-400/30',
  bad: 'bg-rose-400/10 ring-1 ring-rose-400/30',
};

export const TIER_VALUE_TEXT_CLASSES: Record<SlaTier, string> = {
  good: 'text-emerald-100',
  warn: 'text-amber-100',
  bad: 'text-rose-100',
};

export const TIER_TEXT_CLASSES: Record<SlaTier, string> = {
  good: 'text-emerald-200',
  warn: 'text-amber-200',
  bad: 'text-rose-200',
};
