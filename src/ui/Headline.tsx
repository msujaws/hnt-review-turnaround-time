import type { CSSProperties, FC, ReactNode } from 'react';

import { GITHUB_OWNER, GITHUB_REPO, PHAB_ORIGIN } from '../config';
import { isSampleInWindow, type Sample } from '../scripts/collect';
import type { WindowStats } from '../scripts/stats';

import { asMaterialSymbolName, Icon } from './Icon';
import {
  TIER_CARD_CLASSES,
  TIER_TEXT_CLASSES,
  TIER_VALUE_TEXT_CLASSES,
  tierForHours,
  tierForPctUnderSla,
  type SlaTier,
} from './slaTier';

const SCHEDULE_ICON = asMaterialSymbolName('schedule');
const EXPAND_ICON = asMaterialSymbolName('expand_more');

const CARD_BASE_CLASSES =
  'flex flex-col gap-1 rounded-md p-4 animate-pop-in transition-all duration-200 ease-bouncy hover:-translate-y-0.5 hover:scale-[1.03]';
const CARD_NEUTRAL_CLASSES =
  'bg-neutral-900 ring-1 ring-neutral-800 hover:bg-neutral-800 hover:ring-neutral-700';
const VALUE_NEUTRAL_CLASSES = 'text-neutral-100';

const formatHours = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(1)}h`;
};

// Integer rounds; display as "1", "2", "3"… no decimal or unit suffix because
// the header already labels the panel as "Rounds".
const formatRounds = (value: number): string => String(Math.round(value));

type MetricUnit = 'hours' | 'rounds';

const formatStatValue = (value: number, hasData: boolean, unit: MetricUnit): string => {
  if (!hasData) return 'N/A';
  return unit === 'rounds' ? formatRounds(value) : formatHours(value);
};
const formatPercent = (value: number): string => `${Math.round(value).toString()}%`;
const formatTimestamp = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace('T', ' ').slice(0, 16);
};

interface StatCellProps {
  readonly label: string;
  readonly value: string;
  readonly tier?: SlaTier | undefined;
  readonly animationDelayMs?: number | undefined;
}

const StatCell: FC<StatCellProps> = ({ label, value, tier, animationDelayMs }) => {
  const cardTone = tier === undefined ? CARD_NEUTRAL_CLASSES : TIER_CARD_CLASSES[tier];
  const valueTone = tier === undefined ? VALUE_NEUTRAL_CLASSES : TIER_VALUE_TEXT_CLASSES[tier];
  const style: CSSProperties | undefined =
    animationDelayMs === undefined
      ? undefined
      : { animationDelay: `${animationDelayMs.toString()}ms` };
  return (
    <div className={`${CARD_BASE_CLASSES} ${cardTone}`} style={style}>
      <span className="text-xs uppercase tracking-wide text-neutral-400">{label}</span>
      <span className={`text-2xl font-semibold ${valueTone}`}>{value}</span>
    </div>
  );
};

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
  if (sample.revisionId !== undefined) {
    const label = `D${sample.revisionId.toString()}`;
    return (
      <a
        href={`${PHAB_ORIGIN}/${label}`}
        className="font-mono text-sky-400 underline decoration-sky-700 underline-offset-4 hover:text-sky-300"
        rel="noopener noreferrer"
        target="_blank"
      >
        {label}
      </a>
    );
  }
  return <span className="font-mono text-neutral-300">{String(sample.id)}</span>;
};

interface SampleListProps {
  readonly samples: readonly Sample[];
  readonly slaHours: number;
}

const SampleList: FC<SampleListProps> = ({ samples, slaHours }) => (
  <div className="mt-2 overflow-x-auto rounded-md border border-neutral-800 bg-neutral-950">
    <table className="w-full text-left text-xs text-neutral-300">
      <thead className="bg-neutral-900 text-neutral-400">
        <tr>
          <th className="px-3 py-2 font-medium">Review</th>
          <th className="px-3 py-2 font-medium">Author</th>
          <th className="px-3 py-2 font-medium">Reviewer</th>
          <th className="px-3 py-2 font-medium">Requested</th>
          <th className="px-3 py-2 font-medium">First action</th>
          <th className="px-3 py-2 text-right font-medium">TAT</th>
        </tr>
      </thead>
      <tbody>
        {samples.map((sample) => {
          const tier = tierForHours(sample.tatBusinessHours, slaHours);
          return (
            <tr
              key={`${sample.source}:${String(sample.id)}:${sample.reviewer}`}
              className="border-t border-neutral-800"
            >
              <td className="px-3 py-2">
                <SampleIdentifier sample={sample} />
              </td>
              <td className="px-3 py-2 text-neutral-200">
                {sample.author ?? <span className="text-neutral-500">—</span>}
              </td>
              <td className="px-3 py-2 text-neutral-200">{sample.reviewer}</td>
              <td className="px-3 py-2 text-neutral-400">{formatTimestamp(sample.requestedAt)}</td>
              <td className="px-3 py-2 text-neutral-400">
                {formatTimestamp(sample.firstActionAt)}
              </td>
              <td className={`px-3 py-2 text-right font-medium ${TIER_TEXT_CLASSES[tier]}`}>
                {formatHours(sample.tatBusinessHours)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

interface WindowRowProps {
  readonly label: '7-day' | '14-day' | '30-day';
  readonly stats: WindowStats;
  readonly slaHours: number;
  readonly samples: readonly Sample[];
  readonly now: Date;
  readonly unit: MetricUnit;
  readonly slaLabel: string;
  readonly countLabel: string;
}

const statsTier = (value: number, stats: WindowStats, slaHours: number): SlaTier | undefined =>
  stats.n === 0 ? undefined : tierForHours(value, slaHours);

const pctTier = (stats: WindowStats): SlaTier | undefined =>
  stats.n === 0 ? undefined : tierForPctUnderSla(stats.pctUnderSLA);

const StatGrid: FC<{
  readonly stats: WindowStats;
  readonly slaHours: number;
  readonly unit: MetricUnit;
  readonly slaLabel: string;
}> = ({ stats, slaHours, unit, slaLabel }) => (
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    <StatCell
      label="Median"
      value={formatStatValue(stats.median, stats.n > 0, unit)}
      tier={statsTier(stats.median, stats, slaHours)}
      animationDelayMs={0}
    />
    <StatCell
      label="Mean"
      value={formatStatValue(stats.mean, stats.n > 0, unit)}
      tier={statsTier(stats.mean, stats, slaHours)}
      animationDelayMs={70}
    />
    <StatCell
      label="p90"
      value={formatStatValue(stats.p90, stats.n > 0, unit)}
      tier={statsTier(stats.p90, stats, slaHours)}
      animationDelayMs={140}
    />
    <StatCell
      label={slaLabel}
      value={formatPercent(stats.pctUnderSLA)}
      tier={pctTier(stats)}
      animationDelayMs={210}
    />
  </div>
);

const formatCount = (n: number, countLabel: string): string => {
  if (n === 0) return `no ${countLabel}s in window`;
  return `${n.toString()} ${n === 1 ? countLabel : `${countLabel}s`}`;
};

const RowBody: FC<WindowRowProps> = ({ label, stats, slaHours, unit, slaLabel, countLabel }) => (
  <>
    <div className="flex items-center gap-2 text-sm font-medium text-neutral-300">
      <span>{label}</span>
      <span className="text-neutral-500">·</span>
      <span className="text-neutral-500">{formatCount(stats.n, countLabel)}</span>
    </div>
    <StatGrid stats={stats} slaHours={slaHours} unit={unit} slaLabel={slaLabel} />
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
            <span className="text-neutral-500">{formatCount(props.stats.n, props.countLabel)}</span>
          </div>
          <Icon
            name={EXPAND_ICON}
            className="text-base text-neutral-500 transition-transform group-open:rotate-180"
          />
        </div>
        <StatGrid
          stats={props.stats}
          slaHours={props.slaHours}
          unit={props.unit}
          slaLabel={props.slaLabel}
        />
      </summary>
      <SampleList samples={windowSamples} slaHours={props.slaHours} />
    </details>
  );
};

export interface HeadlineProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly window7d: WindowStats;
  readonly window14d: WindowStats;
  readonly window30d: WindowStats;
  readonly slaHours: number;
  readonly samples: readonly Sample[];
  readonly now: Date;
  // Metric configuration: defaults preserve the original TAT behaviour.
  readonly unit?: MetricUnit;
  readonly slaLabel?: string;
  readonly countLabel?: string;
  // When set, the section renders as <details>/<summary> so the whole panel
  // can be collapsed. `defaultOpen` seeds the initial state; user toggles are
  // DOM-owned (no React state) and reset on reload, matching WindowRow.
  readonly collapsible?: boolean;
  readonly defaultOpen?: boolean;
  readonly children?: ReactNode;
}

interface HeaderContentProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly statusText: string;
  readonly showChevron: boolean;
}

const HeaderContent: FC<HeaderContentProps> = ({ title, description, statusText, showChevron }) => (
  <>
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-xl font-semibold text-neutral-100">{title}</h2>
      <span className="flex items-center gap-2 text-sm text-neutral-400">
        <Icon name={SCHEDULE_ICON} className="text-base" />
        {statusText}
        {showChevron ? (
          <Icon
            name={EXPAND_ICON}
            className="text-base text-neutral-500 transition-transform group-open:rotate-180"
          />
        ) : null}
      </span>
    </div>
    {description === undefined ? null : <p className="text-sm text-neutral-400">{description}</p>}
  </>
);

export const Headline: FC<HeadlineProps> = ({
  title,
  description,
  window7d,
  window14d,
  window30d,
  slaHours,
  samples,
  now,
  unit = 'hours',
  slaLabel,
  countLabel = 'review',
  collapsible = false,
  defaultOpen = false,
  children,
}) => {
  const effectiveSlaLabel = slaLabel ?? `Under ${slaHours.toString()}h SLA`;
  const emptyState = `awaiting first ${countLabel}s`;
  const statusText = window7d.n + window14d.n + window30d.n === 0 ? emptyState : 'rolling windows';
  const windowRows = (
    <>
      <WindowRow
        label="7-day"
        stats={window7d}
        slaHours={slaHours}
        samples={samples}
        now={now}
        unit={unit}
        slaLabel={effectiveSlaLabel}
        countLabel={countLabel}
      />
      <WindowRow
        label="14-day"
        stats={window14d}
        slaHours={slaHours}
        samples={samples}
        now={now}
        unit={unit}
        slaLabel={effectiveSlaLabel}
        countLabel={countLabel}
      />
      <WindowRow
        label="30-day"
        stats={window30d}
        slaHours={slaHours}
        samples={samples}
        now={now}
        unit={unit}
        slaLabel={effectiveSlaLabel}
        countLabel={countLabel}
      />
    </>
  );
  if (collapsible) {
    return (
      <details className="group flex flex-col gap-4" open={defaultOpen}>
        <summary className="flex cursor-pointer list-none flex-col gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&::-webkit-details-marker]:hidden">
          <HeaderContent
            title={title}
            description={description}
            statusText={statusText}
            showChevron
          />
        </summary>
        {windowRows}
        {children}
      </details>
    );
  }
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <HeaderContent
          title={title}
          description={description}
          statusText={statusText}
          showChevron={false}
        />
      </header>
      {windowRows}
      {children}
    </section>
  );
};
