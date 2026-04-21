import type { FC } from 'react';

import { isSampleInWindow, type Sample } from '../scripts/collect';
import type { WindowStats } from '../scripts/stats';

import { asMaterialSymbolName, Icon } from './Icon';

const SCHEDULE_ICON = asMaterialSymbolName('schedule');
const EXPAND_ICON = asMaterialSymbolName('expand_more');

const GITHUB_OWNER = 'Pocket';
const GITHUB_REPO = 'content-monorepo';

const formatHours = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(1)}h`;
};

const formatStatHours = (value: number, hasData: boolean): string =>
  hasData ? formatHours(value) : 'N/A';
const formatPercent = (value: number): string => `${Math.round(value).toString()}%`;
const formatTimestamp = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace('T', ' ').slice(0, 16);
};

interface StatCellProps {
  readonly label: string;
  readonly value: string;
  readonly accent?: boolean;
}

const StatCell: FC<StatCellProps> = ({ label, value, accent }) => (
  <div
    className={`flex flex-col gap-1 rounded-md p-4 ${accent === true ? 'bg-neutral-800' : 'bg-neutral-900'}`}
  >
    <span className="text-xs uppercase tracking-wide text-neutral-400">{label}</span>
    <span className="text-2xl font-semibold text-neutral-100">{value}</span>
  </div>
);

const windowDaysFor = (label: '7-day' | '14-day' | '30-day'): number => {
  if (label === '7-day') return 7;
  if (label === '14-day') return 14;
  return 30;
};

const filterSamplesForWindow = (samples: readonly Sample[], days: number, now: Date): Sample[] =>
  samples
    .filter((s) => isSampleInWindow(s, days, now))
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));

interface SampleRowProps {
  readonly sample: Sample;
}

const SampleIdentifier: FC<SampleRowProps> = ({ sample }) => {
  if (sample.source === 'github') {
    return (
      <a
        href={`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/pull/${String(sample.id)}`}
        className="font-mono text-sky-400 underline decoration-sky-700 underline-offset-4 hover:text-sky-300"
        rel="noopener noreferrer"
        target="_blank"
      >
        #{String(sample.id)}
      </a>
    );
  }
  return <span className="font-mono text-neutral-300">{String(sample.id)}</span>;
};

const SampleList: FC<{ readonly samples: readonly Sample[] }> = ({ samples }) => (
  <div className="mt-2 overflow-x-auto rounded-md border border-neutral-800 bg-neutral-950">
    <table className="w-full text-left text-xs text-neutral-300">
      <thead className="bg-neutral-900 text-neutral-400">
        <tr>
          <th className="px-3 py-2 font-medium">Review</th>
          <th className="px-3 py-2 font-medium">Reviewer</th>
          <th className="px-3 py-2 font-medium">Requested</th>
          <th className="px-3 py-2 font-medium">First action</th>
          <th className="px-3 py-2 text-right font-medium">TAT</th>
        </tr>
      </thead>
      <tbody>
        {samples.map((sample) => (
          <tr
            key={`${sample.source}:${String(sample.id)}:${sample.reviewer}`}
            className="border-t border-neutral-800"
          >
            <td className="px-3 py-2">
              <SampleIdentifier sample={sample} />
            </td>
            <td className="px-3 py-2 text-neutral-200">{sample.reviewer}</td>
            <td className="px-3 py-2 text-neutral-400">{formatTimestamp(sample.requestedAt)}</td>
            <td className="px-3 py-2 text-neutral-400">{formatTimestamp(sample.firstActionAt)}</td>
            <td className="px-3 py-2 text-right font-medium text-neutral-100">
              {formatHours(sample.tatBusinessHours)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

interface WindowRowProps {
  readonly label: '7-day' | '14-day' | '30-day';
  readonly stats: WindowStats;
  readonly slaHours: number;
  readonly accent?: boolean;
  readonly samples: readonly Sample[];
  readonly now: Date;
}

const RowBody: FC<WindowRowProps> = ({ label, stats, slaHours, accent }) => (
  <>
    <div className="flex items-center gap-2 text-sm font-medium text-neutral-300">
      <span>{label}</span>
      <span className="text-neutral-500">·</span>
      <span className="text-neutral-500">
        {stats.n === 0
          ? 'no reviews in window'
          : `${stats.n.toString()} ${stats.n === 1 ? 'review' : 'reviews'}`}
      </span>
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <StatCell
        label="Median"
        value={formatStatHours(stats.median, stats.n > 0)}
        accent={accent ?? false}
      />
      <StatCell
        label="Mean"
        value={formatStatHours(stats.mean, stats.n > 0)}
        accent={accent ?? false}
      />
      <StatCell
        label="p90"
        value={formatStatHours(stats.p90, stats.n > 0)}
        accent={accent ?? false}
      />
      <StatCell
        label={`Under ${slaHours.toString()}h SLA`}
        value={formatPercent(stats.pctUnderSLA)}
        accent={accent ?? false}
      />
    </div>
  </>
);

const WindowRow: FC<WindowRowProps> = (props) => {
  const windowSamples = filterSamplesForWindow(
    props.samples,
    windowDaysFor(props.label),
    props.now,
  );
  if (windowSamples.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <RowBody {...props} />
      </div>
    );
  }
  return (
    <details
      data-testid={`window-${windowDaysFor(props.label).toString()}d-details`}
      className="group flex flex-col gap-2 rounded-md"
    >
      <summary className="flex cursor-pointer list-none flex-col gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-neutral-300">
            <span>{props.label}</span>
            <span className="text-neutral-500">·</span>
            <span className="text-neutral-500">{`${props.stats.n.toString()} ${props.stats.n === 1 ? 'review' : 'reviews'}`}</span>
          </div>
          <Icon
            name={EXPAND_ICON}
            className="text-base text-neutral-500 transition-transform group-open:rotate-180"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCell
            label="Median"
            value={formatStatHours(props.stats.median, props.stats.n > 0)}
            accent={props.accent ?? false}
          />
          <StatCell
            label="Mean"
            value={formatStatHours(props.stats.mean, props.stats.n > 0)}
            accent={props.accent ?? false}
          />
          <StatCell
            label="p90"
            value={formatStatHours(props.stats.p90, props.stats.n > 0)}
            accent={props.accent ?? false}
          />
          <StatCell
            label={`Under ${props.slaHours.toString()}h SLA`}
            value={formatPercent(props.stats.pctUnderSLA)}
            accent={props.accent ?? false}
          />
        </div>
      </summary>
      <SampleList samples={windowSamples} />
    </details>
  );
};

export interface HeadlineProps {
  readonly title: string;
  readonly window7d: WindowStats;
  readonly window14d: WindowStats;
  readonly window30d: WindowStats;
  readonly slaHours: number;
  readonly samples: readonly Sample[];
  readonly now: Date;
}

export const Headline: FC<HeadlineProps> = ({
  title,
  window7d,
  window14d,
  window30d,
  slaHours,
  samples,
  now,
}) => (
  <section className="flex flex-col gap-4">
    <header className="flex items-baseline justify-between">
      <h2 className="text-xl font-semibold text-neutral-100">{title}</h2>
      <span className="flex items-center gap-2 text-sm text-neutral-400">
        <Icon name={SCHEDULE_ICON} className="text-base" />
        {window7d.n + window14d.n + window30d.n === 0
          ? 'awaiting first reviews'
          : 'rolling windows'}
      </span>
    </header>
    <WindowRow label="7-day" stats={window7d} slaHours={slaHours} samples={samples} now={now} />
    <WindowRow
      label="14-day"
      stats={window14d}
      slaHours={slaHours}
      accent
      samples={samples}
      now={now}
    />
    <WindowRow label="30-day" stats={window30d} slaHours={slaHours} samples={samples} now={now} />
  </section>
);
