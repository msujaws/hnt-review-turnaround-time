import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Tabs, type TabItem } from './Tabs';

const tabs: readonly TabItem[] = [
  {
    id: 'phab',
    label: 'Phabricator',
    hasRedIssue: false,
    content: <div>phab content</div>,
  },
  {
    id: 'github',
    label: 'GitHub',
    hasRedIssue: true,
    content: <div>github content</div>,
  },
];

describe('Tabs', () => {
  it('renders one tab button per item', () => {
    render(<Tabs tabs={tabs} />);
    expect(screen.getByRole('tab', { name: /phabricator/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /github/i })).toBeInTheDocument();
  });

  it('shows only the first tab content by default', () => {
    render(<Tabs tabs={tabs} />);
    expect(screen.getByText(/phab content/i)).toBeInTheDocument();
    expect(screen.queryByText(/github content/i)).toBeNull();
  });

  it('switches content when another tab is clicked', async () => {
    const user = userEvent.setup();
    render(<Tabs tabs={tabs} />);
    await user.click(screen.getByRole('tab', { name: /github/i }));
    expect(screen.getByText(/github content/i)).toBeInTheDocument();
    expect(screen.queryByText(/phab content/i)).toBeNull();
  });

  it('exposes hasRedIssue via data-red-issue attribute on each tab button', () => {
    render(<Tabs tabs={tabs} />);
    expect(screen.getByRole('tab', { name: /phabricator/i })).toHaveAttribute(
      'data-red-issue',
      'false',
    );
    expect(screen.getByRole('tab', { name: /github/i })).toHaveAttribute('data-red-issue', 'true');
  });

  it('applies a rose class on the red-issue tab', () => {
    render(<Tabs tabs={tabs} />);
    const redTab = screen.getByRole('tab', { name: /github/i });
    const safeTab = screen.getByRole('tab', { name: /phabricator/i });
    expect(redTab.className).toMatch(/rose/);
    expect(safeTab.className).not.toMatch(/rose/);
  });

  it('marks the active tab via aria-selected', async () => {
    const user = userEvent.setup();
    render(<Tabs tabs={tabs} />);
    expect(screen.getByRole('tab', { name: /phabricator/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(screen.getByRole('tab', { name: /github/i }));
    expect(screen.getByRole('tab', { name: /github/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /phabricator/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('honors defaultTabId to pick the initial tab', () => {
    render(<Tabs tabs={tabs} defaultTabId="github" />);
    expect(screen.getByText(/github content/i)).toBeInTheDocument();
    expect(screen.queryByText(/phab content/i)).toBeNull();
  });

  it('renders nothing when the tabs array is empty', () => {
    const { container } = render(<Tabs tabs={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
