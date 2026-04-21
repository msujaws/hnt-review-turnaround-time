import type { FC } from 'react';

import type { WindowStats } from '../scripts/stats';

import { asMaterialSymbolName, Icon } from './Icon';

const SCHEDULE_ICON = asMaterialSymbolName('schedule');

const formatHours = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 'N/A' : `${rounded.toFixed(1)}h`;
};
const formatPercent = (value: number): string => `${Math.round(value).toString()}%`;

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

interface WindowRowProps {
  readonly label: string;
  readonly stats: WindowStats;
  readonly slaHours: number;
  readonly accent?: boolean;
}

const WindowRow: FC<WindowRowProps> = ({ label, stats, slaHours, accent }) => (
  <div className="flex flex-col gap-2">
    <div className="flex items-center gap-2 text-sm font-medium text-neutral-300">
      <span>{label}</span>
      <span className="text-neutral-500">·</span>
      <span className="text-neutral-500">
        {stats.n === 0 ? 'no reviews in window' : `${stats.n.toString()} reviews`}
      </span>
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <StatCell label="Median" value={formatHours(stats.median)} accent={accent ?? false} />
      <StatCell label="Mean" value={formatHours(stats.mean)} accent={accent ?? false} />
      <StatCell label="p90" value={formatHours(stats.p90)} accent={accent ?? false} />
      <StatCell
        label={`Under ${slaHours.toString()}h SLA`}
        value={formatPercent(stats.pctUnderSLA)}
        accent={accent ?? false}
      />
    </div>
  </div>
);

export interface HeadlineProps {
  readonly title: string;
  readonly window7d: WindowStats;
  readonly window14d: WindowStats;
  readonly window30d: WindowStats;
  readonly slaHours: number;
}

export const Headline: FC<HeadlineProps> = ({
  title,
  window7d,
  window14d,
  window30d,
  slaHours,
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
    <WindowRow label="7-day" stats={window7d} slaHours={slaHours} />
    <WindowRow label="14-day" stats={window14d} slaHours={slaHours} accent />
    <WindowRow label="30-day" stats={window30d} slaHours={slaHours} />
  </section>
);
