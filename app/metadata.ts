import type { HistoryRow } from '../src/scripts/collect';
import type { WindowStats } from '../src/scripts/stats';

export interface MetadataSummary {
  readonly title: string;
  readonly description: string;
}

const formatHours = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 'N/A' : `${rounded.toFixed(1)}h`;
};
const formatPercent = (value: number): string => `${Math.round(value).toString()}%`;

interface Headline {
  readonly label: string;
  readonly stats: WindowStats;
}

const pickHeadlineWindow = (row: HistoryRow['phab']): Headline => {
  if (row.window7d.n > 0) return { label: '7d', stats: row.window7d };
  if (row.window14d.n > 0) return { label: '14d', stats: row.window14d };
  return { label: '30d', stats: row.window30d };
};

export const buildMetadataSummary = (
  history: readonly HistoryRow[],
  slaHours: number,
): MetadataSummary => {
  const latest = history.at(-1);
  if (latest === undefined) {
    return {
      title: 'HNT Review TAT',
      description: 'No snapshots yet.',
    };
  }
  const phab = pickHeadlineWindow(latest.phab);
  const github = pickHeadlineWindow(latest.github);
  const title = `HNT Review TAT · Phab ${formatHours(phab.stats.median)} (${phab.label}) · GH ${formatHours(github.stats.median)} (${github.label}) · goal ${slaHours.toString()}h`;
  const description = [
    `Phab ${phab.label}: median ${formatHours(phab.stats.median)}, ${formatPercent(phab.stats.pctUnderSLA)} under ${slaHours.toString()}h SLA (n=${phab.stats.n.toString()})`,
    `GH ${github.label}: median ${formatHours(github.stats.median)}, ${formatPercent(github.stats.pctUnderSLA)} under ${slaHours.toString()}h SLA (n=${github.stats.n.toString()})`,
  ].join(' · ');
  return { title, description };
};
