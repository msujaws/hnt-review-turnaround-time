import path from 'node:path';

import type { Metadata } from 'next';
import type { FC, ReactNode } from 'react';

import { loadPeopleMap } from '../src/scripts/people';

import './globals.css';
import { loadHistory } from './history';
import { buildMetadataSummary } from './metadata';
import { loadPending } from './pending';

const SLA_HOURS = 4;

export const generateMetadata = async (): Promise<Metadata> => {
  const [history, pending, peopleMap] = await Promise.all([
    loadHistory(),
    loadPending(),
    loadPeopleMap(path.join(process.cwd(), 'data')),
  ]);
  const summary = buildMetadataSummary(history, SLA_HOURS, {
    pending,
    now: new Date(),
    peopleMap,
  });
  return {
    title: summary.title,
    description: summary.description,
    openGraph: {
      title: summary.title,
      description: summary.description,
    },
    twitter: {
      card: 'summary',
      title: summary.title,
      description: summary.description,
    },
  };
};

interface RootLayoutProps {
  readonly children: ReactNode;
}

const RootLayout: FC<RootLayoutProps> = ({ children }) => (
  <html lang="en" className="dark">
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Mozilla+Headline:wght@400;600;700&family=Mozilla+Text:wght@400;500;600;700&display=swap"
      />
    </head>
    <body className="min-h-screen bg-neutral-950 font-sans text-neutral-100 antialiased">
      {children}
    </body>
  </html>
);

export default RootLayout;
