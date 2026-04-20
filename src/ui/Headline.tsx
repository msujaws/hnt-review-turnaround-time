import type { FC } from 'react';

import type { WindowStats } from '../scripts/stats';

import { asMaterialSymbolName, Icon } from './Icon';

const SCHEDULE_ICON = asMaterialSymbolName('schedule');

const formatHours = (value: number): string => `${(Math.round(value * 10) / 10).toFixed(1)}h`;
const formatPercent = (value: number): string => `${Math.round(value).toString()}%`;

interface StatCellProps {
  readonly label: string;
  readonly value: string;
}

const StatCell: FC<StatCellProps> = ({ label, value }) => (
  <div className="flex flex-col gap-1 rounded-md bg-neutral-900 p-4">
    <span className="text-xs uppercase tracking-wide text-neutral-400">{label}</span>
    <span className="text-3xl font-semibold text-neutral-100">{value}</span>
  </div>
);

export interface HeadlineProps {
  readonly title: string;
  readonly stats: WindowStats;
  readonly slaHours: number;
}

export const Headline: FC<HeadlineProps> = ({ title, stats, slaHours }) => (
  <section className="flex flex-col gap-4">
    <header className="flex items-baseline justify-between">
      <h2 className="text-xl font-semibold text-neutral-100">{title}</h2>
      <span className="flex items-center gap-2 text-sm text-neutral-400">
        <Icon name={SCHEDULE_ICON} className="text-base" />
        {stats.n === 0 ? 'no reviews in window' : `${stats.n.toString()} reviews (7d)`}
      </span>
    </header>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCell label="Median" value={formatHours(stats.median)} />
      <StatCell label="Mean" value={formatHours(stats.mean)} />
      <StatCell label="p90" value={formatHours(stats.p90)} />
      <StatCell
        label={`Under ${slaHours.toString()}h SLA`}
        value={formatPercent(stats.pctUnderSLA)}
      />
    </div>
  </section>
);
