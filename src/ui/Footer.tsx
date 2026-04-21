import type { FC } from 'react';

const SOURCE_URL = 'https://github.com/msujaws/hnt-review-turnaround-time';

export const Footer: FC = () => (
  <footer className="mt-6 flex flex-col gap-1 border-t border-neutral-800 pt-6 text-sm text-neutral-400">
    <p>
      <a
        className="underline decoration-neutral-600 underline-offset-4 hover:text-neutral-200"
        href={SOURCE_URL}
        rel="noopener noreferrer"
        target="_blank"
      >
        Source on GitHub
      </a>
    </p>
    <p>Created by Jared Wein</p>
  </footer>
);
