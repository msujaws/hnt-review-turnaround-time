import type { FC } from 'react';

import { Footer } from '../src/ui/Footer';

import { Dashboard } from './Dashboard';
import { loadHistory } from './history';

const SLA_HOURS = 4;

export const revalidate = 3600;

const Page: FC = async () => {
  const history = await loadHistory();
  const latest = history.at(-1);
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-neutral-100">HNT Review Turnaround</h1>
        <p className="text-sm text-neutral-400">
          Time from review request to first reviewer action, in business hours (Mon&ndash;Fri
          9am&ndash;5pm ET). Goal: {SLA_HOURS}h.
          {latest === undefined ? '' : ` Last snapshot: ${latest.date}.`}
        </p>
      </header>
      <Dashboard history={history} slaHours={SLA_HOURS} />
      <Footer />
    </main>
  );
};

export default Page;
