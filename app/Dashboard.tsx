import { Fragment, type FC, type ReactElement, type ReactNode } from 'react';

import {
  CYCLE_SLA_HOURS,
  FIXED_WITHIN_DAYS,
  POST_REVIEW_SLA_HOURS,
  ROUNDS_SLA,
} from '../src/config';
import { defaultGroup, type GroupConfig } from '../src/groups';
import type { BugSample, HistoryRow, Landing, Sample, SourceWindows } from '../src/scripts/collect';
import type { PeopleMap } from '../src/scripts/people';
import { bugzillaBuglistUrl, bugzillaScopeLabel } from '../src/ui/bugzillaLinks';
import { Headline, type HeadlineItems, type MetricUnit } from '../src/ui/Headline';
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
  readonly landings: readonly Landing[];
  // Bugs backing the filed-to-fixed panel. Optional so existing call sites (and
  // a group whose first collect hasn't run) don't have to supply it.
  readonly bugs?: readonly BugSample[];
  readonly slaHours: number;
  readonly now: Date;
  readonly peopleMap: PeopleMap;
  // Which review group this dashboard renders. Defaults to Home-NewTab — the
  // only group that also tracks GitHub. Phabricator-only groups drop the
  // GitHub tab entirely.
  readonly group?: GroupConfig;
}

export const Dashboard: FC<DashboardProps> = ({
  history,
  samples,
  landings,
  bugs = [],
  slaHours,
  now,
  peopleMap,
  group = defaultGroup(),
}) => {
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
  const phabLandings = landings.filter(
    (l): l is Extract<Landing, { source: 'phab' }> => l.source === 'phab',
  );
  const githubLandings = landings.filter(
    (l): l is Extract<Landing, { source: 'github' }> => l.source === 'github',
  );
  const phabReviewers = Object.keys(peopleMap.phab);
  const phabProjectLink = (
    <a
      href={group.phabProjectUrl}
      className={LINK_CLASSES}
      rel="noopener noreferrer"
      target="_blank"
    >
      {group.phabProjectSlugs.join(', ')}
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
  const githubRepos = group.github ?? [];
  const hasGithub = githubRepos.length > 0;
  // Each repo can gate differently: content-monorepo counts team-member
  // reviewers; merino-py is scoped to the backend team's own PRs but counts
  // any reviewer. Describe each repo's scope from its config so the copy stays
  // accurate as the roster/repos change.
  const describeRepoScope = (repo: (typeof githubRepos)[number]): ReactElement =>
    repo.authorLogins === undefined ? (
      <>where a team member is a requested reviewer</>
    ) : (
      <>
        authored by{' '}
        <span className="text-neutral-200">{formatReviewerList([...repo.authorLogins])}</span>
        {repo.gateReviewersByRoster === false ? ' (any reviewer)' : ''}
      </>
    );
  const githubDescription = (
    <>
      Pull requests in{' '}
      {githubRepos.map((repo, index) => (
        <Fragment key={`${repo.owner}/${repo.repo}`}>
          {index > 0 ? '; ' : ''}
          <a
            href={`https://github.com/${repo.owner}/${repo.repo}`}
            className={LINK_CLASSES}
            rel="noopener noreferrer"
            target="_blank"
          >
            {repo.owner.toLowerCase()}/{repo.repo}
          </a>{' '}
          {describeRepoScope(repo)}
        </Fragment>
      ))}
      . Time stops at that reviewer&apos;s first review or review comment.
    </>
  );
  const bugFixDescription = (
    <>
      Bugs in{' '}
      <a
        href={bugzillaBuglistUrl(group.bugzilla ?? [])}
        className={LINK_CLASSES}
        rel="noopener noreferrer"
        target="_blank"
      >
        {bugzillaScopeLabel(group.bugzilla ?? [])}
      </a>{' '}
      resolved FIXED, measured from filing to the last resolution. Clock is in{' '}
      <strong>calendar</strong> days, weekends included &mdash; unlike the review metrics above.
      Bucketed by resolution date, so every bug counted has both timestamps. Read the median: the
      distribution is heavily right-skewed, so the mean and p90 are pulled up by a handful of
      long-lived bugs and are not typical.
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
  const bugFix = latest.bugFix ?? emptyWindows;
  // Gated on config rather than on `latest.bugFix` being present, so the panel
  // shows Headline's honest empty state in the window between deploy and the
  // first cron instead of vanishing.
  const bugzillaScopes = group.bugzilla ?? [];
  const hasBugzilla = bugzillaScopes.length > 0;

  const hasAnyData = (w: SourceWindows): boolean =>
    w.window7d.n + w.window14d.n + w.window30d.n > 0;

  // Renamed from landingPanel: it renders bug rows too, and a factory called
  // landingPanel that emits a Bugzilla table would be a lie. `items` is passed
  // as a HeadlineItems rather than a kind + array so a caller cannot pair the
  // bugFix kind with a landings array.
  const metricPanel = (config: {
    readonly title: string;
    readonly description?: ReactNode;
    readonly windows: SourceWindows;
    // The threshold fed to the stat cards. `trendSla` controls the chart line
    // separately, so a metric can report a "% within" figure without drawing a
    // goal line for it.
    readonly sla: number;
    readonly trendSla?: number | null;
    readonly unit?: MetricUnit;
    readonly slaLabel?: string;
    readonly countLabel?: string;
    readonly trendTitle: string;
    readonly trendSource: ChartSource;
    readonly valueAxisLabel?: string;
    readonly slaLineLabel?: string;
    readonly pctAxisLabel?: string;
    readonly items: HeadlineItems;
  }): ReactElement => (
    <Headline
      title={config.title}
      window7d={config.windows.window7d}
      window14d={config.windows.window14d}
      window30d={config.windows.window30d}
      slaHours={config.sla}
      items={config.items}
      now={now}
      {...(config.description === undefined ? {} : { description: config.description })}
      {...(config.unit === undefined ? {} : { unit: config.unit })}
      {...(config.slaLabel === undefined ? {} : { slaLabel: config.slaLabel })}
      countLabel={config.countLabel ?? 'land'}
      collapsible
      defaultOpen={hasAnyData(config.windows)}
    >
      <Trendline
        title={config.trendTitle}
        history={history}
        source={config.trendSource}
        slaHours={config.trendSla === undefined ? config.sla : config.trendSla}
        {...(config.valueAxisLabel === undefined ? {} : { valueAxisLabel: config.valueAxisLabel })}
        {...(config.slaLineLabel === undefined ? {} : { slaLineLabel: config.slaLineLabel })}
        {...(config.pctAxisLabel === undefined ? {} : { pctAxisLabel: config.pctAxisLabel })}
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
      {metricPanel({
        title: 'Phabricator · Creation to merge',
        windows: phabCycle,
        sla: CYCLE_SLA_HOURS,
        trendTitle: 'Cycle-time trend (Phab)',
        trendSource: 'phabCycle',
        items: { kind: 'cycle', items: phabLandings },
      })}
      {metricPanel({
        title: 'Phabricator · First-review to merge',
        windows: phabPostReview,
        sla: POST_REVIEW_SLA_HOURS,
        trendTitle: 'Post-review trend (Phab)',
        trendSource: 'phabPostReview',
        items: { kind: 'postReview', items: phabLandings },
      })}
      {metricPanel({
        title: 'Phabricator · Review rounds',
        windows: phabRounds,
        sla: ROUNDS_SLA,
        unit: 'rounds',
        slaLabel: 'One-shot',
        trendTitle: 'Rounds trend (Phab)',
        trendSource: 'phabRounds',
        valueAxisLabel: 'rounds',
        slaLineLabel: 'one-shot',
        items: { kind: 'rounds', items: phabLandings },
      })}
      {hasBugzilla
        ? metricPanel({
            title: 'Bugzilla · Filed to fixed',
            description: bugFixDescription,
            windows: bugFix,
            sla: FIXED_WITHIN_DAYS,
            // No goal line: the stat cards report "% fixed within 7 days", but
            // the team has set no filed-to-fixed target, so drawing a dashed
            // line at 7 days on the chart would invent one.
            trendSla: null,
            unit: 'days',
            slaLabel: `Fixed \u2264 ${FIXED_WITHIN_DAYS.toString()}d`,
            countLabel: 'bug',
            trendTitle: 'Bug fix-time trend',
            trendSource: 'bugFix',
            valueAxisLabel: 'days',
            pctAxisLabel: `% \u2264 ${FIXED_WITHIN_DAYS.toString()}d`,
            items: { kind: 'bugFix', items: bugs },
          })
        : null}
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
      {metricPanel({
        title: 'GitHub · Creation to merge',
        windows: ghCycle,
        sla: CYCLE_SLA_HOURS,
        trendTitle: 'Cycle-time trend (GH)',
        trendSource: 'githubCycle',
        items: { kind: 'cycle', items: githubLandings },
      })}
      {metricPanel({
        title: 'GitHub · First-review to merge',
        windows: ghPostReview,
        sla: POST_REVIEW_SLA_HOURS,
        trendTitle: 'Post-review trend (GH)',
        trendSource: 'githubPostReview',
        items: { kind: 'postReview', items: githubLandings },
      })}
      {metricPanel({
        title: 'GitHub · Review rounds',
        windows: ghRounds,
        sla: ROUNDS_SLA,
        unit: 'rounds',
        slaLabel: 'One-shot',
        trendTitle: 'Rounds trend (GH)',
        trendSource: 'githubRounds',
        valueAxisLabel: 'rounds',
        slaLineLabel: 'one-shot',
        items: { kind: 'rounds', items: githubLandings },
      })}
    </div>
  );

  // A tab is "red" only when its 7-day review-TAT median exceeds the SLA.
  // Narrower than the previous "any bad-tier stat anywhere" rule: the stat
  // cards still tint themselves for warn/bad in the secondary metrics and
  // longer windows; the tab-level signal stays tied to the headline metric.
  const phabHasRedIssue = window7dMedianOverSla(latest.phab, slaHours);
  const githubHasRedIssue = window7dMedianOverSla(latest.github, slaHours);

  // Two-platform groups label their tabs from the group config (falling back
  // to Home-NewTab's "Frontend/Backend Team" framing). Phabricator-only groups
  // show a single plainly-labelled Phabricator tab and no GitHub tab at all.
  const phabTab: TabItem = {
    id: 'phab',
    label: hasGithub ? (group.phabTabLabel ?? 'Frontend Team (Phabricator)') : 'Phabricator',
    hasRedIssue: phabHasRedIssue,
    content: phabContent,
  };
  const tabs: TabItem[] = hasGithub
    ? [
        phabTab,
        {
          id: 'github',
          label: group.githubTabLabel ?? 'Backend Team (GitHub)',
          hasRedIssue: githubHasRedIssue,
          content: githubContent,
        },
      ]
    : [phabTab];
  return <Tabs tabs={tabs} />;
};
