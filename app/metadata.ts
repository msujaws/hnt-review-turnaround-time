import type { HistoryRow, PendingSample, SourceWindows } from '../src/scripts/collect';
import { EMPTY_PEOPLE_MAP, type PeopleMap } from '../src/scripts/people';
import type { WindowStats } from '../src/scripts/stats';
import { isOverduePending } from '../src/ui/OverdueCallout';

export interface MetadataSummary {
  readonly title: string;
  readonly description: string;
}

const formatHours = (value: number, hasData: boolean): string => {
  if (!hasData) return 'N/A';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(1)}h`;
};
const formatPercent = (value: number): string => `${Math.round(value).toString()}%`;

interface Headline {
  readonly label: string;
  readonly stats: WindowStats;
}

const pickHeadlineWindow = (row: SourceWindows): Headline => {
  if (row.window7d.n > 0) return { label: '7d', stats: row.window7d };
  if (row.window14d.n > 0) return { label: '14d', stats: row.window14d };
  return { label: '30d', stats: row.window30d };
};

export interface MetadataOptions {
  readonly pending?: readonly PendingSample[];
  readonly now?: Date;
  readonly peopleMap?: PeopleMap;
}

const countOverdue = (
  pending: readonly PendingSample[],
  now: Date,
  peopleMap: PeopleMap,
  slaHours: number,
): number => pending.filter((p) => isOverduePending(p, now, peopleMap, slaHours)).length;

export const buildMetadataSummary = (
  history: readonly HistoryRow[],
  slaHours: number,
  options: MetadataOptions = {},
): MetadataSummary => {
  const pending = options.pending ?? [];
  const now = options.now ?? new Date();
  const peopleMap = options.peopleMap ?? EMPTY_PEOPLE_MAP;
  const overdueCount = countOverdue(pending, now, peopleMap, slaHours);
  const overduePrefix = overdueCount > 0 ? `⚠ ${overdueCount.toString()} overdue · ` : '';

  const latest = history.at(-1);
  if (latest === undefined) {
    return {
      title: `${overduePrefix}HNT Review TAT`,
      description: overdueCount > 0 ? `${overduePrefix}No snapshots yet.` : 'No snapshots yet.',
    };
  }
  const phab = pickHeadlineWindow(latest.phab);
  const github = pickHeadlineWindow(latest.github);
  const phabHas = phab.stats.n > 0;
  const ghHas = github.stats.n > 0;
  if (!phabHas && !ghHas) {
    return {
      title: `${overduePrefix}HNT Review TAT · awaiting first reviews`,
      description: `${overduePrefix}No reviews yet in the 7/14/30-day windows.`,
    };
  }
  const baseTitle = `HNT Review TAT · Phab ${formatHours(phab.stats.median, phabHas)} (${phab.label}) · GH ${formatHours(github.stats.median, ghHas)} (${github.label}) · goal ${slaHours.toString()}h`;
  const baseDescription = [
    `Phab ${phab.label}: median ${formatHours(phab.stats.median, phabHas)}, ${formatPercent(phab.stats.pctUnderSLA)} under ${slaHours.toString()}h SLA (n=${phab.stats.n.toString()})`,
    `GH ${github.label}: median ${formatHours(github.stats.median, ghHas)}, ${formatPercent(github.stats.pctUnderSLA)} under ${slaHours.toString()}h SLA (n=${github.stats.n.toString()})`,
  ].join(' · ');
  return {
    title: `${overduePrefix}${baseTitle}`,
    description: `${overduePrefix}${baseDescription}`,
  };
};
