import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PHAB_ORIGIN } from './config';
import {
  allGroups,
  dataDirectoryForGroup,
  defaultGroup,
  DEFAULT_GROUP_ID,
  getGroup,
} from './groups';

describe('group registry', () => {
  it('tracks exactly the seven known groups', () => {
    expect(allGroups().map((group) => group.id)).toEqual([
      'home-newtab',
      'ip-protection',
      'desktop-theme',
      'sharing',
      'geckoview',
      'credential-management',
      'ai-platform',
    ]);
  });

  it('defaults to home-newtab', () => {
    expect(DEFAULT_GROUP_ID).toBe('home-newtab');
    expect(defaultGroup().id).toBe('home-newtab');
  });

  it('gives the default group a Phab slug and two GitHub repos', () => {
    const group = defaultGroup();
    expect(group.phabProjectSlugs).toEqual(['home-newtab-reviewers']);
    expect(group.github).toEqual([
      { owner: 'Pocket', repo: 'content-monorepo' },
      {
        owner: 'mozilla-services',
        repo: 'merino-py',
        authorLogins: ['jpetto', 'mmiermans', 'Herraj'],
        gateReviewersByRoster: false,
      },
    ]);
  });

  it('marks the new groups as Phabricator-only (no GitHub repo)', () => {
    for (const id of [
      'ip-protection',
      'desktop-theme',
      'sharing',
      'geckoview',
      'credential-management',
    ] as const) {
      const group = getGroup(id);
      expect(group).toBeDefined();
      expect(group?.github).toBeUndefined();
    }
  });

  it('maps each group to its reviewers project slug', () => {
    expect(getGroup('ip-protection')?.phabProjectSlugs).toEqual(['ip-protection-reviewers']);
    expect(getGroup('desktop-theme')?.phabProjectSlugs).toEqual(['desktop-theme-reviewers']);
    expect(getGroup('sharing')?.phabProjectSlugs).toEqual(['sharing-reviewers']);
    expect(getGroup('geckoview')?.phabProjectSlugs).toEqual(['geckoview-reviewers']);
    expect(getGroup('credential-management')?.phabProjectSlugs).toEqual([
      'credential-management-reviewers',
    ]);
    expect(getGroup('ai-platform')?.phabProjectSlugs).toEqual(['ai-platform-reviewers']);
  });

  it('tracks AI Platform across both Phabricator and the Firefox-AI/MLPA repo', () => {
    const group = getGroup('ai-platform');
    expect(group).toBeDefined();
    expect(group?.label).toBe('AI Platform and Experience');
    expect(group?.github).toEqual([{ owner: 'Firefox-AI', repo: 'MLPA' }]);
    expect(group?.phabTabLabel).toBe('AI Platform (Phabricator)');
    expect(group?.githubTabLabel).toBe('MLPA (GitHub)');
  });

  it('derives the Phabricator project URL from the origin and first slug', () => {
    expect(getGroup('sharing')?.phabProjectUrl).toBe(`${PHAB_ORIGIN}/tag/sharing-reviewers/`);
  });

  it('returns undefined for an unknown group id', () => {
    expect(getGroup('nope')).toBeUndefined();
    expect(getGroup('')).toBeUndefined();
  });

  it('places each group data dir under data/<id>', () => {
    expect(dataDirectoryForGroup(defaultGroup().id)).toBe(
      path.join(process.cwd(), 'data', 'home-newtab'),
    );
  });
});
