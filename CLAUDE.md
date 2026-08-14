# CLAUDE.md — guidance for Claude Code sessions

This project tracks code-review turnaround time for several Firefox review
groups (Home-NewTab plus IP Protection, Desktop Theme, and Sharing — see
`src/groups.ts`), selectable via a dropdown. A daily GitHub Actions cron job
pulls review activity from Phabricator and GitHub, writes per-group samples +
rolling stats to JSON files in the repo, and Vercel redeploys on push so a Slack
Workflow posting a group's URL unfurls with that group's current numbers. Read
`README.md` first for the end-user surface; this file is the parts that aren't
obvious from the code.

## Runtime and tooling

- **Use `bun`, not `npm`.** Dependencies, scripts, and the lockfile (`bun.lock`)
  are all bun-native. Running `npm install` will regress the lockfile.
- Bun runs TypeScript natively — there is no `tsx` dependency. `bun run
src/scripts/collect.ts` works directly.
- **`bun test` is the wrong command.** Bun has its own test runner that tries
  to execute `.test.ts` files directly and bypasses Vitest. Always use
  `bun run test` (or `bun run verify` for the full gate).
- Husky hooks enforce `lint-staged` (ESLint + Prettier + stylelint) and
  `tsc --noEmit` on pre-commit, plus `commitlint` on commit-msg. **Do not
  bypass with `--no-verify`.** If a hook fails, fix the underlying issue.

## Committing

Claude Code may create git commits on my behalf without asking for
per-commit confirmation, provided the change is already finished and
`bun run verify` is green. Follow the project's TDD pattern (`test:`
before `feat:` when possible) and the conventional-commit prefixes
below. Never push, force-push, or amend published history without an
explicit ask.

**Work directly on `main`.** Do not create or switch to a feature branch
unless I explicitly ask for one. This overrides the default "branch first when
on the default branch" behavior — commit straight to `main` for this repo.

## Engineering conventions

- **TDD is non-negotiable.** Every module has a colocated `*.test.ts(x)` and
  was written red → green. The commit history shows `test:` commits preceding
  their corresponding `feat:` commits. Preserve that pattern: never push
  production code without a test that failed first, and when the test and
  implementation are ready, land them in separate commits in that order.
- **Conventional commits**, enforced by commitlint. Prefixes: `feat`, `fix`,
  `chore`, `test`, `refactor`, `docs`, `ci`, `build`, `style`.
- **Never credit Claude, AI, or co-authorship in commit messages or code
  comments.** The user has been explicit about this.
- **Branded types** for every domain ID — `RevisionPhid`, `PrNumber`,
  `ReviewerLogin`, `BusinessHours`, `IsoTimestamp`, `MaterialSymbolName`. They
  live in `src/types/brand.ts` and are validated at API boundaries via zod.
  Don't smuggle raw strings/numbers across the system.
- **Zero-warning lint.** ESLint, stylelint, and Prettier all run with
  `--max-warnings=0` in `bun run verify` and in CI. The ESLint config enables
  `typescript-eslint` strict-type-checked + `unicorn` recommended + `react` +
  `jsx-a11y` + `tailwindcss`. Expect to encounter — and fix — rules like
  `unicorn/prevent-abbreviations`, `unicorn/no-array-callback-reference`, and
  `@typescript-eslint/no-non-null-assertion`. Do not disable them globally.
- **Dark mode only.** Tailwind `darkMode: 'class'`, `<html class="dark">`
  hardcoded in `app/layout.tsx`. There is no light-mode fallback, no toggle,
  no `prefers-color-scheme` handling. Do not reintroduce any of those.
- **Google Material Symbols** are the only icons. Use `<Icon name={...} />`
  from `src/ui/Icon.tsx`; the `MaterialSymbolName` brand has a whitelist and
  the constructor throws on unknown names. Add to the whitelist if you need a
  new icon.

## Architecture in 30 seconds

```
GitHub Actions (Mon-Fri, cron 10:00 UTC ≈ 6:00 ET; runs late ~7:00 ET on
                GitHub's shared queue — .github/workflows/daily-snapshot.yml)
  └─ bun run collect
       └─ for each group in src/groups.ts (sequential — shared Phab token + cooldown):
            ├─ runCollectionFromDisk(group, data/<group-id>)
            ├─ fetchPhabSamples   (src/scripts/phabricator.ts; group.phabProjectSlugs)
            ├─ fetchGithubSamples (src/scripts/github.ts; only when group.github set —
            │                      Phab-only groups pass a no-op so the GH window zeroes)
            ├─ fetchBugSamples    (src/scripts/bugzilla.ts; group.bugzilla scopes.
            │                      Unauthenticated BMO REST, whole 90-day window every
            │                      run. A throw here is caught and falls back to the
            │                      persisted bugs.json — never aborts the run)
            ├─ collect()          (src/scripts/collect.ts, orchestrator)
            │     ├─ dedupes by (source, id, reviewer), existing wins
            │     ├─ prunes samples older than RETENTION_DAYS (90)
            │     ├─ recomputes window7d / window14d / window30d via computeStats
            │     └─ replaces today's history row (idempotent)
            └─ writes data/<group-id>/{samples,history,pending,landings,backlog,bugs}.json
       └─ one commit covers every group's data/, pushes
               └─ Vercel redeploys on push
                      └─ page-level generateMetadata() (app/page.tsx for the default
                         group, app/g/[group]/page.tsx for the rest) reads that group's
                         latest history row into <title> / og:description. NOTE: this is
                         page-level, not app/layout.tsx — layouts never get route params.
                              └─ Slack Workflow posts each group's URL (bare URL = default
                                 group, /g/<id> otherwise) ≥2h after collect; Slack unfurls.
```

Groups live in `src/groups.ts` (`ALL_GROUPS`, `getGroup`, `defaultGroup`,
`dataDirectoryForGroup`). Home-NewTab is the default (bare `/`) and the only group
with a `github` config; the rest are Phabricator-only. Data is never merged across
groups — each owns `data/<id>/`.

Key constants in `src/scripts/collect.ts`:

- `SLA_HOURS = 4`
- `FIXED_WITHIN_DAYS = 7` (the bug panel's "% fixed within" reading — deliberately
  NOT an SLA: no reference line, no tab tint, no `<title>` mention)
- `RETENTION_DAYS = 90`
- `BACKFILL_LOOKBACK_DAYS = 45` (first run only — no existing samples)
- `FOLLOWUP_LOOKBACK_DAYS = 3` (every subsequent run)
- `WINDOW_7_DAYS = 7`, `WINDOW_14_DAYS = 14`
- `ET_ZONE = 'America/New_York'`

First-run backfill uses Mozilla bugbug's public `revisions.json.zst` dump
(`src/scripts/bugbug.ts`) instead of hammering Conduit's rate-limited
`transaction.search`. Daily follow-up runs (3-day window) use Conduit
directly. `BUGBUG_BACKFILL=0` forces the Conduit path even on backfill; any
bugbug-side failure auto-falls-through. Requires `zstd` on `PATH`.

## Scars worth remembering (do not repeat)

1. **GitHub Actions silently strips env vars with the `GITHUB_` prefix.** The
   PAT env var is `GH_PAT`, not `GITHUB_PAT`. Same goes for any future env var
   — never start one with `GITHUB_`.
2. **Phabricator Conduit rejects JSON-in-params form encoding.** It expects
   PHP-bracket fields (`constraints[slugs][0]=foo`). `flattenParams` in
   `src/scripts/phabricator.ts` handles this — don't rewrite it to POST JSON.
   Failure mode is `error_info: "Session key is not present."`.
3. **GitHub GraphQL has a 500,000-node budget per query.** The current query
   (100 PRs × 100 timeline items × 1 reviewer node) lands at ~10k. If you add
   a nested collection, recompute the budget. In particular, do NOT restore
   the `... on Team { members(first: 100) { nodes { login } } }` expansion —
   that pushed the budget to ~505,050 and triggered a hard failure.
4. **GitHub team review requests show `requestedReviewer: null`** when the
   PAT can't see team membership. Most of `Pocket/content-monorepo`'s reviews
   arrive that way. `extractSamplesFromPullRequest` already handles this:
   every `ReviewRequestedEvent` feeds `earliestRequestAt` regardless of whose
   reviewer it names, and reviews fall back to that timestamp when there's no
   explicit per-reviewer request. Do not reintroduce the old "drop null
   reviewers" filter.
5. **Per-group Phabricator slugs live in `src/groups.ts`, not an env var.**
   `fetchPhabSamples` accepts `projectSlugs: string[]`, and each group's slugs
   come from its `GroupConfig.phabProjectSlugs`. The old `PHAB_PROJECT_SLUGS`
   env override was **removed** — don't reintroduce it. To track a new project
   tag, add a group entry (or extend an existing group's `phabProjectSlugs`)
   in `src/groups.ts`. (Historical note: `home-newtab-reviewers` was found to be
   a dormant tag, but `fetchPhabSamples` uses the project's _member list_ as the
   roster, not a revision tag, so the metric still populates.)
6. **`ResizeObserver` is undefined under jsdom**, which `recharts`'s
   `ResponsiveContainer` needs. The stub in `vitest.setup.ts` exists for this
   reason. Removing it silently breaks every Trendline-touching component
   test.
7. **React's server-rendered HTML splits interpolated JSX text into multiple
   nodes.** `Goal: {SLA_HOURS}h` renders as the string `Goal: `, `4`, and `h`
   in three separate text nodes in the SSR payload. Any CI that searches the
   raw HTML for "Goal: 4h" will miss it. Verify via the Testing Library
   queries, not string matching.
8. **Lint-staged + ESLint complain about files ignored by the ESLint config**
   unless you pass `--no-warn-ignored`. This is already set in
   `lint-staged.config.mjs`. Don't remove that flag — adding a top-level
   config file (e.g. `vitest.config.ts`) will otherwise fail pre-commit.
9. **Bugzilla answers a nonexistent product OR component with HTTP 200 and
   `{"bugs":[]}`** — no error status, no error body. A renamed component would
   therefore make a group report zero fixed bugs forever with nothing saying why.
   `assertScopeExists` in `src/scripts/bugzilla.ts` resolves every configured scope
   against `/rest/product`'s real component list before querying, and that is the
   only thing standing between a rename and a silently dead metric. Don't drop it
   as a redundant round-trip.
10. **Bug windows bucket on `cf_last_resolved`, not filing date.** This is what
    makes the shared 7/14/30-day window machinery valid for the metric: every bug
    in a window has both timestamps, so nothing is censored. Filing-date cohorts
    measured ~75% unresolved over the trailing week, which would make each recent
    window a median over only the fastest quarter of its cohort. Do not "fix" the
    anchor to `filedAt`; `isBugInWindow`'s test in `collect.test.ts` is the guard.
11. **`renderWindowItems` in `src/ui/Headline.tsx` ends in an unconditional
    fall-through branch**, currently `bugFix`. `kindItems` is narrowed to the last
    `HeadlineItems` member there, so an explicit `kind === '…'` test trips
    `no-unnecessary-condition`. Adding a new row kind means promoting that trailing
    block to an explicit `if` first, or the new kind silently renders as bugs.
12. **`bun run test:coverage` writes `coverage/`, which stylelint then fails on**
    (`.L3` etc. in the HTML reporter's CSS are not kebab-case). `coverage/` is
    gitignored but stylelint does not read `.gitignore`, so `bun run verify` breaks
    until you `rm -rf coverage`. Coverage thresholds are also **already below their
    configured 90/85 gate on `main`** (~84% lines) and are run by neither `verify`
    nor CI.

## When you're asked to collect locally

The user keeps credentials in `.env` (gitignored). Activate with:

```bash
set -a && source .env && set +a
bun run collect
```

Expected shape:

```
GH_PAT=ghp_...
PHABRICATOR_TOKEN=api-...
```

Bugzilla needs no credential — BMO's REST API is read unauthenticated, which is
also why restricted security bugs never appear in the fix-time metric. To exercise
just the bug side without a full collection (which always builds the Conduit
client):

```bash
bun -e 'import { createBugzillaClient, fetchBugSamples } from "./src/scripts/bugzilla.ts";
  const r = await fetchBugSamples({ client: createBugzillaClient(),
    scopes: [{ product: "Firefox", components: ["New Tab Page"] }], lookbackDays: 90 });
  console.log(r.samples.length, "bugs");'
```

Inspect results quickly:

```bash
bun -e 'const s=JSON.parse(require("node:fs").readFileSync("data/samples.json","utf8")); console.log(s.length,"samples"); for(const x of s){console.log(x.source,x.id,x.reviewer,x.requestedAt,"->",x.firstActionAt);}'
```

### Seeding the bug trendline for a group

`bugs.json` backfills its full 90 days on the group's first collect, but
`history.json` only gains a `bugFix` block from that run forward — so the bug
trendline starts as one point. Bug windows are the one metric here that can be
retro-filled (they're anchored on `resolvedAt`, and `bugs.json` holds the whole
window), so run this **once per group, after that group's first collect**:

```bash
bun run src/scripts/backfillBugHistory.ts <group-id>   # or no arg for all groups
```

It fills roughly the last 60 days of rows (a row is only filled when its widest
30-day window is entirely inside `bugs.json`'s 90-day reach) and is idempotent.
**This is deliberately not wired into the daily cron**, because running it every
day would rewrite past history rows and mask a real change. The consequence: a
group that never gets the manual run keeps a one-point trendline indefinitely.

Reset and re-backfill (lose local samples.json in-progress state):

```bash
echo '[]' > data/samples.json && bun run collect
```

## Verifying the Vercel page locally

`bun run dev` starts Next.js on `http://localhost:3000`. The page renders
server-side from `data/history.json`. Confirm:

- `<html>` carries `class="dark"` and `<body>` uses `bg-neutral-950`.
- `<title>` and `<meta property="og:description">` show real numbers (the
  unfurl fallback logic prefers 7d, falls back to 14d when 7d is empty).
- The two sections render their Headline (7-day + 14-day rows) and Trendline.

## When changes are wired back into Vercel

`main` is tracked by the Vercel project; every push redeploys. The daily
`chore(data):` commits from Actions also trigger redeploys. There is no
staging environment — PRs get Vercel preview URLs automatically.

## Open questions the user may raise

- **Which Phabricator slug to actually use.** The default slug is dormant.
  Finding the right one needs team input; it isn't guessable from the API.
- **Team expansion on GitHub.** We deliberately skip `Team.members` to stay
  under the node budget; if per-reviewer attribution for team-requested PRs
  matters, we'd need to resolve the team membership with a second query.
- **`data/<group>/people.json` doubles as the team roster.** Each group has its
  own `people.json` (e.g. `data/home-newtab/people.json`), loaded via
  `loadPeopleMap(dataDirectoryForGroup(group.id))`. Its top-level `github` and
  `phab` maps started as per-reviewer timezone overrides, but their keys are now
  also what `fetchGithubSamples` and `collect()`'s legacy-row purge treat as "on
  the team" for GitHub and as the Phab-side login roster for the purge. An empty
  map on a side means "no team gate on that side" — so adding or removing a login
  changes both the timezone resolution **and** which review pairs count toward
  the metrics. New (Phab-only) groups start with no `people.json` at all, which
  means no team gate and ET-default timezones until one is added.
- **US holidays in business-hour math.** Listed as out of scope in the
  README; revisit if the team wants a stricter SLA counter.

## Not to be confused with

There is a parent `firefox/` checkout that has its own `CLAUDE.md` and
`AGENTS.md` with Mozilla-wide tooling guidance (`mach`, `searchfox-cli`,
Mozilla MCP servers). **Those do not apply to this project.** This is a
self-contained Next.js + bun project; ignore the Mozilla tooling notes when
working here.
