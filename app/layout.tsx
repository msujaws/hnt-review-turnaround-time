import type { Metadata } from 'next';
import type { FC, ReactNode } from 'react';

import './globals.css';

// Static site-wide fallback only. Per-group, data-driven titles/descriptions
// (the ones Slack unfurls) are generated at the page level — app/page.tsx for
// the default group and app/g/[group]/page.tsx for the rest — because a layout
// can't see route params.
export const metadata: Metadata = {
  title: 'Review Turnaround',
  description: 'Code-review turnaround time across Firefox review groups.',
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
