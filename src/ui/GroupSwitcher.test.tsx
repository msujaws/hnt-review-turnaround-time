import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { GroupSwitcher } from './GroupSwitcher';

const groups = [
  { id: 'home-newtab', label: 'HNT' },
  { id: 'ip-protection', label: 'IP Protection' },
  { id: 'sharing', label: 'Sharing' },
];

describe('GroupSwitcher', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('renders every group as an option and selects the current one', () => {
    render(<GroupSwitcher groups={groups} currentId="ip-protection" defaultId="home-newtab" />);
    for (const group of groups) {
      expect(screen.getByRole('option', { name: group.label })).toBeInTheDocument();
    }
    expect(screen.getByRole('combobox')).toHaveValue('ip-protection');
  });

  it('navigates to the bare URL when the default group is chosen', async () => {
    const user = userEvent.setup();
    render(<GroupSwitcher groups={groups} currentId="ip-protection" defaultId="home-newtab" />);
    await user.selectOptions(screen.getByRole('combobox'), 'home-newtab');
    expect(push).toHaveBeenCalledWith('/');
  });

  it('navigates to /g/<id> when a non-default group is chosen', async () => {
    const user = userEvent.setup();
    render(<GroupSwitcher groups={groups} currentId="home-newtab" defaultId="home-newtab" />);
    await user.selectOptions(screen.getByRole('combobox'), 'sharing');
    expect(push).toHaveBeenCalledWith('/g/sharing');
  });
});
