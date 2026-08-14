# Review Turnaround Tracker

Daily dashboard that tracks code-review turnaround time (TAT) for several Firefox
review groups. A dropdown at the top switches between them; each group's data is
tracked independently and never merged.

| Group                      | Phabricator project tag           | GitHub                    | Bugzilla scope               | URL                        |
| -------------------------- | --------------------------------- | ------------------------- | ---------------------------- | -------------------------- |
| Home-NewTab                | `home-newtab-reviewers`           | `Pocket/content-monorepo` | Firefox :: New Tab Page      | `/` (default)              |
| IP Protection              | `ip-protection-reviewers`         | —                         | Firefox :: IP Protection     | `/g/ip-protection`         |
| Desktop Theme              | `desktop-theme-reviewers`         | —                         | Firefox :: Theme             | `/g/desktop-theme`         |
| Sharing                    | `sharing-reviewers`               | —                         | Firefox :: Sharing           | `/g/sharing`               |
| GeckoView                  | `geckoview-reviewers`             | —                         | GeckoView (whole product)    | `/g/geckoview`             |
| Credential Management      | `credential-management-reviewers` | —                         | Toolkit :: Password Manager  | `/g/credential-management` |
| AI Platform and Experience | `ai-platform-reviewers`           | `Firefox-AI/MLPA`         | Core :: Machine Learning: \* | `/g/ai-platform`           |

Home-NewTab and AI Platform and Experience review on both Phabricator and GitHub;
the other groups are Phabricator-only. Home-NewTab pulls `Pocket/content-monorepo`
(all pull requests: non-draft, non-bot, non-self) plus the backend team's
`mozilla-services/merino-py` PRs; AI Platform and Experience pulls `Firefox-AI/MLPA`.
The set of groups lives in `src/groups.ts`.

TAT = time from review request to first reviewer action, measured in **business hours**
(Mon–Fri 09:00–17:00 US/Eastern). Goal: **4 business hours**.

Each group's page surfaces:

- **Rolling stats** — 7d / 14d / 30d p50 / mean / p90 / %-under-SLA per source,
  with trendlines and an expandable list of the individual reviews behind each window.
- **Overdue callout** — pending reviews that have been waiting 10× the SLA or longer.
- **Fast-review celebration** — reviews that finished in under 2 business hours are
  counted and celebrated in the Slack unfurl (see below).
- **Bug fix time** — how long a bug takes from filing to `RESOLVED FIXED`.

### Bug fix time (filed → RESOLVED FIXED)

A separate metric from review turnaround, shown as a panel in each group's
Phabricator tab. Scoped by Bugzilla product::component (see the table above), and
measured in **calendar days** — weekends and nights included, unlike every review
metric on the page. A bug filed Friday evening and fixed Monday morning waited the
whole weekend.

There is deliberately **no goal and no SLA**. The panel reports a "% fixed within 7
days" figure because it is a legible summary, but it draws no reference line on its
trendline, leaves the median/mean/p90 cards uncolored, never tints the tab red, and
stays out of the page `<title>`. 7 days is a reading, not a target.

**Read the median.** The distribution is heavily right-skewed: for
`Firefox :: New Tab Page` over 90 days the median is 4.6 days while the mean is 18.4
and the p90 is 47.6, because a handful of long-lived bugs pull the tail. The mean and
p90 are shown but are not typical.

Windows bucket by **resolution date**, not filing date. That is what keeps the
existing 7/14/30-day windows valid: every bug counted has both a filing and a
resolution timestamp, so there is no censoring. Filing-date cohorts were measured at
roughly 75% unresolved over the trailing week, which would have made each recent
window a median over only the fastest quarter of its cohort. The consequence to know
is the mirror image: a years-old bug fixed yesterday lands in yesterday's window with
its full age, and `cf_last_resolved` records the _latest_ resolution, so a reopened
and re-fixed bug reports the time to its most recent fix.

Bugzilla is read unauthenticated, so restricted (security) bugs are invisible to this
metric.

## How it works

```
GitHub Actions (daily 09:00 ET)
  → for each group in src/groups.ts (sequential):
      → fetch Phab (+ GitHub for Home-NewTab) (+ Bugzilla for every group)
      → compute 7d / 14d / 30d rolling p50 / mean / p90 / %-under-SLA per source
      → write snapshot to data/<group>/history.json + samples.json + …
  → commit + push (one commit covers every group's data/)
      → Vercel redeploys on push
         → each group's page metadata advertises its own headline numbers
            → Slack workflow posts each group's URL; Slack unfurl shows the numbers
```

Nothing in the pipeline posts to Slack directly. Slack's link unfurl reads the
`<title>`/`og:description` tags on the Vercel page, and those are generated
per-group at the page level, so a plain Slack Workflow Builder step that posts a
group's URL (the bare URL for Home-NewTab, `/g/<id>` for the rest) surfaces that
group's current numbers with no bot token required.

The unfurl headline can carry two prefixes ahead of the median figures: a
`⚠ N overdue ·` warning when pending reviews have blown past 10× the SLA, and a
`🎉 N under 2h ·` celebration counting reviews that finished in under 2 business
hours within the headline window. The warning leads; the celebration follows.

## Setup

Prereqs: [Bun](https://bun.sh) 1.3+.

```bash
bun install
```

The `prepare` script wires up Husky on install, so the pre-commit and commit-msg
hooks are active immediately. Bun runs TypeScript natively, so no `tsx` wrapper
is needed for the collector script.

### Environment variables

Used by the collector (only needed when running the fetch script):

| Variable            | Purpose                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `PHABRICATOR_TOKEN` | Conduit API token from Phabricator → Settings → Conduit API Tokens                                     |
| `GH_PAT`            | GitHub personal access token with `repo` + `read:org` scopes                                           |
| `BUGBUG_BACKFILL`   | Optional. Set to `0` to skip the bugbug backfill path and force Conduit even on first-run (see below). |

Stored as GitHub Actions secrets (`PHABRICATOR_TOKEN`, `GH_PAT`) for the daily
workflow. Each group's Phabricator project tag(s) live in `src/groups.ts`, not in
an environment variable — add or edit an entry there to change the tracked groups.

### First-run backfill data source

The collector widens to a 45-day window on the very first run (empty
`samples.json` or `landings.json`). That window hits Phabricator's
`transaction.search` rate limit hard — each 30-minute cooldown pause makes
a fresh backfill take hours. To avoid it, the backfill path downloads
Mozilla `bugbug`'s public [`revisions.json.zst`][bugbug-dump] artifact
(combined `differential.revision.search` + `transaction.search`, no auth,
no rate limit) and filters it down to the configured team.

- Requires `zstd` on `PATH` (installed by default on macOS and
  `ubuntu-latest` GitHub runners).
- Daily follow-up runs (3-day window) always use Conduit directly.
- `bugbug`'s dump refreshes on the 1st and 16th of each month, so the
  tail end may be up to ~16 days stale; the next daily follow-up fills
  the gap.
- On any failure (404, network error, decompression failure) the
  collector falls back to the Conduit backfill path automatically.
- Set `BUGBUG_BACKFILL=0` to bypass it entirely.

[bugbug-dump]: https://github.com/mozilla/bugbug/blob/master/docs/data.md#phabricator-revisions

## Common commands

```bash
bun run dev            # local Next.js dev server
bun run build          # production build
bun run collect        # fetch + compute + write data/*.json (needs env vars)

bun run test           # vitest run (never `bun test` — that invokes bun's own runner)
bun run test:watch     # vitest watch
bun run test:coverage  # coverage report

bun run lint           # ESLint (all rules, unicorn, tailwind, a11y)
bun run stylelint      # stylelint
bun run format         # prettier --write
bun run format:check   # prettier --check
bun run typecheck      # tsc --noEmit

bun run verify         # runs lint + stylelint + format:check + typecheck + tests
```

## Engineering standards

- **TDD**: every module has a colocated `*.test.ts(x)` and was written red → green.
- **ESLint**: `@eslint/js` + `typescript-eslint` strict-type-checked + `unicorn` +
  `react`/`react-hooks` + `jsx-a11y` + `tailwindcss`, zero warnings tolerated.
- **Prettier** + **stylelint** enforced via `lint-staged` pre-commit.
- **Branded types** (`src/types/brand.ts`) for all domain IDs (`RevisionPhid`,
  `PrNumber`, `BugNumber`, `ReviewerLogin`, `BusinessHours`, `CalendarDays`,
  `IsoTimestamp`, `GroupId`) validated by `zod` at every API boundary.
  `CalendarDays` and `BusinessHours` are numerically identical but kept distinct:
  47 calendar days is seven weeks, 47 business hours is six working days.
- **Conventional commits** enforced by `commitlint` in the `commit-msg` hook.
- **Husky hooks**:
  - `pre-commit`: `lint-staged` + `tsc --noEmit`
  - `commit-msg`: `commitlint`
  - `--no-verify` is not used; hook failures must be fixed at the source.

## UI

- **Dark mode only**. `<html class="dark">` is hardcoded; there is no toggle and
  no light-mode styles. Tailwind `darkMode: 'class'`.
- **Tailwind CSS** is the sole styling mechanism.
- **Google Material Symbols** via the `material-symbols` npm package, wrapped in
  a typed `<Icon name="..." />` with a whitelisted `MaterialSymbolName` brand.
- Charts: `recharts`, themed via constants in `src/ui/chartTheme.ts`.

## Deploy

1. Push the repo to GitHub.
2. Set the `PHABRICATOR_TOKEN` and `GH_PAT` secrets on the repo.
3. Import the repo into Vercel — it detects Next.js automatically.
4. Each push (including the nightly data commit) redeploys.
5. In the Slack channel, add a Workflow Builder step that posts a group's Vercel
   URL daily — the bare URL for Home-NewTab, `/g/<id>` for the other groups. One
   step per group surfaces each group's own unfurled numbers.

## Data model

See `src/scripts/collect.ts`. Each group owns a `data/<group-id>/` directory
(e.g. `data/home-newtab/`, `data/ip-protection/`) holding its own
`history.json`, `samples.json`, `landings.json`, `pending.json`,
`backlog.json`, and `bugs.json` — group data is never merged. `history.json` is an append-only
list of daily snapshots; `samples.json` retains individual per-review samples
for 90 days (so window recomputes stay cheap and auditable in git history).
First run for a group backfills the last 45 days; subsequent runs only query
3 days back. The collector loops over every group in `src/groups.ts` on each run.

`bugs.json` is the exception to all of the above: it is **fully replaced** on
every run, not merged, because the Bugzilla query re-derives the whole 90-day
resolved set in one cheap request. That makes the first run self-backfilling with
no 45-day special case, and it is also the only correct choice — a bug that gets
reopened, or re-resolved as `WONTFIX`, stops matching `resolution=FIXED` and has
to leave the dataset, where a merge would pin the stale `FIXED` row forever. The
tradeoff: `bugs.json` is a cache rather than an archive, and a past day's figure
can change retroactively. A failing Bugzilla fetch keeps the previous `bugs.json`
and logs to stderr rather than aborting the run, so a BMO outage cannot take down
the review-turnaround metrics.

## Out of scope (v1)

- US federal holidays in business-hour math
- Per-reviewer breakdowns (e.g. per-reviewer trendlines)
- Cross-source reviewer identity merging
- Alerting when SLA drops below a threshold
- Backfill of samples older than 45 days on first run
- Restricted (security) bugs in the fix-time metric — Bugzilla is read
  unauthenticated
- Back-dated `bugFix` history rows: `bugs.json` covers 90 days from the first run,
  but the trendline only gains a point per daily snapshot from that run forward
