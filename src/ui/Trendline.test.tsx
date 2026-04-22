import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { HistoryRow } from '../scripts/collect';

import { buildChartData, Trendline } from './Trendline';

const row = (date: string, medianHours: number, pctUnderSLA: number): HistoryRow => ({
  date,
  phab: {
    window7d: { n: 1, median: medianHours, mean: medianHours, p90: medianHours, pctUnderSLA },
    window14d: { n: 1, median: medianHours, mean: medianHours, p90: medianHours, pctUnderSLA },
    window30d: { n: 1, median: medianHours, mean: medianHours, p90: medianHours, pctUnderSLA },
  },
  github: {
    window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
    window14d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
    window30d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
  },
});

describe('buildChartData', () => {
  it('extracts the 14d window stats for the requested source', () => {
    const history = [row('2026-04-19', 2, 85), row('2026-04-20', 3, 90)];
    const data = buildChartData(history, 'phab');
    expect(data).toEqual([
      { date: '2026-04-19', median: 2, mean: 2, p90: 2, pctUnderSLA: 85 },
      { date: '2026-04-20', median: 3, mean: 3, p90: 3, pctUnderSLA: 90 },
    ]);
  });

  it('returns an empty array for empty history', () => {
    expect(buildChartData([], 'phab')).toEqual([]);
  });

  it('returns zeroed points when the chosen metric key is missing on the row', () => {
    const history = [row('2026-04-19', 2, 85)];
    const data = buildChartData(history, 'phabCycle');
    expect(data).toEqual([{ date: '2026-04-19', median: 0, mean: 0, p90: 0, pctUnderSLA: 0 }]);
  });

  it('extracts phabCycle window stats when present', () => {
    const baseRow = row('2026-04-19', 2, 85);
    const withCycle: HistoryRow = {
      ...baseRow,
      phabCycle: {
        window7d: { n: 5, median: 10, mean: 12, p90: 20, pctUnderSLA: 60 },
        window14d: { n: 12, median: 15, mean: 18, p90: 30, pctUnderSLA: 50 },
        window30d: { n: 30, median: 20, mean: 22, p90: 40, pctUnderSLA: 45 },
      },
    };
    const data = buildChartData([withCycle], 'phabCycle');
    expect(data[0]).toEqual({
      date: '2026-04-19',
      median: 15,
      mean: 18,
      p90: 30,
      pctUnderSLA: 50,
    });
  });
});

describe('Trendline', () => {
  it('renders a section with the chart title', () => {
    const history = [row('2026-04-19', 2, 85), row('2026-04-20', 3, 90)];
    render(<Trendline title="Phabricator Trend" history={history} source="phab" />);
    expect(screen.getByRole('heading', { name: /phabricator trend/i })).toBeInTheDocument();
  });

  it('renders a data container with the chart data attribute', () => {
    const history = [row('2026-04-19', 2, 85)];
    render(<Trendline title="Phab" history={history} source="phab" />);
    const container = screen.getByTestId('trendline-phab');
    expect(container).toBeInTheDocument();
  });
});
