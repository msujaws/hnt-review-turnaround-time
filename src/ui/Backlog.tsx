import type { FC } from 'react';

import { GITHUB_OWNER, GITHUB_REPO, PHAB_ORIGIN } from '../config';
import { businessHoursBetween } from '../scripts/businessHours';
import type { BacklogSnapshot, BacklogSourceStats, PendingSample } from '../scripts/collect';
import { timezoneForReviewer, type PeopleMap } from '../scripts/people';
import { asIsoTimestamp } from '../types/brand';

import { asMaterialSymbolName, Icon } from './Icon';

const EXPAND_ICON = asMaterialSymbolName('expand_more');

const formatHours = (value: number): string => `${(Math.round(value * 10) / 10).toFixed(1)}h`;

const formatCount = (n: number): string => (n === 1 ? '1 open' : `${n.toString()} open`);

const formatTimestamp = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace('T', ' ').slice(0, 16);
};

const linkFor = (sample: PendingSample): string =>
  sample.source === 'github'
    ? `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/pull/${String(sample.id)}`
    : `${PHAB_ORIGIN}/D${String(sample.revisionId)}`;

const labelFor = (sample: PendingSample): string =>
  sample.source === 'github' ? `#${String(sample.id)}` : `D${String(sample.revisionId)}`;

const waitingHoursFor = (sample: PendingSample, now: Date, peopleMap: PeopleMap): number =>
  businessHoursBetween(
    sample.requestedAt,
    asIsoTimestamp(now.toISOString()),
    timezoneForReviewer(peopleMap, sample.source, sample.reviewer),
  );

// Phabricator query for every open revision where the team's project is the
// "responsible" party (author or reviewer). Same filter the page in the Phab
// UI uses; lets the user see the broader set the dashboard intentionally
// narrows (team-authored + needs-review only).
const PHAB_FULL_RESULTS_URL =
  'https://phabricator.services.mozilla.com/differential/?responsiblePHIDs%5B0%5D=PHID-PROJ-mjq6kpntsdx4ugyvwdoz&statuses%5B0%5D=open()&order=newest&bucket=action';

const fullResultsUrlFor = (source: 'phab' | 'github'): string | undefined =>
  source === 'phab' ? PHAB_FULL_RESULTS_URL : undefined;

const PendingList: FC<{
  readonly entries: readonly { readonly sample: PendingSample; readonly hours: number }[];
  readonly fullResultsUrl?: string | undefined;
}> = ({ entries, fullResultsUrl }) => (
  <div className="flex flex-col gap-2 pt-3">
    <ul className="flex flex-col gap-2">
      {entries.map(({ sample, hours }) => (
        <li
          key={`${sample.source}:${String(sample.id)}:${sample.reviewer}`}
          data-testid="backlog-row"
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded bg-neutral-950 px-3 py-2 text-xs ring-1 ring-neutral-800"
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <a
              href={linkFor(sample)}
              className="font-mono text-sky-400 underline decoration-sky-700 underline-offset-4 hover:text-sky-300"
              rel="noopener noreferrer"
              target="_blank"
            >
              {labelFor(sample)}
            </a>
            <span className="text-neutral-500">·</span>
            <span className="text-neutral-300">
              {sample.author ?? <span className="text-neutral-500">—</span>} →{' '}
              <span className="text-neutral-100">{sample.reviewer}</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 text-neutral-400">
            <span>{formatTimestamp(sample.requestedAt)}</span>
            <span className="text-neutral-500">·</span>
            <span className="font-medium text-neutral-200">{formatHours(hours)} waiting</span>
          </div>
        </li>
      ))}
    </ul>
    {fullResultsUrl === undefined ? null : (
      <a
        href={fullResultsUrl}
        className="self-end pt-1 text-xs text-sky-400 underline decoration-sky-700 underline-offset-4 hover:text-sky-300"
        rel="noopener noreferrer"
        target="_blank"
      >
        Full Results
      </a>
    )}
  </div>
);

const SourceCard: FC<{
  readonly label: string;
  readonly source: 'phab' | 'github';
  readonly stats: BacklogSourceStats;
  readonly pending: readonly PendingSample[];
  readonly now: Date;
  readonly peopleMap: PeopleMap;
}> = ({ label, source, stats, pending, now, peopleMap }) => {
  const cardClass = 'flex flex-col gap-1 rounded-md bg-neutral-900 p-4 ring-1 ring-neutral-800';
  if (stats.openCount === 0) {
    return (
      <div className={cardClass}>
        <span className="text-xs uppercase tracking-wide text-neutral-400">{label}</span>
        <span className="text-lg font-semibold text-neutral-400">no open reviews</span>
      </div>
    );
  }
  const entries = pending
    .filter((sample) => sample.source === source)
    .map((sample) => ({ sample, hours: waitingHoursFor(sample, now, peopleMap) }))
    .sort((a, b) => b.hours - a.hours);
  return (
    <details
      data-testid={`backlog-${source}-details`}
      className={`group ${cardClass} open:bg-neutral-900`}
    >
      <summary className="flex cursor-pointer list-none flex-col gap-1 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-neutral-400">{label}</span>
          <Icon
            name={EXPAND_ICON}
            className="text-base text-neutral-500 transition-transform group-open:rotate-180"
          />
        </div>
        <span className="text-2xl font-semibold text-neutral-100">
          {formatCount(stats.openCount)}
        </span>
        <span className="text-xs text-neutral-400">
          oldest {formatHours(stats.oldestBusinessHours)} · p90{' '}
          {formatHours(stats.p90BusinessHours)}
        </span>
      </summary>
      <PendingList entries={entries} fullResultsUrl={fullResultsUrlFor(source)} />
    </details>
  );
};

export interface BacklogProps {
  readonly snapshots: readonly BacklogSnapshot[];
  readonly pending: readonly PendingSample[];
  readonly now: Date;
  readonly peopleMap: PeopleMap;
}

export const Backlog: FC<BacklogProps> = ({ snapshots, pending, now, peopleMap }) => {
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
        <SourceCard
          label="Phab"
          source="phab"
          stats={latest.phab}
          pending={pending}
          now={now}
          peopleMap={peopleMap}
        />
        <SourceCard
          label="GitHub"
          source="github"
          stats={latest.github}
          pending={pending}
          now={now}
          peopleMap={peopleMap}
        />
      </div>
    </section>
  );
};
