import type { FC } from 'react';

import { businessHoursBetween } from '../scripts/businessHours';
import type { PendingSample } from '../scripts/collect';
import { timezoneForReviewer, type PeopleMap } from '../scripts/people';
import { asIsoTimestamp } from '../types/brand';

import { asMaterialSymbolName, Icon } from './Icon';

const WARNING_ICON = asMaterialSymbolName('warning');

const GITHUB_OWNER = 'Pocket';
const GITHUB_REPO = 'content-monorepo';
const PHAB_ORIGIN = 'https://phabricator.services.mozilla.com';

const OVERDUE_MULTIPLIER = 10;
const SEVERE_MULTIPLIER = 20;

const waitingHoursFor = (sample: PendingSample, now: Date, peopleMap: PeopleMap): number =>
  businessHoursBetween(
    sample.requestedAt,
    asIsoTimestamp(now.toISOString()),
    timezoneForReviewer(peopleMap, sample.source, sample.reviewer),
  );

export const isOverduePending = (
  sample: PendingSample,
  now: Date,
  peopleMap: PeopleMap,
  slaHours: number,
): boolean => waitingHoursFor(sample, now, peopleMap) >= slaHours * OVERDUE_MULTIPLIER;

const formatHours = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(1)}h`;
};

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

const sourceBadge = (source: PendingSample['source']): string =>
  source === 'github' ? 'GH' : 'Phab';

export interface OverdueCalloutProps {
  readonly pending: readonly PendingSample[];
  readonly now: Date;
  readonly slaHours: number;
  readonly peopleMap: PeopleMap;
}

export const OverdueCallout: FC<OverdueCalloutProps> = ({ pending, now, slaHours, peopleMap }) => {
  const overdue = pending
    .map((sample) => ({ sample, hours: waitingHoursFor(sample, now, peopleMap) }))
    .filter((entry) => entry.hours >= slaHours * OVERDUE_MULTIPLIER)
    .sort((a, b) => b.hours - a.hours);

  if (overdue.length === 0) return null;

  return (
    <section
      aria-labelledby="overdue-heading"
      className="flex animate-pop-in flex-col gap-3 rounded-md border border-red-900/50 bg-red-950/30 p-4"
    >
      <header className="flex items-center gap-2">
        <Icon name={WARNING_ICON} className="animate-soft-pulse text-xl text-red-400" />
        <h2 id="overdue-heading" className="text-lg font-semibold text-red-200">
          Overdue ({overdue.length.toString()}) · waiting{' '}
          {(slaHours * OVERDUE_MULTIPLIER).toString()}
          h+ business hours
        </h2>
      </header>
      <div className="overflow-x-auto rounded-md border border-red-900/50 bg-neutral-950">
        <table className="w-full text-left text-xs text-neutral-300">
          <thead className="bg-neutral-900 text-neutral-400">
            <tr>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Review</th>
              <th className="px-3 py-2 font-medium">Author</th>
              <th className="px-3 py-2 font-medium">Reviewer</th>
              <th className="px-3 py-2 font-medium">Requested</th>
              <th className="px-3 py-2 text-right font-medium">Waiting</th>
            </tr>
          </thead>
          <tbody>
            {overdue.map(({ sample, hours }) => (
              <tr
                key={`${sample.source}:${String(sample.id)}:${sample.reviewer}`}
                data-testid="overdue-row"
                className="border-t border-neutral-800"
              >
                <td className="px-3 py-2 text-neutral-400">{sourceBadge(sample.source)}</td>
                <td className="px-3 py-2">
                  <a
                    href={linkFor(sample)}
                    className="font-mono text-sky-400 underline decoration-sky-700 underline-offset-4 hover:text-sky-300"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {labelFor(sample)}
                  </a>
                </td>
                <td className="px-3 py-2 text-neutral-200">
                  {sample.author ?? <span className="text-neutral-500">—</span>}
                </td>
                <td className="px-3 py-2 text-neutral-200">{sample.reviewer}</td>
                <td className="px-3 py-2 text-neutral-400">
                  {formatTimestamp(sample.requestedAt)}
                </td>
                <td className="px-3 py-2 text-right font-medium text-red-200">
                  <span
                    className={`inline-block ${
                      hours >= slaHours * SEVERE_MULTIPLIER ? 'animate-wiggle' : ''
                    }`}
                  >
                    {formatHours(hours)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
