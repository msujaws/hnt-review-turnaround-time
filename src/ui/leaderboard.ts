import { FAST_HOURS, LEADERBOARD_MIN_SAMPLES, SLA_HOURS } from '../config';
import { isSampleInWindow, type Sample } from '../scripts/collect';
import { computeStats } from '../scripts/stats';
import type { ReviewerLogin } from '../types/brand';

import { isFastSample } from './fastReview';

export interface LeaderboardRow {
  readonly reviewer: ReviewerLogin;
  readonly source: 'phab' | 'github';
  readonly count: number;
  readonly medianTat: number;
  readonly fastCount: number;
  // Percentage of the reviewer's in-window reviews that met the SLA. Primary
  // ranking key — higher is better.
  readonly pctUnderSla: number;
}

export interface LeaderboardOptions {
  readonly windowDays?: number;
  readonly now?: Date;
  readonly minSamples?: number;
  readonly slaHours?: number;
  readonly fastHours?: number;
}

const LEADERBOARD_WINDOW_DAYS = 30;

// Rank reviewers by review quality within a rolling window. Aggregates per
// (source, reviewer) — a person active on both Phabricator and GitHub appears
// once per source, since there is no cross-source identity map. Reviewers below
// `minSamples` are dropped so a single lucky review can't top the board.
//
// Ranking: percentage under SLA (desc), then median turnaround (asc), then
// review count (desc), then login (asc) for a stable order.
export const buildLeaderboard = (
  samples: readonly Sample[],
  options: LeaderboardOptions = {},
): readonly LeaderboardRow[] => {
  const windowDays = options.windowDays ?? LEADERBOARD_WINDOW_DAYS;
  const now = options.now ?? new Date();
  const minSamples = options.minSamples ?? LEADERBOARD_MIN_SAMPLES;
  const slaHours = options.slaHours ?? SLA_HOURS;
  const fastHours = options.fastHours ?? FAST_HOURS;

  const groups = new Map<string, Sample[]>();
  for (const sample of samples) {
    if (!isSampleInWindow(sample, windowDays, now)) continue;
    const key = `${sample.source}:${sample.reviewer}`;
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [sample]);
    else existing.push(sample);
  }

  const rows: LeaderboardRow[] = [];
  for (const group of groups.values()) {
    if (group.length < minSamples) continue;
    const first = group[0];
    if (first === undefined) continue;
    const stats = computeStats(
      group.map((s) => s.tatBusinessHours),
      slaHours,
    );
    rows.push({
      reviewer: first.reviewer,
      source: first.source,
      count: group.length,
      medianTat: stats.median,
      fastCount: group.filter((s) => isFastSample(s, fastHours)).length,
      pctUnderSla: stats.pctUnderSLA,
    });
  }

  return rows.sort(
    (a, b) =>
      b.pctUnderSla - a.pctUnderSla ||
      a.medianTat - b.medianTat ||
      b.count - a.count ||
      a.reviewer.localeCompare(b.reviewer, 'en', { sensitivity: 'base' }),
  );
};
