import path from 'node:path';

import { GITHUB_OWNER, GITHUB_REPO, PHAB_ORIGIN } from './config';
import { asGroupId, type GroupId } from './types/brand';

// One GitHub repository a group pulls review activity from. A group may track
// several repos, each with its own gating policy:
//   - `authorLogins` set  → keep only PRs authored by those logins. Absent →
//     gate authors by the group's people.json github roster (legacy behavior).
//   - `gateReviewersByRoster` (default true) → count only reviews by roster
//     members. Set false to count reviews by anyone (author-only scoping).
export interface GithubRepoConfig {
  readonly owner: string;
  readonly repo: string;
  readonly authorLogins?: readonly string[];
  readonly gateReviewersByRoster?: boolean;
}

// One slice of Bugzilla a group owns, for the bug filed-to-fixed metric.
// Scoped by product::component rather than derived from the group's Phabricator
// revisions: a revision's bug tag is incomplete (fixes land without one) and a
// single bug can span several revisions, so product::component is the stable,
// auditable scope. `components` omitted means the whole product.
//
// A component listed here must exist in BMO — assertScopeExists in
// src/scripts/bugzilla.ts checks it on every run, because BMO answers an
// unknown component with HTTP 200 and an empty bug list rather than an error.
export interface BugzillaScopeConfig {
  readonly product: string;
  readonly components?: readonly string[];
}

// A single review group the dashboard can track. Data for distinct groups is
// never merged: each group owns a `data/<id>/` directory and renders at its
// own URL. Most groups are Phabricator-only; Home-NewTab (Pocket
// content-monorepo + merino-py) and AI Platform and Experience (Firefox-AI/MLPA)
// also pull GitHub.
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
  // Present (and non-empty) only for groups that also review on GitHub.
  readonly github?: readonly GithubRepoConfig[];
  // Bugzilla scopes for the filed-to-fixed metric. Optional so a group can opt
  // out; every group currently sets it. Absent or empty means the group
  // collects no bugs and renders no bug panel.
  readonly bugzilla?: readonly BugzillaScopeConfig[];
  // Tab labels for the two-platform view. Only meaningful when `github` is set
  // (a Phab-only group shows a single plain "Phabricator" tab). Absent falls
  // back to Home-NewTab's "Frontend Team / Backend Team" framing.
  readonly phabTabLabel?: string;
  readonly githubTabLabel?: string;
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
  bugzilla: [{ product: 'Firefox', components: ['New Tab Page'] }],
  phabTabLabel: 'Frontend Team (Phabricator)',
  githubTabLabel: 'Backend Team (GitHub)',
  github: [
    // content-monorepo: gate by the people.json github roster on both sides.
    { owner: GITHUB_OWNER, repo: GITHUB_REPO },
    // merino-py: only the backend team's PRs, reviewed by anyone.
    {
      owner: 'mozilla-services',
      repo: 'merino-py',
      authorLogins: ['jpetto', 'mmiermans', 'Herraj'],
      gateReviewersByRoster: false,
    },
  ],
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
    bugzilla: [{ product: 'Firefox', components: ['IP Protection'] }],
  },
  {
    id: asGroupId('desktop-theme'),
    label: 'Desktop Theme',
    title: 'Desktop Theme Review Turnaround',
    description: phabOnlyDescription('Desktop Theme'),
    phabProjectSlugs: ['desktop-theme-reviewers'],
    phabProjectUrl: phabProjectUrl('desktop-theme-reviewers'),
    bugzilla: [{ product: 'Firefox', components: ['Theme'] }],
  },
  {
    id: asGroupId('sharing'),
    label: 'Sharing',
    title: 'Sharing Review Turnaround',
    description: phabOnlyDescription('Sharing'),
    phabProjectSlugs: ['sharing-reviewers'],
    phabProjectUrl: phabProjectUrl('sharing-reviewers'),
    bugzilla: [{ product: 'Firefox', components: ['Sharing'] }],
  },
  {
    id: asGroupId('geckoview'),
    label: 'GeckoView',
    title: 'GeckoView Review Turnaround',
    description: phabOnlyDescription('GeckoView'),
    phabProjectSlugs: ['geckoview-reviewers'],
    phabProjectUrl: phabProjectUrl('geckoview-reviewers'),
    // Whole product, no component list: GeckoView's fixed bugs spread across
    // General, IME, Extensions and PDF Viewer, so naming components by hand
    // would undercount and would need editing every time one is added.
    bugzilla: [{ product: 'GeckoView' }],
  },
  {
    id: asGroupId('credential-management'),
    label: 'Credential Management',
    title: 'Credential Management Review Turnaround',
    description: phabOnlyDescription('Credential Management'),
    phabProjectSlugs: ['credential-management-reviewers'],
    phabProjectUrl: phabProjectUrl('credential-management-reviewers'),
    bugzilla: [{ product: 'Toolkit', components: ['Password Manager'] }],
  },
  {
    id: asGroupId('ai-platform'),
    label: 'AI Platform and Experience',
    title: 'AI Platform and Experience Review Turnaround',
    // Spans both Phabricator and GitHub, so this is written fresh rather than
    // via phabOnlyDescription — the wording stays platform-agnostic like HNT.
    description:
      'How long the AI Platform and Experience team takes to give first feedback on code ' +
      'reviews, measured from the moment a reviewer is requested to their first accept, ' +
      'comment, or request-changes. Clock is in business hours only (Mon–Fri 9am–5pm in ' +
      "each reviewer's local timezone).",
    phabProjectSlugs: ['ai-platform-reviewers'],
    phabProjectUrl: phabProjectUrl('ai-platform-reviewers'),
    bugzilla: [
      {
        product: 'Core',
        components: [
          'Machine Learning: Frontend',
          'Machine Learning: General',
          'Machine Learning: Models',
          'Machine Learning: On Device',
          'Machine Learning: Server',
        ],
      },
    ],
    phabTabLabel: 'AI Platform (Phabricator)',
    githubTabLabel: 'MLPA (GitHub)',
    // MLPA is the team's dedicated repo: no roster gate (no people.json), so
    // every PR and reviewer counts. Add a data/ai-platform/people.json later
    // to gate and to give reviewers non-ET timezones.
    github: [{ owner: 'Firefox-AI', repo: 'MLPA' }],
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
