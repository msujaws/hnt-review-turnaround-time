// Shared operational constants. Single source of truth so the cron, the
// dashboard, and the Slack-unfurl metadata never disagree about which repo,
// tag, SLA, or timezone they are describing.

export const SLA_HOURS = 4;

// ET anchors the "today" calendar day for windows + history rows. Business-
// hours math defaults to the same zone; see businessHours.ts.
export const ET_ZONE = 'America/New_York';

export const GITHUB_OWNER = 'Pocket';
export const GITHUB_REPO = 'content-monorepo';
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
export const GITHUB_REPO_LABEL = `${GITHUB_OWNER.toLowerCase()}/${GITHUB_REPO}`;

export const PHAB_ORIGIN = 'https://phabricator.services.mozilla.com';
export const DEFAULT_PHAB_PROJECT_SLUG = 'home-newtab-reviewers';
export const PHAB_PROJECT_URL = `${PHAB_ORIGIN}/tag/${DEFAULT_PHAB_PROJECT_SLUG}/`;
