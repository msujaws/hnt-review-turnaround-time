// One-shot cleanup: drop any github pending entries whose PR is closed.
// Needed because the pre-fix extractor emitted pending samples regardless of
// PR state, so a PR that closed within the 3-day PR_QUERY lookback stranded
// its reviewer in pending.json. The extractor fix heals this on the next
// collect run, but this script lets you fix the data immediately without
// waiting for the scheduled cron.

import path from 'node:path';

import { z } from 'zod';

import { GITHUB_OWNER, GITHUB_REPO } from '../config';

import { pendingSampleSchema, type PendingSample } from './collect';
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

  const githubPrNumbers = new Set<number>();
  for (const entry of pending) {
    if (entry.source === 'github') githubPrNumbers.add(entry.id);
  }
  if (githubPrNumbers.size === 0) {
    process.stderr.write('no github pending entries to check\n');
    return;
  }

  const client = createGithubClient(requireEnv('GH_PAT'));
  const closedIds = new Set<number>();
  for (const number of githubPrNumbers) {
    if (await isPrClosed(client, GITHUB_OWNER, GITHUB_REPO, number)) {
      closedIds.add(number);
    }
  }

  const kept: PendingSample[] = pending.filter(
    (entry) => !(entry.source === 'github' && closedIds.has(entry.id)),
  );
  const dropped = pending.length - kept.length;
  process.stderr.write(
    `checked ${String(githubPrNumbers.size)} github PRs, dropped ${String(dropped)} pending entries for closed PRs\n`,
  );
  if (closedIds.size > 0) {
    const ids = [...closedIds].sort((a, b) => a - b).join(',');
    process.stderr.write(`closed PR numbers: ${ids}\n`);
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
