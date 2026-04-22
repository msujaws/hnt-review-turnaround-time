'use client';

import { useState, type FC, type ReactNode } from 'react';

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly hasRedIssue: boolean;
  readonly content: ReactNode;
}

export interface TabsProps {
  readonly tabs: readonly TabItem[];
  // Which tab to activate on first render. Defaults to the first tab. Any
  // unknown id also falls back to the first tab.
  readonly defaultTabId?: string;
}

const BASE_CLASSES =
  'rounded-t-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500';
// Red tabs win over the normal active/inactive styling so the signal is
// visible even while the user is on a different tab.
const RED_ACTIVE_CLASSES = 'bg-rose-500/30 text-rose-50 ring-1 ring-rose-400/60';
const RED_INACTIVE_CLASSES =
  'bg-rose-500/15 text-rose-200 hover:bg-rose-500/25 ring-1 ring-rose-400/30';
const SAFE_ACTIVE_CLASSES = 'bg-neutral-900 text-neutral-100 ring-1 ring-neutral-700';
const SAFE_INACTIVE_CLASSES = 'text-neutral-400 hover:bg-neutral-900/60 hover:text-neutral-200';

const classesFor = (hasRedIssue: boolean, isActive: boolean): string => {
  if (hasRedIssue) {
    return isActive ? RED_ACTIVE_CLASSES : RED_INACTIVE_CLASSES;
  }
  return isActive ? SAFE_ACTIVE_CLASSES : SAFE_INACTIVE_CLASSES;
};

export const Tabs: FC<TabsProps> = ({ tabs, defaultTabId }) => {
  const firstId = tabs[0]?.id;
  const [activeId, setActiveId] = useState<string>(defaultTabId ?? firstId ?? '');
  if (tabs.length === 0) return null;
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  // Unreachable given the length check, but narrows for TS.
  if (active === undefined) return null;
  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-neutral-800 pb-px">
        {tabs.map((tab) => {
          const isActive = tab.id === active.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-red-issue={tab.hasRedIssue ? 'true' : 'false'}
              onClick={() => {
                setActiveId(tab.id);
              }}
              className={`${BASE_CLASSES} ${classesFor(tab.hasRedIssue, isActive)}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{active.content}</div>
    </div>
  );
};
