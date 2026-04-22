export interface WindowStats {
  readonly n: number;
  readonly median: number;
  readonly mean: number;
  readonly p90: number;
  readonly pctUnderSLA: number;
}

const percentile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const position = (sorted.length - 1) * p;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const fraction = position - lowerIndex;
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * fraction;
};

// Metric-agnostic: values may be business hours (TAT, cycle, post-review) or
// integer review-round counts. `slaHours` is really "SLA threshold in the
// same units as samples" — callers pass ROUNDS_SLA for rounds, CYCLE_SLA_HOURS
// for cycle time, etc. pctUnderSLA is the percentage of samples <= threshold.
export const computeStats = (samples: readonly number[], slaHours: number): WindowStats => {
  const n = samples.length;
  if (n === 0) {
    return { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce<number>((total, value) => total + value, 0);
  const mean = sum / n;
  const median = percentile(sorted, 0.5);
  const p90 = percentile(sorted, 0.9);
  const meetingSla = sorted.filter((value) => value <= slaHours).length;
  const pctUnderSLA = (meetingSla / n) * 100;

  return { n, median, mean, p90, pctUnderSLA };
};
