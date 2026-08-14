// Shared operational constants. Single source of truth so the cron, the
// dashboard, and the Slack-unfurl metadata never disagree about which SLA or
// timezone they are describing. Per-group repo/tag identity lives in the group
// registry (src/groups.ts), not here.

export const SLA_HOURS = 4;

// "Fast review" celebration threshold. A review whose turnaround beat this many
// business hours is worth celebrating in the Slack unfurl. Strictly under —
// see isFastSample in src/ui/fastReview.ts. Deliberately tighter than SLA_HOURS.
export const FAST_HOURS = 2;

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

// Threshold for the "% fixed within N days" stat card on the bug filed-to-fixed
// panel, in calendar days. Deliberately NOT named *_SLA and not a goal: the
// panel draws no reference line on its trendline, leaves the median/mean/p90
// cards uncolored, and stays out of the page <title>. It exists only because
// WindowStats.pctUnderSLA is a required field, and "fixed within a week" is the
// reading that makes that number legible. Named for the reading rather than for
// a window so it is not confused with the 7/14/30-day rolling windows.
// Measured on Firefox :: New Tab Page: median 4.6d, mean 18.4d, p90 47.6d.
export const FIXED_WITHIN_DAYS = 7;

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

// Bugzilla is read unauthenticated, so restricted (security) bugs are invisible
// to the filed-to-fixed metric. Adding an API key would include them; that is a
// deliberate decision rather than a default.
export const BUGZILLA_ORIGIN = 'https://bugzilla.mozilla.org';
