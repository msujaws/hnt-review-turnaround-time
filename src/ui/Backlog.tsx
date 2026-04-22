import type { FC } from 'react';

import type { BacklogSnapshot, BacklogSourceStats } from '../scripts/collect';

const formatHours = (value: number): string => `${(Math.round(value * 10) / 10).toFixed(1)}h`;

const formatCount = (n: number): string => (n === 1 ? '1 open' : `${n.toString()} open`);

const SourceCard: FC<{ readonly label: string; readonly stats: BacklogSourceStats }> = ({
  label,
  stats,
}) => (
  <div className="flex flex-col gap-1 rounded-md bg-neutral-900 p-4 ring-1 ring-neutral-800">
    <span className="text-xs uppercase tracking-wide text-neutral-400">{label}</span>
    {stats.openCount === 0 ? (
      <span className="text-lg font-semibold text-neutral-400">no open reviews</span>
    ) : (
      <>
        <span className="text-2xl font-semibold text-neutral-100">
          {formatCount(stats.openCount)}
        </span>
        <span className="text-xs text-neutral-400">
          oldest {formatHours(stats.oldestBusinessHours)} · p90{' '}
          {formatHours(stats.p90BusinessHours)}
        </span>
      </>
    )}
  </div>
);

export interface BacklogProps {
  readonly snapshots: readonly BacklogSnapshot[];
}

export const Backlog: FC<BacklogProps> = ({ snapshots }) => {
  const latest = snapshots.at(-1);
  if (latest === undefined) {
    return (
      <div className="rounded-md border border-dashed border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-400">
        No backlog snapshots yet. The collector writes one per run.
      </div>
    );
  }
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
        Open review backlog
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SourceCard label="Phab" stats={latest.phab} />
        <SourceCard label="GitHub" stats={latest.github} />
      </div>
    </section>
  );
};
