# CLAUDE.md — guidance for Claude Code sessions

This project tracks code-review turnaround time for the Firefox Home-NewTab
team. A daily GitHub Actions cron job pulls review activity from Phabricator
and GitHub, writes samples + rolling stats to JSON files in the repo, and
Vercel redeploys on push so a Slack Workflow posting the bare URL unfurls with
the current numbers. Read `README.md` first for the end-user surface; this file
is the parts that aren't obvious from the code.

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
GitHub Actions (Mon-Fri 13:00 UTC, .github/workflows/daily-snapshot.yml)
  └─ bun run collect
       ├─ fetchPhabSamples   (src/scripts/phabricator.ts)
       ├─ fetchGithubSamples (src/scripts/github.ts)
       ├─ collect()          (src/scripts/collect.ts, orchestrator)
       │     ├─ dedupes by (source, id, reviewer), existing wins
       │     ├─ prunes samples older than RETENTION_DAYS (90)
       │     ├─ recomputes window7d / window14d via computeStats
       │     └─ replaces today's history row (idempotent)
       └─ writes data/samples.json and data/history.json, commits, pushes
               └─ Vercel redeploys on push
                      └─ app/layout.tsx generateMetadata() reads the latest
                         history row into <title> / og:description
                              └─ Slack Workflow posts the URL; Slack unfurls.
```

Key constants in `src/scripts/collect.ts`:

- `SLA_HOURS = 4`
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
5. **The `home-newtab-reviewers` Phabricator project tag is effectively
   dormant** (two revisions in its entire history, nothing recent). The
   original plan assumed it was active; reality disagrees. `fetchPhabSamples`
   now accepts `projectSlugs: string[]` and the collector reads
   `PHAB_PROJECT_SLUGS` from env (comma-separated, defaults to that slug). If
   we find the right tag(s), set the env var; if Phab is genuinely unused by
   the team, leave the section as a near-zero chart.
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
# optional: PHAB_PROJECT_SLUGS=slug-a,slug-b
```

Inspect results quickly:

```bash
bun -e 'const s=JSON.parse(require("node:fs").readFileSync("data/samples.json","utf8")); console.log(s.length,"samples"); for(const x of s){console.log(x.source,x.id,x.reviewer,x.requestedAt,"->",x.firstActionAt);}'
```

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
- **`data/people.json` doubles as the team roster.** Its top-level `github`
  and `phab` maps started as per-reviewer timezone overrides, but their keys
  are now also what `fetchGithubSamples` and `collect()`'s legacy-row purge
  treat as "on the team" for GitHub and as the Phab-side login roster for
  the purge. An empty map on a side means "no team gate on that side" — so
  adding or removing a login changes both the timezone resolution **and**
  which review pairs count toward the metrics.
- **US holidays in business-hour math.** Listed as out of scope in the
  README; revisit if the team wants a stricter SLA counter.

## Not to be confused with

There is a parent `firefox/` checkout that has its own `CLAUDE.md` and
`AGENTS.md` with Mozilla-wide tooling guidance (`mach`, `searchfox-cli`,
Mozilla MCP servers). **Those do not apply to this project.** This is a
self-contained Next.js + bun project; ignore the Mozilla tooling notes when
working here.
