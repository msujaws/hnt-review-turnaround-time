import Image from 'next/image';
import type { FC } from 'react';

import { Footer } from '../src/ui/Footer';

import { Dashboard } from './Dashboard';
import { loadHistory } from './history';
import { loadSamples } from './samples';

const SLA_HOURS = 4;

export const revalidate = 3600;

const Page: FC = async () => {
  const [history, samples] = await Promise.all([loadHistory(), loadSamples()]);
  const latest = history.at(-1);
  const now = new Date();
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="flex items-center gap-4">
        <Image
          src="/hnt-logo.webp"
          alt=""
          width={1022}
          height={842}
          priority
          className="h-20 w-auto"
        />
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-neutral-100">HNT Review Turnaround</h1>
          <p className="text-sm text-neutral-400">
            Time from review request to first reviewer action, in business hours (Mon&ndash;Fri
            9am&ndash;5pm ET). Goal: {SLA_HOURS}h.
            {latest === undefined ? '' : ` Last snapshot: ${latest.date}.`}
          </p>
        </div>
      </header>
      <Dashboard history={history} samples={samples} slaHours={SLA_HOURS} now={now} />
      <Footer />
    </main>
  );
};

export default Page;
