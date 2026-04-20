import type { HistoryRow } from '../src/scripts/collect';

export interface MetadataSummary {
  readonly title: string;
  readonly description: string;
}

const formatHours = (value: number): string => `${(Math.round(value * 10) / 10).toFixed(1)}h`;
const formatPercent = (value: number): string => `${Math.round(value).toString()}%`;

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
  const title = `HNT Review TAT · Phab ${formatHours(latest.phab.window7d.median)} (7d) · GH ${formatHours(latest.github.window7d.median)} (7d) · goal ${slaHours.toString()}h`;
  const description = [
    `Phab 7d: median ${formatHours(latest.phab.window7d.median)}, ${formatPercent(latest.phab.window7d.pctUnderSLA)} under ${slaHours.toString()}h SLA (n=${latest.phab.window7d.n.toString()})`,
    `GH 7d: median ${formatHours(latest.github.window7d.median)}, ${formatPercent(latest.github.window7d.pctUnderSLA)} under ${slaHours.toString()}h SLA (n=${latest.github.window7d.n.toString()})`,
  ].join(' · ');
  return { title, description };
};
