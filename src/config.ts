// Shared operational constants. Single source of truth so the cron, the
// dashboard, and the Slack-unfurl metadata never disagree about which SLA or
// timezone they are describing. Per-group repo/tag identity lives in the group
// registry (src/groups.ts), not here.

export const SLA_HOURS = 4;

// "Fast review" celebration threshold. A review whose turnaround beat this many
// business hours is worth celebrating (unfurl + leaderboard). Strictly under —
// see isFastSample in src/ui/fastReview.ts. Deliberately tighter than SLA_HOURS.
export const FAST_HOURS = 2;

// Minimum in-window reviews a reviewer must have done to appear on the
// leaderboard. Guards against a one-off sub-hour review topping the board.
export const LEADERBOARD_MIN_SAMPLES = 3;

// Creation-to-merge target. Covers the full author wait: from the moment the
// PR/revision is created until it lands. Business hours (9-5 ET, weekdays) so
// 24h ≈ three business days.
export const CYCLE_SLA_HOURS = 24;

// First-review-to-merge target. Covers iteration plus the author's own
// merge-click latency after the earliest reviewer action. One business day.
export const POST_REVIEW_SLA_HOURS = 8;

// "One-shot" review target: a PR that merged after a single round of review
// (no changes-requested cycle). Higher is better, so this is a lower-bound.
export const ROUNDS_SLA = 1;

// ET anchors the "today" calendar day for windows + history rows. Business-
// hours math defaults to the same zone; see businessHours.ts.
export const ET_ZONE = 'America/New_York';

// GitHub is single-repo across the whole system — only the Home-NewTab group
// pulls from GitHub, and shared PR-link builders (Headline, Backlog,
// OverdueCallout) depend on these. The group registry references them; the
// per-group axis that actually varies is the Phabricator project slug.
export const GITHUB_OWNER = 'Pocket';
export const GITHUB_REPO = 'content-monorepo';
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
export const GITHUB_REPO_LABEL = `${GITHUB_OWNER.toLowerCase()}/${GITHUB_REPO}`;

export const PHAB_ORIGIN = 'https://phabricator.services.mozilla.com';
