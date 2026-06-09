import path from 'node:path';

import { GITHUB_OWNER, GITHUB_REPO, PHAB_ORIGIN } from './config';
import { asGroupId, type GroupId } from './types/brand';

// A single review group the dashboard can track. Data for distinct groups is
// never merged: each group owns a `data/<id>/` directory and renders at its
// own URL. New groups are Phabricator-only; only Home-NewTab also pulls
// GitHub (the Pocket content-monorepo).
export interface GroupConfig {
  readonly id: GroupId;
  // Short display name used in the dropdown and metadata titles.
  readonly label: string;
  // Page heading, e.g. "HNT Review Turnaround".
  readonly title: string;
  // The lede under the heading describing what this group measures.
  readonly description: string;
  // Phabricator project slugs whose members form the reviewer roster.
  readonly phabProjectSlugs: readonly string[];
  // Link target for the primary project tag.
  readonly phabProjectUrl: string;
  // Present only for groups that also review on GitHub.
  readonly github?: { readonly owner: string; readonly repo: string };
}

const phabProjectUrl = (slug: string): string => `${PHAB_ORIGIN}/tag/${slug}/`;

const phabOnlyDescription = (label: string): string =>
  `How long the ${label} team takes to give first feedback on Phabricator code reviews, ` +
  `measured from the moment a reviewer is requested to their first accept, comment, or ` +
  `request-changes. Clock is in business hours only (Mon–Fri 9am–5pm in each reviewer's ` +
  `local timezone).`;

const HOME_NEWTAB: GroupConfig = {
  id: asGroupId('home-newtab'),
  label: 'HNT',
  title: 'HNT Review Turnaround',
  description:
    'How long the Home-NewTab team takes to give first feedback on code reviews, measured ' +
    'from the moment a reviewer is requested to their first accept, comment, or ' +
    "request-changes. Clock is in business hours only (Mon–Fri 9am–5pm in each reviewer's " +
    'local timezone).',
  phabProjectSlugs: ['home-newtab-reviewers'],
  phabProjectUrl: phabProjectUrl('home-newtab-reviewers'),
  github: { owner: GITHUB_OWNER, repo: GITHUB_REPO },
};

export const ALL_GROUPS: readonly GroupConfig[] = [
  HOME_NEWTAB,
  {
    id: asGroupId('ip-protection'),
    label: 'IP Protection',
    title: 'IP Protection Review Turnaround',
    description: phabOnlyDescription('IP Protection'),
    phabProjectSlugs: ['ip-protection-reviewers'],
    phabProjectUrl: phabProjectUrl('ip-protection-reviewers'),
  },
  {
    id: asGroupId('desktop-theme'),
    label: 'Desktop Theme',
    title: 'Desktop Theme Review Turnaround',
    description: phabOnlyDescription('Desktop Theme'),
    phabProjectSlugs: ['desktop-theme-reviewers'],
    phabProjectUrl: phabProjectUrl('desktop-theme-reviewers'),
  },
  {
    id: asGroupId('sharing'),
    label: 'Sharing',
    title: 'Sharing Review Turnaround',
    description: phabOnlyDescription('Sharing'),
    phabProjectSlugs: ['sharing-reviewers'],
    phabProjectUrl: phabProjectUrl('sharing-reviewers'),
  },
];

export const DEFAULT_GROUP_ID: GroupId = HOME_NEWTAB.id;

export const allGroups = (): readonly GroupConfig[] => ALL_GROUPS;

export const getGroup = (id: string): GroupConfig | undefined =>
  ALL_GROUPS.find((group) => group.id === id);

export const defaultGroup = (): GroupConfig => HOME_NEWTAB;

// Per-group data directory. `runCollectionFromDisk` and the page loaders both
// key every JSON path off this so a group's samples/history never leak into
// another's.
export const dataDirectoryForGroup = (id: GroupId): string => path.join(process.cwd(), 'data', id);
