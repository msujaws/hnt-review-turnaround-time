import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PendingSample } from '../scripts/collect';
import { EMPTY_PEOPLE_MAP, type PeopleMap } from '../scripts/people';
import {
  asIanaTimezone,
  asIsoTimestamp,
  asPrNumber,
  asReviewerLogin,
  asRevisionPhid,
} from '../types/brand';

import { isOverduePending, OverdueCallout } from './OverdueCallout';

// Helper: a pending sample waiting roughly `businessDays` business days (ET).
// Treats the "requestedAt" as start of business hours on the relevant weekday,
// and `now` as end of business hours on a later weekday.
const pendingGh = (overrides: Partial<PendingSample> & { source?: 'github' } = {}): PendingSample =>
  ({
    source: 'github',
    id: asPrNumber(42),
    reviewer: asReviewerLogin('alice'),
    requestedAt: asIsoTimestamp('2026-04-13T13:00:00Z'),
    ...overrides,
  }) as PendingSample;

const pendingPhab = (overrides: Partial<PendingSample> & { source?: 'phab' } = {}): PendingSample =>
  ({
    source: 'phab',
    id: asRevisionPhid('PHID-DREV-abcdefghijklmnopqrst'),
    revisionId: 1234,
    reviewer: asReviewerLogin('bob'),
    requestedAt: asIsoTimestamp('2026-04-13T13:00:00Z'),
    ...overrides,
  }) as PendingSample;

describe('isOverduePending', () => {
  it('returns true when business hours waiting meet or exceed 10x the SLA', () => {
    // Mon 2026-04-13 13:00 UTC = Mon 09:00 ET. Now = Fri 2026-04-17 21:00 UTC
    // = Fri 17:00 ET. That's exactly 5 business days × 8 hours = 40 hours.
    const sample = pendingGh();
    const now = new Date('2026-04-17T21:00:00Z');
    expect(isOverduePending(sample, now, EMPTY_PEOPLE_MAP, 4)).toBe(true);
  });

  it('returns false when business hours waiting are below 10x the SLA', () => {
    const sample = pendingGh({
      requestedAt: asIsoTimestamp('2026-04-20T13:00:00Z'), // Mon 09:00 ET
    });
    const now = new Date('2026-04-21T15:00:00Z'); // Tue 11:00 ET → 10h waiting
    expect(isOverduePending(sample, now, EMPTY_PEOPLE_MAP, 4)).toBe(false);
  });

  it('returns false for an acceptedByTeam pending entry even when its age is over 10x the SLA', () => {
    // The team has accepted; the revision is still in needs-review because
    // an external reviewer is blocking. We don't want to alarm the team's
    // page about a wait they've already discharged — Backlog surfaces these
    // in a deprioritized sub-list instead.
    const sample = pendingPhab({ acceptedByTeam: true });
    const now = new Date('2026-04-17T21:00:00Z'); // 40h since Mon 09:00 ET
    expect(isOverduePending(sample, now, EMPTY_PEOPLE_MAP, 4)).toBe(false);
  });

  it('uses the reviewer timezone from the people map', () => {
    // A Melbourne reviewer: the same UTC window maps to different business
    // hours in Melbourne vs ET. Anchor the test on ET being inside off-hours.
    const peopleMap: PeopleMap = {
      github: { 'mel-reviewer': asIanaTimezone('Australia/Melbourne') },
      phab: {},
    };
    const sample = pendingGh({
      reviewer: asReviewerLogin('mel-reviewer'),
      requestedAt: asIsoTimestamp('2026-04-19T23:00:00Z'), // Mon 09:00 Melbourne
    });
    // Fri 07:00 UTC = Fri 17:00 Melbourne → exactly 40 business hours.
    const now = new Date('2026-04-24T07:00:00Z');
    expect(isOverduePending(sample, now, peopleMap, 4)).toBe(true);
  });
});

describe('OverdueCallout', () => {
  it('renders nothing when there are no overdue items', () => {
    const { container } = render(
      <OverdueCallout
        pending={[]}
        now={new Date('2026-04-21T12:00:00Z')}
        slaHours={4}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when no pending item has waited 40+ business hours', () => {
    const pending = [
      pendingGh({
        requestedAt: asIsoTimestamp('2026-04-20T13:00:00Z'), // Mon 09:00 ET
      }),
    ];
    const { container } = render(
      <OverdueCallout
        pending={pending}
        now={new Date('2026-04-21T15:00:00Z')} // Tue 11:00 ET → 10h
        slaHours={4}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders overdue rows with review link, reviewer, and hours waiting', () => {
    const pending = [pendingGh()];
    render(
      <OverdueCallout
        pending={pending}
        now={new Date('2026-04-17T21:00:00Z')} // Fri 17:00 ET → 40h since Mon 09:00
        slaHours={4}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    const region = screen.getByRole('region', { name: /overdue/i });
    expect(region).toBeInTheDocument();
    const link = within(region).getByRole('link', { name: /#42/ });
    expect(link).toHaveAttribute('href', 'https://github.com/Pocket/content-monorepo/pull/42');
    expect(within(region).getByText('alice')).toBeInTheDocument();
    expect(within(region).getByText(/40\.0h/)).toBeInTheDocument();
  });

  it('links Phabricator items using the human-readable revision id', () => {
    const pending = [pendingPhab({ revisionId: 999, reviewer: asReviewerLogin('bob') })];
    render(
      <OverdueCallout
        pending={pending}
        now={new Date('2026-04-17T21:00:00Z')}
        slaHours={4}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    const link = screen.getByRole('link', { name: /D999/ });
    expect(link).toHaveAttribute('href', 'https://phabricator.services.mozilla.com/D999');
  });

  it('sorts overdue items oldest-first (longest wait at the top)', () => {
    const pending: PendingSample[] = [
      pendingGh({
        id: asPrNumber(1),
        reviewer: asReviewerLogin('younger'),
        requestedAt: asIsoTimestamp('2026-04-14T13:00:00Z'), // Tue 09:00 ET
      }),
      pendingGh({
        id: asPrNumber(2),
        reviewer: asReviewerLogin('older'),
        requestedAt: asIsoTimestamp('2026-04-13T13:00:00Z'), // Mon 09:00 ET
      }),
    ];
    render(
      <OverdueCallout
        pending={pending}
        now={new Date('2026-04-20T21:00:00Z')} // Mon 17:00 ET — both > 40h
        slaHours={4}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    const rows = screen.getAllByTestId('overdue-row');
    expect(within(rows[0]!).getByText('older')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('younger')).toBeInTheDocument();
  });

  it('includes a visible count of overdue items in the heading', () => {
    const pending: PendingSample[] = [
      pendingGh({ id: asPrNumber(1), reviewer: asReviewerLogin('a') }),
      pendingGh({ id: asPrNumber(2), reviewer: asReviewerLogin('b') }),
      pendingGh({ id: asPrNumber(3), reviewer: asReviewerLogin('c') }),
    ];
    render(
      <OverdueCallout
        pending={pending}
        now={new Date('2026-04-17T21:00:00Z')}
        slaHours={4}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    const heading = screen.getByRole('heading', { name: /overdue/i });
    expect(heading).toHaveTextContent('3');
  });

  it('renders the patch author in a dedicated column', () => {
    const pending = [pendingGh({ author: asReviewerLogin('connie') })];
    render(
      <OverdueCallout
        pending={pending}
        now={new Date('2026-04-17T21:00:00Z')}
        slaHours={4}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    const region = screen.getByRole('region', { name: /overdue/i });
    expect(within(region).getByRole('columnheader', { name: /author/i })).toBeInTheDocument();
    expect(within(region).getByText('connie')).toBeInTheDocument();
  });

  it('renders a Source column by default (multi-source group)', () => {
    const pending = [pendingPhab()];
    render(
      <OverdueCallout
        pending={pending}
        now={new Date('2026-04-17T21:00:00Z')}
        slaHours={4}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    const region = screen.getByRole('region', { name: /overdue/i });
    expect(within(region).getByRole('columnheader', { name: /source/i })).toBeInTheDocument();
    expect(within(region).getByText('Phab')).toBeInTheDocument();
  });

  it('omits the Source column when the group has no GitHub setup', () => {
    const pending = [pendingPhab()];
    render(
      <OverdueCallout
        pending={pending}
        now={new Date('2026-04-17T21:00:00Z')}
        slaHours={4}
        peopleMap={EMPTY_PEOPLE_MAP}
        hasGithub={false}
      />,
    );
    const region = screen.getByRole('region', { name: /overdue/i });
    // No Source column header, and no per-row source badge.
    expect(within(region).queryByRole('columnheader', { name: /source/i })).toBeNull();
    expect(within(region).queryByText('Phab')).toBeNull();
    // The remaining columns still render.
    expect(within(region).getByRole('columnheader', { name: /^review$/i })).toBeInTheDocument();
    expect(within(region).getByRole('columnheader', { name: /author/i })).toBeInTheDocument();
    expect(within(region).getByText('bob')).toBeInTheDocument();
  });

  it('applies a soft-pulse animation to the warning icon', () => {
    const pending = [pendingGh()];
    render(
      <OverdueCallout
        pending={pending}
        now={new Date('2026-04-17T21:00:00Z')}
        slaHours={4}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    const region = screen.getByRole('region', { name: /overdue/i });
    const icon = region.querySelector('.material-symbols-outlined');
    expect(icon?.className).toMatch(/animate-soft-pulse/);
  });

  it('animates the section mount with pop-in', () => {
    const pending = [pendingGh()];
    render(
      <OverdueCallout
        pending={pending}
        now={new Date('2026-04-17T21:00:00Z')}
        slaHours={4}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    const region = screen.getByRole('region', { name: /overdue/i });
    expect(region.className).toMatch(/animate-pop-in/);
  });

  it('excludes acceptedByTeam pending entries from the red banner', () => {
    // Two old pending entries: one regular, one acceptedByTeam. Only the
    // regular one should appear in the table.
    const pending: PendingSample[] = [
      pendingPhab({
        id: asRevisionPhid('PHID-DREV-regulaaaaaaaaaaaaaaa'),
        revisionId: 100,
        reviewer: asReviewerLogin('home-newtab-reviewers'),
      }),
      pendingPhab({
        id: asRevisionPhid('PHID-DREV-acceptaaaaaaaaaaaaaa'),
        revisionId: 200,
        reviewer: asReviewerLogin('home-newtab-reviewers'),
        acceptedByTeam: true,
      }),
    ];
    render(
      <OverdueCallout
        pending={pending}
        now={new Date('2026-04-17T21:00:00Z')} // both > 40h
        slaHours={4}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    const region = screen.getByRole('region', { name: /overdue/i });
    expect(within(region).getByText(/D100/)).toBeInTheDocument();
    expect(within(region).queryByText(/D200/)).toBeNull();
    const heading = within(region).getByRole('heading', { name: /overdue/i });
    expect(heading).toHaveTextContent('1');
  });

  it('renders nothing when the only overdue entries are acceptedByTeam', () => {
    const pending: PendingSample[] = [
      pendingPhab({ acceptedByTeam: true }),
      pendingPhab({
        id: asRevisionPhid('PHID-DREV-acceptbbbbbbbbbbbbbb'),
        revisionId: 300,
        acceptedByTeam: true,
      }),
    ];
    const { container } = render(
      <OverdueCallout
        pending={pending}
        now={new Date('2026-04-17T21:00:00Z')}
        slaHours={4}
        peopleMap={EMPTY_PEOPLE_MAP}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
