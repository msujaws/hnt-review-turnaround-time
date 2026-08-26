import { describe, expect, it } from 'vitest';

import { ALL_GROUPS, allGroups, DEFAULT_GROUP_ID, defaultGroup, getGroup } from './groups';

describe('group registry', () => {
  it('exposes the default group at the bare route', () => {
    expect(defaultGroup().id).toBe(DEFAULT_GROUP_ID);
    expect(getGroup(DEFAULT_GROUP_ID)).toBe(defaultGroup());
  });

  it('returns undefined for an unknown id', () => {
    expect(getGroup('no-such-group')).toBeUndefined();
  });

  it('has unique group ids', () => {
    const ids = allGroups().map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Guards the hnt-content gating decision as much as the repo list: leaving
  // authorLogins/gateReviewersByRoster off is what keeps the roster gate on both
  // sides, and that gate is the only thing excluding hnt-content's
  // copilot-pull-request-reviewer reviews, whose login has no `[bot]` suffix for
  // isBot to catch.
  it('tracks three GitHub repos on the default group', () => {
    expect(defaultGroup().github).toEqual([
      { owner: 'Pocket', repo: 'content-monorepo' },
      { owner: 'mozilla', repo: 'hnt-content' },
      {
        owner: 'mozilla-services',
        repo: 'merino-py',
        authorLogins: ['jpetto', 'mmiermans', 'Herraj'],
        gateReviewersByRoster: false,
      },
    ]);
  });
});

describe('bugzilla scoping', () => {
  it('gives every group at least one bugzilla scope', () => {
    for (const group of ALL_GROUPS) {
      expect(group.bugzilla, `${group.id} has no bugzilla scope`).toBeDefined();
      expect((group.bugzilla ?? []).length).toBeGreaterThan(0);
    }
  });

  it('names a non-empty product on every scope', () => {
    for (const group of ALL_GROUPS) {
      for (const scope of group.bugzilla ?? []) {
        expect(scope.product.length).toBeGreaterThan(0);
      }
    }
  });

  // An empty array means "whole product", which is a very different query from
  // "these components". A scope that meant to name components but ended up with
  // [] would silently widen to the entire product, so require omission instead.
  it('omits components rather than passing an empty array', () => {
    for (const group of ALL_GROUPS) {
      for (const scope of group.bugzilla ?? []) {
        if (scope.components !== undefined) {
          expect(
            scope.components.length,
            `${group.id} has an empty components array`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it('scopes geckoview to the whole product, which is where its bugs live', () => {
    // GeckoView bugs spread across General, IME, Extensions and PDF Viewer, so
    // a hand-listed component set would undercount. Verified against BMO.
    const geckoview = getGroup('geckoview');
    expect(geckoview?.bugzilla).toEqual([{ product: 'GeckoView' }]);
  });

  it('scopes home-newtab to Firefox :: New Tab Page', () => {
    expect(getGroup('home-newtab')?.bugzilla).toEqual([
      { product: 'Firefox', components: ['New Tab Page'] },
    ]);
  });

  it('scopes ai-platform to every Core :: Machine Learning component', () => {
    const scopes = getGroup('ai-platform')?.bugzilla ?? [];
    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.product).toBe('Core');
    expect(scopes[0]?.components).toEqual([
      'Machine Learning: Frontend',
      'Machine Learning: General',
      'Machine Learning: Models',
      'Machine Learning: On Device',
      'Machine Learning: Server',
    ]);
  });

  it('scopes credential-management to the Toolkit password manager', () => {
    expect(getGroup('credential-management')?.bugzilla).toEqual([
      { product: 'Toolkit', components: ['Password Manager'] },
    ]);
  });
});
