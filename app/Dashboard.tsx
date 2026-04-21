import type { FC } from 'react';

import type { HistoryRow, Sample } from '../src/scripts/collect';
import { Headline } from '../src/ui/Headline';
import { Trendline } from '../src/ui/Trendline';

export interface DashboardProps {
  readonly history: readonly HistoryRow[];
  readonly samples: readonly Sample[];
  readonly slaHours: number;
  readonly now: Date;
}

export const Dashboard: FC<DashboardProps> = ({ history, samples, slaHours, now }) => {
  const latest = history.at(-1);
  if (latest === undefined) {
    return (
      <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-neutral-800 bg-neutral-900 text-neutral-400">
        No snapshots yet. Run the daily collector to seed data.
      </div>
    );
  }
  const phabSamples = samples.filter((s) => s.source === 'phab');
  const githubSamples = samples.filter((s) => s.source === 'github');
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-6">
        <Headline
          title="Phabricator"
          window7d={latest.phab.window7d}
          window14d={latest.phab.window14d}
          window30d={latest.phab.window30d}
          slaHours={slaHours}
          samples={phabSamples}
          now={now}
        />
        <Trendline title="Phabricator trend" history={history} source="phab" slaHours={slaHours} />
      </div>
      <div className="flex flex-col gap-6">
        <Headline
          title="GitHub"
          window7d={latest.github.window7d}
          window14d={latest.github.window14d}
          window30d={latest.github.window30d}
          slaHours={slaHours}
          samples={githubSamples}
          now={now}
        />
        <Trendline title="GitHub trend" history={history} source="github" slaHours={slaHours} />
      </div>
    </div>
  );
};
