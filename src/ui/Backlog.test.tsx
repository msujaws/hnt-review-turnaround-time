import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BacklogSnapshot } from '../scripts/collect';
import { asBusinessHours } from '../types/brand';

import { Backlog } from './Backlog';

const snapshot = (date: string, phabOpen: number, ghOpen: number): BacklogSnapshot => ({
  date,
  phab: {
    openCount: phabOpen,
    oldestBusinessHours: asBusinessHours(phabOpen * 2),
    p90BusinessHours: asBusinessHours(phabOpen * 1.5),
  },
  github: {
    openCount: ghOpen,
    oldestBusinessHours: asBusinessHours(ghOpen * 2),
    p90BusinessHours: asBusinessHours(ghOpen * 1.5),
  },
});

describe('Backlog', () => {
  it('renders the current open count for each source', () => {
    render(<Backlog snapshots={[snapshot('2026-04-22', 3, 5)]} />);
    expect(screen.getByText(/phab/i)).toBeInTheDocument();
    expect(screen.getByText(/github/i)).toBeInTheDocument();
    expect(screen.getByText(/3 open/i)).toBeInTheDocument();
    expect(screen.getByText(/5 open/i)).toBeInTheDocument();
  });

  it('renders the oldest business-hours age', () => {
    render(<Backlog snapshots={[snapshot('2026-04-22', 3, 0)]} />);
    // Phab oldest = 3 * 2 = 6h
    expect(screen.getByText(/oldest 6\.0h/i)).toBeInTheDocument();
  });

  it('renders a no-backlog state when both sources are empty', () => {
    render(<Backlog snapshots={[snapshot('2026-04-22', 0, 0)]} />);
    expect(screen.getAllByText(/no open reviews/i)).toHaveLength(2);
  });

  it('uses the latest snapshot for current numbers when multiple are supplied', () => {
    render(<Backlog snapshots={[snapshot('2026-04-20', 10, 10), snapshot('2026-04-22', 2, 4)]} />);
    expect(screen.getByText(/2 open/i)).toBeInTheDocument();
    expect(screen.getByText(/4 open/i)).toBeInTheDocument();
    expect(screen.queryByText(/10 open/i)).toBeNull();
  });

  it('renders a placeholder when there are no snapshots at all', () => {
    render(<Backlog snapshots={[]} />);
    expect(screen.getByText(/no backlog snapshots yet/i)).toBeInTheDocument();
  });
});
