// One-shot cleanup: drop any github pending entries whose PR is closed.
// Needed because the pre-fix extractor emitted pending samples regardless of
// PR state, so a PR that closed within the 3-day PR_QUERY lookback stranded
// its reviewer in pending.json. The extractor fix heals this on the next
// collect run, but this script lets you fix the data immediately without
// waiting for the scheduled cron.

import path from 'node:path';

import { z } from 'zod';

import { pendingSampleSchema, repoSlugForRecord, type PendingSample } from './collect';
import { createGithubClient, type GraphqlClient } from './github';
import { readJsonFile, writeJsonFileAtomic } from './jsonFile';

const PR_CLOSED_QUERY = `
  query PrClosed($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) { closed }
    }
  }
`;

const closedResponseSchema = z.object({
  repository: z.object({
    pullRequest: z.object({ closed: z.boolean() }).nullable(),
  }),
});

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`environment variable ${name} is required`);
  }
  return value;
};

const isPrClosed = async (
  client: GraphqlClient,
  owner: string,
  repo: string,
  number: number,
): Promise<boolean> => {
  const raw = await client.request<unknown>(PR_CLOSED_QUERY, { owner, repo, number });
  const parsed = closedResponseSchema.parse(raw);
  // PR deleted or inaccessible — treat as closed so its pending entry drops.
  return parsed.repository.pullRequest?.closed ?? true;
};

export const runPruneClosedPending = async (dataDirectory: string): Promise<void> => {
  const pendingPath = path.join(dataDirectory, 'pending.json');
  const raw = await readJsonFile<unknown>(pendingPath, []);
  const pending = z.array(pendingSampleSchema).parse(raw);

  // Group pending github PRs by their repo so each is checked against the
  // correct owner/repo (legacy repo-less rows default to content-monorepo).
  const prNumbersByRepo = new Map<string, Set<number>>();
  for (const entry of pending) {
    if (entry.source !== 'github') continue;
    const slug = repoSlugForRecord(entry);
    const set = prNumbersByRepo.get(slug) ?? new Set<number>();
    set.add(entry.id);
    prNumbersByRepo.set(slug, set);
  }
  const totalChecked = [...prNumbersByRepo.values()].reduce((sum, set) => sum + set.size, 0);
  if (totalChecked === 0) {
    process.stderr.write('no github pending entries to check\n');
    return;
  }

  const client = createGithubClient(requireEnv('GH_PAT'));
  // Keyed `${slug}#${number}` — a PR number alone is ambiguous across repos.
  const closedKeys = new Set<string>();
  for (const [slug, numbers] of prNumbersByRepo) {
    const [owner, repo] = slug.split('/');
    if (owner === undefined || repo === undefined) continue;
    for (const number of numbers) {
      if (await isPrClosed(client, owner, repo, number)) {
        closedKeys.add(`${slug}#${String(number)}`);
      }
    }
  }

  const kept: PendingSample[] = pending.filter(
    (entry) =>
      !(
        entry.source === 'github' &&
        closedKeys.has(`${repoSlugForRecord(entry)}#${String(entry.id)}`)
      ),
  );
  const dropped = pending.length - kept.length;
  process.stderr.write(
    `checked ${String(totalChecked)} github PRs, dropped ${String(dropped)} pending entries for closed PRs\n`,
  );
  if (closedKeys.size > 0) {
    process.stderr.write(
      `closed PRs: ${[...closedKeys].sort((a, b) => a.localeCompare(b)).join(', ')}\n`,
    );
  }
  await writeJsonFileAtomic(pendingPath, kept);
};

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  const dataDirectory = path.join(process.cwd(), 'data');
  try {
    await runPruneClosedPending(dataDirectory);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`prune-closed-pending failed: ${message}\n`);
    process.exitCode = 1;
  }
}
