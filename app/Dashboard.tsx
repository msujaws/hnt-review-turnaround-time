import type { FC, ReactElement } from 'react';

import {
  CYCLE_SLA_HOURS,
  DEFAULT_PHAB_PROJECT_SLUG,
  GITHUB_REPO_LABEL,
  GITHUB_REPO_URL,
  PHAB_PROJECT_URL,
  POST_REVIEW_SLA_HOURS,
  ROUNDS_SLA,
} from '../src/config';
import type { HistoryRow, Sample, SourceWindows } from '../src/scripts/collect';
import type { PeopleMap } from '../src/scripts/people';
import { Headline } from '../src/ui/Headline';
import { window7dMedianOverSla } from '../src/ui/redIssue';
import { Tabs, type TabItem } from '../src/ui/Tabs';
import { Trendline, type ChartSource } from '../src/ui/Trendline';

const LINK_CLASSES =
  'text-sky-400 underline decoration-sky-700 underline-offset-4 hover:text-sky-300';

const formatReviewerList = (logins: readonly string[]): string =>
  [...logins].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })).join(', ');

export interface DashboardProps {
  readonly history: readonly HistoryRow[];
  readonly samples: readonly Sample[];
  readonly slaHours: number;
  readonly now: Date;
  readonly peopleMap: PeopleMap;
}

export const Dashboard: FC<DashboardProps> = ({ history, samples, slaHours, now, peopleMap }) => {
  const latest = history.at(-1);
  if (latest === undefined) {
    return (
      <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-neutral-800 bg-neutral-900 text-neutral-400">
        No snapshots yet. Run the daily collector to seed data.
      </div>
    );
  }
  const phabSamples = samples.filter(
    (s): s is Extract<Sample, { source: 'phab' }> => s.source === 'phab',
  );
  const githubSamples = samples.filter(
    (s): s is Extract<Sample, { source: 'github' }> => s.source === 'github',
  );
  const phabReviewers = Object.keys(peopleMap.phab);
  const phabProjectLink = (
    <a href={PHAB_PROJECT_URL} className={LINK_CLASSES} rel="noopener noreferrer" target="_blank">
      {DEFAULT_PHAB_PROJECT_SLUG}
    </a>
  );
  const phabDescription =
    phabReviewers.length === 0 ? (
      <>
        Revisions on mozilla-central where any member of the {phabProjectLink} Phabricator project
        is a requested reviewer &mdash; we use the project&apos;s member list as the roster, not a
        revision tag. Time is measured from the request until that reviewer first accepts, comments,
        or requests changes.
      </>
    ) : (
      <>
        Revisions on mozilla-central where any member of the {phabProjectLink} Phabricator project (
        <span className="text-neutral-200">{formatReviewerList(phabReviewers)}</span>) is a
        requested reviewer &mdash; we use the project&apos;s member list as the roster, not a
        revision tag. Time is measured from the request until that reviewer first accepts, comments,
        or requests changes.
      </>
    );
  const githubDescription = (
    <>
      Pull requests in{' '}
      <a href={GITHUB_REPO_URL} className={LINK_CLASSES} rel="noopener noreferrer" target="_blank">
        {GITHUB_REPO_LABEL}
      </a>{' '}
      where a team member is a requested reviewer. Time stops at that reviewer&apos;s first review
      or review comment.
    </>
  );
  const emptyWindows: SourceWindows = {
    window7d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
    window14d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
    window30d: { n: 0, median: 0, mean: 0, p90: 0, pctUnderSLA: 0 },
  };
  const phabCycle = latest.phabCycle ?? emptyWindows;
  const ghCycle = latest.githubCycle ?? emptyWindows;
  const phabPostReview = latest.phabPostReview ?? emptyWindows;
  const ghPostReview = latest.githubPostReview ?? emptyWindows;
  const phabRounds = latest.phabRounds ?? emptyWindows;
  const ghRounds = latest.githubRounds ?? emptyWindows;

  const hasAnyData = (w: SourceWindows): boolean =>
    w.window7d.n + w.window14d.n + w.window30d.n > 0;

  const landingPanel = (config: {
    readonly title: string;
    readonly windows: SourceWindows;
    readonly sla: number;
    readonly unit?: 'hours' | 'rounds';
    readonly slaLabel?: string;
    readonly trendTitle: string;
    readonly trendSource: ChartSource;
    readonly valueAxisLabel?: string;
    readonly slaLineLabel?: string;
  }): ReactElement => (
    <Headline
      title={config.title}
      window7d={config.windows.window7d}
      window14d={config.windows.window14d}
      window30d={config.windows.window30d}
      slaHours={config.sla}
      samples={[]}
      now={now}
      {...(config.unit === undefined ? {} : { unit: config.unit })}
      {...(config.slaLabel === undefined ? {} : { slaLabel: config.slaLabel })}
      countLabel="land"
      collapsible
      defaultOpen={hasAnyData(config.windows)}
    >
      <Trendline
        title={config.trendTitle}
        history={history}
        source={config.trendSource}
        slaHours={config.sla}
        {...(config.valueAxisLabel === undefined ? {} : { valueAxisLabel: config.valueAxisLabel })}
        {...(config.slaLineLabel === undefined ? {} : { slaLineLabel: config.slaLineLabel })}
      />
    </Headline>
  );

  const phabContent = (
    <div className="flex flex-col gap-6">
      <Headline
        title="Phabricator"
        description={phabDescription}
        window7d={latest.phab.window7d}
        window14d={latest.phab.window14d}
        window30d={latest.phab.window30d}
        slaHours={slaHours}
        samples={phabSamples}
        now={now}
        collapsible
        defaultOpen={hasAnyData(latest.phab)}
      >
        <Trendline title="Phabricator trend" history={history} source="phab" slaHours={slaHours} />
      </Headline>
      {landingPanel({
        title: 'Phabricator · Creation to merge',
        windows: phabCycle,
        sla: CYCLE_SLA_HOURS,
        trendTitle: 'Cycle-time trend (Phab)',
        trendSource: 'phabCycle',
      })}
      {landingPanel({
        title: 'Phabricator · First-review to merge',
        windows: phabPostReview,
        sla: POST_REVIEW_SLA_HOURS,
        trendTitle: 'Post-review trend (Phab)',
        trendSource: 'phabPostReview',
      })}
      {landingPanel({
        title: 'Phabricator · Review rounds',
        windows: phabRounds,
        sla: ROUNDS_SLA,
        unit: 'rounds',
        slaLabel: 'One-shot',
        trendTitle: 'Rounds trend (Phab)',
        trendSource: 'phabRounds',
        valueAxisLabel: 'rounds',
        slaLineLabel: 'one-shot',
      })}
    </div>
  );

  const githubContent = (
    <div className="flex flex-col gap-6">
      <Headline
        title="GitHub"
        description={githubDescription}
        window7d={latest.github.window7d}
        window14d={latest.github.window14d}
        window30d={latest.github.window30d}
        slaHours={slaHours}
        samples={githubSamples}
        now={now}
        collapsible
        defaultOpen={hasAnyData(latest.github)}
      >
        <Trendline title="GitHub trend" history={history} source="github" slaHours={slaHours} />
      </Headline>
      {landingPanel({
        title: 'GitHub · Creation to merge',
        windows: ghCycle,
        sla: CYCLE_SLA_HOURS,
        trendTitle: 'Cycle-time trend (GH)',
        trendSource: 'githubCycle',
      })}
      {landingPanel({
        title: 'GitHub · First-review to merge',
        windows: ghPostReview,
        sla: POST_REVIEW_SLA_HOURS,
        trendTitle: 'Post-review trend (GH)',
        trendSource: 'githubPostReview',
      })}
      {landingPanel({
        title: 'GitHub · Review rounds',
        windows: ghRounds,
        sla: ROUNDS_SLA,
        unit: 'rounds',
        slaLabel: 'One-shot',
        trendTitle: 'Rounds trend (GH)',
        trendSource: 'githubRounds',
        valueAxisLabel: 'rounds',
        slaLineLabel: 'one-shot',
      })}
    </div>
  );

  // A tab is "red" only when its 7-day review-TAT median exceeds the SLA.
  // Narrower than the previous "any bad-tier stat anywhere" rule: the stat
  // cards still tint themselves for warn/bad in the secondary metrics and
  // longer windows; the tab-level signal stays tied to the headline metric.
  const phabHasRedIssue = window7dMedianOverSla(latest.phab, slaHours);
  const githubHasRedIssue = window7dMedianOverSla(latest.github, slaHours);

  const tabs: TabItem[] = [
    {
      id: 'phab',
      label: 'Frontend Team (Phabricator)',
      hasRedIssue: phabHasRedIssue,
      content: phabContent,
    },
    {
      id: 'github',
      label: 'Backend Team (GitHub)',
      hasRedIssue: githubHasRedIssue,
      content: githubContent,
    },
  ];
  return <Tabs tabs={tabs} />;
};
