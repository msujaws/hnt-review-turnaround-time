import type { FC } from 'react';

import type { HistoryRow, Sample } from '../src/scripts/collect';
import type { PeopleMap } from '../src/scripts/people';
import { Headline } from '../src/ui/Headline';
import { Trendline } from '../src/ui/Trendline';

const GITHUB_REPO_OWNER = 'Pocket';
const GITHUB_REPO_NAME = 'content-monorepo';
const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`;
const GITHUB_REPO_LABEL = `${GITHUB_REPO_OWNER.toLowerCase()}/${GITHUB_REPO_NAME}`;

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
  const phabDescription =
    phabReviewers.length === 0 ? (
      <>
        Revisions on mozilla-central where a team member is a requested reviewer. Time is measured
        from the request until that reviewer first accepts, comments, or requests changes.
      </>
    ) : (
      <>
        Revisions on mozilla-central where one of the tracked reviewers (
        <span className="text-neutral-200">{formatReviewerList(phabReviewers)}</span>) is requested.
        Time is measured from the request until that reviewer first accepts, comments, or requests
        changes.
      </>
    );
  const githubDescription = (
    <>
      Pull requests in{' '}
      <a
        href={GITHUB_REPO_URL}
        className="text-sky-400 underline decoration-sky-700 underline-offset-4 hover:text-sky-300"
        rel="noopener noreferrer"
        target="_blank"
      >
        {GITHUB_REPO_LABEL}
      </a>{' '}
      where a team member is a requested reviewer. Time stops at that reviewer&apos;s first review
      or review comment.
    </>
  );
  return (
    <div className="flex flex-col gap-10">
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
        />
        <Trendline title="Phabricator trend" history={history} source="phab" slaHours={slaHours} />
      </div>
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
        />
        <Trendline title="GitHub trend" history={history} source="github" slaHours={slaHours} />
      </div>
    </div>
  );
};
