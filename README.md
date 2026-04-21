# HNT Review Turnaround Tracker

Daily dashboard that tracks code-review turnaround time (TAT) for the Home-NewTab team:

- **Phabricator** (`phabricator.services.mozilla.com`) — revisions tagged `home-newtab-reviewers`.
- **GitHub** (`Pocket/content-monorepo`) — all pull requests (non-draft, non-bot, non-self).

TAT = time from review request to first reviewer action, measured in **business hours**
(Mon–Fri 09:00–17:00 US/Eastern). Goal: **4 business hours**.

## How it works

```
GitHub Actions (daily 09:00 ET)
  → fetch Phab + GitHub
  → compute 7d / 14d rolling p50 / mean / p90 / %-under-SLA per source
  → append snapshot to data/history.json + data/samples.json
  → commit + push
      → Vercel redeploys on push
         → page metadata advertises today's headline numbers
            → Slack workflow posts the URL daily; Slack unfurl shows the numbers
```

Nothing in the pipeline posts to Slack directly. Slack's link unfurl reads the
`<title>`/`og:description` tags on the Vercel page, so a plain Slack Workflow
Builder step that posts the bare URL surfaces the current numbers with no
bot token required.

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

| Variable             | Purpose                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `PHABRICATOR_TOKEN`  | Conduit API token from Phabricator → Settings → Conduit API Tokens                             |
| `GH_PAT`             | GitHub personal access token with `repo` + `read:org` scopes                                   |
| `PHAB_PROJECT_SLUGS` | Optional, comma-separated list of Phabricator project slugs (default: `home-newtab-reviewers`) |

Stored as GitHub Actions secrets (`PHABRICATOR_TOKEN`, `GH_PAT`) for the daily
workflow. If the team uses multiple Phabricator tags, configure
`PHAB_PROJECT_SLUGS="slug-a,slug-b"`.

## Common commands

```bash
bun run dev            # local Next.js dev server
bun run build          # production build
bun run collect        # fetch + compute + write data/*.json (needs env vars)

bun test               # vitest run
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
  `PrNumber`, `ReviewerLogin`, `BusinessHours`, `IsoTimestamp`) validated by
  `zod` at every API boundary.
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
5. In the Slack channel, add a Workflow Builder step that posts the Vercel URL
   daily.

## Data model

See `src/scripts/collect.ts`. `data/history.json` is an append-only list of
daily snapshots; `data/samples.json` retains individual per-review samples for
90 days (so window recomputes stay cheap and auditable in git history).
First run backfills the last 45 days; subsequent runs only query 3 days back.

## Out of scope (v1)

- US federal holidays in business-hour math
- Per-reviewer breakdowns
- Alerting when SLA drops below a threshold
- Backfill of samples older than 45 days on first run
