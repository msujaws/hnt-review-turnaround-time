import path from 'node:path';

import { DateTime } from 'luxon';
import Image from 'next/image';
import type { FC } from 'react';

import { loadPeopleMap } from '../src/scripts/people';
import { Footer } from '../src/ui/Footer';
import { OverdueCallout } from '../src/ui/OverdueCallout';

import { Dashboard } from './Dashboard';
import { loadHistory } from './history';
import { loadPending } from './pending';
import { loadSamples } from './samples';

const SLA_HOURS = 4;
const ET_ZONE = 'America/New_York';

export const revalidate = 3600;

const Page: FC = async () => {
  const [history, samples, pending, peopleMap] = await Promise.all([
    loadHistory(),
    loadSamples(),
    loadPending(),
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
        <div className="flex flex-col gap-1 pt-3.5">
          <h1 className="text-2xl font-bold text-neutral-100">HNT Review Turnaround</h1>
          <p className="text-sm text-neutral-400">
            Time from review request to first reviewer action, in business hours (Mon&ndash;Fri
            9am&ndash;5pm ET). Goal: {SLA_HOURS}h.
            {latest === undefined ? '' : ` Last snapshot: ${latest.date}.`}
          </p>
        </div>
      </header>
      <OverdueCallout pending={pending} now={realNow} slaHours={SLA_HOURS} peopleMap={peopleMap} />
      <Dashboard history={history} samples={samples} slaHours={SLA_HOURS} now={dashboardNow} />
      <Footer />
    </main>
  );
};

export default Page;
