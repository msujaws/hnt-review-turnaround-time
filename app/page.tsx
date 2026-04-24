import path from 'node:path';

import { DateTime } from 'luxon';
import Image from 'next/image';
import type { FC } from 'react';

import { ET_ZONE, SLA_HOURS } from '../src/config';
import { loadPeopleMap } from '../src/scripts/people';
import { Backlog } from '../src/ui/Backlog';
import { Footer } from '../src/ui/Footer';
import { isOverduePending, OverdueCallout } from '../src/ui/OverdueCallout';

import { loadBacklog } from './backlog';
import { Dashboard } from './Dashboard';
import { loadHistory } from './history';
import { loadLandings } from './landings';
import { loadPending } from './pending';
import { loadSamples } from './samples';

export const revalidate = 3600;

const Page: FC = async () => {
  const [history, samples, landings, pending, backlog, peopleMap] = await Promise.all([
    loadHistory(),
    loadSamples(),
    loadLandings(),
    loadPending(),
    loadBacklog(),
    loadPeopleMap(path.join(process.cwd(), 'data')),
  ]);
  const latest = history.at(-1);
  // Anchor sample-list filtering on the latest snapshot's ET day so stats.n
  // (captured when the cron ran) agrees with what the expanded row renders.
  const dashboardNow =
    latest === undefined
      ? new Date()
      : DateTime.fromISO(latest.date, { zone: ET_ZONE }).endOf('day').toJSDate();
  // Overdue calc uses real now so "hours waiting" stays fresh between the
  // hourly revalidations (the cron only runs weekday mornings).
  const realNow = new Date();
  const hasOverdue = pending.some((s) => isOverduePending(s, realNow, peopleMap, SLA_HOURS));
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="flex items-start gap-4">
        <Image
          src="/hnt-logo.webp"
          alt=""
          width={819}
          height={824}
          priority
          className="size-60 object-contain"
        />
        <div className="flex flex-col gap-2 pt-3.5">
          <h1 className="text-2xl font-bold text-neutral-100">HNT Review Turnaround</h1>
          <p className="text-sm text-neutral-400">
            How long the Home-NewTab team takes to give first feedback on code reviews, measured
            from the moment a reviewer is requested to their first accept, comment, or
            request-changes. Clock is in business hours only (Mon&ndash;Fri 9am&ndash;5pm in each
            reviewer&apos;s local timezone). Goal: {SLA_HOURS}h per review.
          </p>
          <p className="text-sm text-neutral-400">
            Each tile shows median, mean, p90, and the percentage of reviews under the {SLA_HOURS}h
            SLA for rolling 7-, 14-, and 30-day windows. Tiles are tinted{' '}
            <span className="text-emerald-300">green</span> when well inside target,{' '}
            <span className="text-amber-300">amber</span> when slipping, and{' '}
            <span className="text-rose-300">rose</span> when well over &mdash; expand a row to see
            the individual reviews behind it. The callout at the top surfaces pending reviews that
            have been waiting 10&times; the SLA or longer
            {hasOverdue ? '' : ' (not showing right now since there are no outliers)'}.
          </p>
          {latest === undefined ? null : (
            <p className="text-xs italic text-neutral-500">Last snapshot: {latest.date}.</p>
          )}
        </div>
      </header>
      <OverdueCallout pending={pending} now={realNow} slaHours={SLA_HOURS} peopleMap={peopleMap} />
      <Backlog snapshots={backlog} />
      <Dashboard
        history={history}
        samples={samples}
        landings={landings}
        slaHours={SLA_HOURS}
        now={dashboardNow}
        peopleMap={peopleMap}
      />
      <Footer />
    </main>
  );
};

export default Page;
