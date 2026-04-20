'use client';

import type { FC } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { HistoryRow } from '../scripts/collect';

import { chartTheme } from './chartTheme';

export type ChartSource = 'phab' | 'github';

export interface ChartPoint {
  readonly date: string;
  readonly median: number;
  readonly mean: number;
  readonly p90: number;
  readonly pctUnderSLA: number;
}

export const buildChartData = (history: readonly HistoryRow[], source: ChartSource): ChartPoint[] =>
  history.map((row) => {
    const window = row[source].window7d;
    return {
      date: row.date,
      median: Math.round(window.median * 100) / 100,
      mean: Math.round(window.mean * 100) / 100,
      p90: Math.round(window.p90 * 100) / 100,
      pctUnderSLA: Math.round(window.pctUnderSLA * 10) / 10,
    };
  });

export interface TrendlineProps {
  readonly title: string;
  readonly history: readonly HistoryRow[];
  readonly source: ChartSource;
  readonly slaHours?: number;
}

export const Trendline: FC<TrendlineProps> = ({ title, history, source, slaHours = 4 }) => {
  const data = buildChartData(history, source);
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-lg font-semibold text-neutral-100">{title}</h3>
      <div
        data-testid={`trendline-${source}`}
        className="h-72 w-full rounded-md border border-neutral-800 bg-neutral-900 p-4"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={[...data]}>
            <CartesianGrid stroke={chartTheme.grid} strokeDasharray="4 4" />
            <XAxis dataKey="date" stroke={chartTheme.textMuted} tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="hours"
              stroke={chartTheme.textMuted}
              tick={{ fontSize: 12 }}
              label={{
                value: 'hours',
                angle: -90,
                position: 'insideLeft',
                fill: chartTheme.textMuted,
              }}
            />
            <YAxis
              yAxisId="pct"
              orientation="right"
              domain={[0, 100]}
              stroke={chartTheme.textMuted}
              tick={{ fontSize: 12 }}
              label={{
                value: '% SLA',
                angle: 90,
                position: 'insideRight',
                fill: chartTheme.textMuted,
              }}
            />
            <Tooltip
              contentStyle={{
                background: chartTheme.surface,
                border: `1px solid ${chartTheme.grid}`,
                color: chartTheme.text,
              }}
            />
            <Legend wrapperStyle={{ color: chartTheme.text }} />
            <ReferenceLine
              y={slaHours}
              yAxisId="hours"
              stroke={chartTheme.slaLine}
              strokeDasharray="3 3"
              label={{
                value: `${slaHours.toString()}h SLA`,
                fill: chartTheme.slaLine,
                fontSize: 10,
              }}
            />
            <Line
              yAxisId="hours"
              type="monotone"
              dataKey="median"
              stroke={chartTheme.series.median}
              strokeWidth={2}
              dot={false}
              name="Median"
            />
            <Line
              yAxisId="hours"
              type="monotone"
              dataKey="mean"
              stroke={chartTheme.series.mean}
              strokeWidth={2}
              dot={false}
              name="Mean"
            />
            <Line
              yAxisId="hours"
              type="monotone"
              dataKey="p90"
              stroke={chartTheme.series.p90}
              strokeWidth={2}
              dot={false}
              name="p90"
            />
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="pctUnderSLA"
              stroke={chartTheme.series.pctUnderSLA}
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              name="% under SLA"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
};
