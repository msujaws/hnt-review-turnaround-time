import type { Metadata } from 'next';
import type { FC, ReactNode } from 'react';

import './globals.css';
import { loadHistory } from './history';
import { buildMetadataSummary } from './metadata';

const SLA_HOURS = 4;

export const generateMetadata = async (): Promise<Metadata> => {
  const history = await loadHistory();
  const summary = buildMetadataSummary(history, SLA_HOURS);
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
    <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">{children}</body>
  </html>
);

export default RootLayout;
