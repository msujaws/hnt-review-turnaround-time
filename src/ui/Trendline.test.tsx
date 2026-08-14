import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { HistoryRow } from '../scripts/collect';

import { buildChartData, slaReferenceFor, Trendline } from './Trendline';

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

describe('slaReferenceFor', () => {
  it('draws a labelled line for a metric with a target', () => {
    expect(slaReferenceFor({ slaHours: 24 })).toEqual({ y: 24, label: '24h SLA' });
  });

  it('prefers an explicit label over the hours default', () => {
    expect(slaReferenceFor({ slaHours: 1, slaLineLabel: 'one-shot' })).toEqual({
      y: 1,
      label: 'one-shot',
    });
  });

  // Bug fix time has no team goal, so a dashed line at 7 days would invent one.
  it('draws no line when the metric has no target', () => {
    expect(slaReferenceFor({ slaHours: null })).toBeNull();
  });
});

describe('Trendline bug fix source', () => {
  const bugWindows = {
    window7d: { n: 3, median: 4.6, mean: 18.4, p90: 47.6, pctUnderSLA: 62 },
    window14d: { n: 9, median: 5.1, mean: 20.2, p90: 51.3, pctUnderSLA: 58 },
    window30d: { n: 30, median: 6, mean: 22, p90: 60, pctUnderSLA: 55 },
  };

  it('reads the 14-day window off the bugFix key', () => {
    const history: HistoryRow[] = [
      { date: '2026-04-20', phab: bugWindows, github: bugWindows, bugFix: bugWindows },
    ];
    expect(buildChartData(history, 'bugFix')).toEqual([
      { date: '2026-04-20', median: 5.1, mean: 20.2, p90: 51.3, pctUnderSLA: 58 },
    ]);
  });

  // Rows written before the metric shipped have no bugFix key. They plot as a
  // zero point rather than throwing.
  it('emits a zero point for a row predating the metric', () => {
    const history: HistoryRow[] = [{ date: '2026-04-01', phab: bugWindows, github: bugWindows }];
    expect(buildChartData(history, 'bugFix')).toEqual([
      { date: '2026-04-01', median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
    ]);
  });

  it('renders the chart container for the bugFix source with no sla line', () => {
    render(
      <Trendline
        title="Bug fix-time trend"
        history={[{ date: '2026-04-20', phab: bugWindows, github: bugWindows, bugFix: bugWindows }]}
        source="bugFix"
        slaHours={null}
        valueAxisLabel="days"
        pctAxisLabel="% ≤ 7d"
      />,
    );
    expect(screen.getByTestId('trendline-bugFix')).toBeInTheDocument();
  });
});
