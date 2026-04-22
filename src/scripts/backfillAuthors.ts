import { promises as fs } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { asReviewerLogin, type ReviewerLogin } from '../types/brand';

import { pendingSampleSchema, sampleSchema, type PendingSample, type Sample } from './collect';
import { createGithubClient, type GraphqlClient } from './github';
import { createConduitClient, type ConduitClient } from './phabricator';

export interface MergeAuthorsInput {
  readonly samples: readonly Sample[];
  readonly pending: readonly PendingSample[];
  readonly phabAuthorByRevisionPhid: ReadonlyMap<string, ReviewerLogin>;
  readonly githubAuthorByPrNumber: ReadonlyMap<number, ReviewerLogin>;
}

export interface MergeAuthorsOutput {
  readonly samples: Sample[];
  readonly pending: PendingSample[];
  readonly samplesUpdated: number;
  readonly pendingUpdated: number;
}

const withAuthor = <T extends { readonly source: string; readonly author?: unknown }>(
  entry: T,
  author: ReviewerLogin | undefined,
): { entry: T; updated: boolean } => {
  if (entry.author !== undefined || author === undefined) return { entry, updated: false };
  return { entry: { ...entry, author }, updated: true };
};

const authorFor = (
  entry: { source: 'phab' | 'github'; id: string | number },
  input: MergeAuthorsInput,
): ReviewerLogin | undefined => {
  if (entry.source === 'phab') {
    return input.phabAuthorByRevisionPhid.get(String(entry.id));
  }
  return input.githubAuthorByPrNumber.get(Number(entry.id));
};

export const mergeAuthors = (input: MergeAuthorsInput): MergeAuthorsOutput => {
  let samplesUpdated = 0;
  let pendingUpdated = 0;
  const samples: Sample[] = [];
  for (const sample of input.samples) {
    const result = withAuthor(sample, authorFor(sample, input));
    samples.push(result.entry);
    if (result.updated) samplesUpdated += 1;
  }
  const pending: PendingSample[] = [];
  for (const entry of input.pending) {
    const result = withAuthor(entry, authorFor(entry, input));
    pending.push(result.entry);
    if (result.updated) pendingUpdated += 1;
  }
  return { samples, pending, samplesUpdated, pendingUpdated };
};

// ---------- Disk-bound runner ----------

const projectSearchSchema = z.object({
  data: z.array(
    z.object({
      phid: z.string(),
      fields: z.object({ authorPHID: z.string() }),
    }),
  ),
  cursor: z.object({ after: z.string().nullable() }),
});

const userSearchSchema = z.object({
  data: z.array(
    z.object({
      phid: z.string(),
      fields: z.object({ username: z.string() }),
    }),
  ),
});

const lookupPhabAuthors = async (
  client: ConduitClient,
  revisionPhids: readonly string[],
): Promise<Map<string, ReviewerLogin>> => {
  const authorByRev = new Map<string, ReviewerLogin>();
  if (revisionPhids.length === 0) return authorByRev;
  const authorPhidByRevPhid = new Map<string, string>();
  let after: string | null = null;
  do {
    const params: Record<string, unknown> = { constraints: { phids: [...revisionPhids] } };
    if (after !== null) params.after = after;
    const raw = await client.call('differential.revision.search', params);
    const parsed = projectSearchSchema.parse(raw);
    for (const entry of parsed.data) {
      authorPhidByRevPhid.set(entry.phid, entry.fields.authorPHID);
    }
    after = parsed.cursor.after;
  } while (after !== null);

  const uniqueAuthorPhids = [...new Set(authorPhidByRevPhid.values())];
  if (uniqueAuthorPhids.length === 0) return authorByRev;
  const usersRaw = await client.call('user.search', { constraints: { phids: uniqueAuthorPhids } });
  const usersParsed = userSearchSchema.parse(usersRaw);
  const loginByUserPhid = new Map<string, string>();
  for (const user of usersParsed.data) {
    loginByUserPhid.set(user.phid, user.fields.username);
  }
  for (const [revPhid, authorPhid] of authorPhidByRevPhid) {
    const login = loginByUserPhid.get(authorPhid);
    if (login !== undefined) authorByRev.set(revPhid, asReviewerLogin(login));
  }
  return authorByRev;
};

interface PullRequestAuthorResponse {
  readonly repository: {
    readonly pullRequest: {
      readonly author: { readonly login: string } | null;
    } | null;
  };
}

const PR_AUTHOR_QUERY = `
  query PullRequestAuthor($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        author { login }
      }
    }
  }
`;

const lookupGithubAuthors = async (
  client: GraphqlClient,
  prNumbers: readonly number[],
  owner: string,
  repo: string,
): Promise<Map<number, ReviewerLogin>> => {
  const authorByPr = new Map<number, ReviewerLogin>();
  for (const number of prNumbers) {
    const response = await client.request<PullRequestAuthorResponse>(PR_AUTHOR_QUERY, {
      owner,
      repo,
      number,
    });
    const login = response.repository.pullRequest?.author?.login;
    if (login !== undefined) authorByPr.set(number, asReviewerLogin(login));
  }
  return authorByPr;
};

const readJsonFile = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    return JSON.parse(contents) as T;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return fallback;
    throw error;
  }
};

const writeJsonFile = async (filePath: string, data: unknown): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`environment variable ${name} is required`);
  }
  return value;
};

export const runAuthorBackfillFromDisk = async (dataDirectory: string): Promise<void> => {
  const samplesPath = path.join(dataDirectory, 'samples.json');
  const pendingPath = path.join(dataDirectory, 'pending.json');
  const samplesRaw = await readJsonFile<unknown>(samplesPath, []);
  const pendingRaw = await readJsonFile<unknown>(pendingPath, []);
  const samples: Sample[] = z.array(sampleSchema).parse(samplesRaw);
  const pending: PendingSample[] = z.array(pendingSampleSchema).parse(pendingRaw);

  const phabPhids = new Set<string>();
  const ghPrs = new Set<number>();
  for (const entry of [...samples, ...pending]) {
    if (entry.author !== undefined) continue;
    if (entry.source === 'phab') phabPhids.add(String(entry.id));
    else ghPrs.add(Number(entry.id));
  }

  const conduit = createConduitClient({
    endpoint: 'https://phabricator.services.mozilla.com/api',
    apiToken: requireEnv('PHABRICATOR_TOKEN'),
  });
  const gh = createGithubClient(requireEnv('GH_PAT'));

  const [phabAuthorByRevisionPhid, githubAuthorByPrNumber] = await Promise.all([
    lookupPhabAuthors(conduit, [...phabPhids]),
    lookupGithubAuthors(gh, [...ghPrs], 'Pocket', 'content-monorepo'),
  ]);

  const merged = mergeAuthors({
    samples,
    pending,
    phabAuthorByRevisionPhid,
    githubAuthorByPrNumber,
  });

  await writeJsonFile(samplesPath, merged.samples);
  await writeJsonFile(pendingPath, merged.pending);
  process.stderr.write(
    `backfill: updated ${merged.samplesUpdated.toString()} samples and ${merged.pendingUpdated.toString()} pending entries\n`,
  );
};

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  const dataDirectory = path.join(process.cwd(), 'data');
  try {
    await runAuthorBackfillFromDisk(dataDirectory);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`backfill failed: ${message}\n`);
    process.exitCode = 1;
  }
}
