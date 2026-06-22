'use client';

import { useRouter } from 'next/navigation';
import type { ChangeEvent, FC } from 'react';

import { asMaterialSymbolName, Icon } from './Icon';

export interface GroupOption {
  readonly id: string;
  readonly label: string;
}

export interface GroupSwitcherProps {
  readonly groups: readonly GroupOption[];
  readonly currentId: string;
  // The default group lives at the bare URL `/` (preserved for the existing
  // Slack post); every other group routes to `/g/<id>`.
  readonly defaultId: string;
}

export const GroupSwitcher: FC<GroupSwitcherProps> = ({ groups, currentId, defaultId }) => {
  const router = useRouter();
  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const id = event.target.value;
    router.push(id === defaultId ? '/' : `/g/${id}`);
  };
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-400">
      <span className="font-medium text-neutral-300">Review group</span>
      <span className="relative inline-flex items-center">
        <select
          value={currentId}
          onChange={onChange}
          className="appearance-none rounded-md border border-neutral-700 bg-neutral-900 py-1.5 pl-3 pr-9 text-neutral-100 hover:border-neutral-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        >
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.label}
            </option>
          ))}
        </select>
        <Icon
          name={asMaterialSymbolName('expand_more')}
          className="pointer-events-none absolute right-2 text-neutral-400"
        />
      </span>
    </label>
  );
};
