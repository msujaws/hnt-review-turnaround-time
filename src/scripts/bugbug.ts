import { spawn } from 'node:child_process';

import { z } from 'zod';

import {
  extractLandingFromTransactions,
  extractSamplesFromTransactions,
  lookupProjectMembers,
  resolveLogins,
  type ConduitClient,
  type PhabLanding,
  type PhabPendingSample,
  type PhabRevision,
  type PhabSample,
  type PhabTransaction,
} from './phabricator';

// Mozilla bugbug publishes a combined differential.revision.search +
// transaction.search dump as a zstd-compressed JSONL artifact. The pipeline
// refreshes on the 1st and 16th of each month, so this path is only suitable
// for the 45-day first-run backfill — daily follow-up runs keep using the
// live Conduit endpoint. Auth-free, no rate limit.
export const BUGBUG_REVISIONS_URL =
  'https://community-tc.services.mozilla.com/api/index/v1/task/project.bugbug.data_revisions.latest/artifacts/public/revisions.json.zst';

// Default decompression path. Tests pass ['cat'] to treat fixtures as
// already-decompressed JSONL without standing up a real zstd pipe.
const DEFAULT_ZSTD_COMMAND: readonly string[] = ['zstd', '-d', '--stdout'];

const reviewerAttachmentSchema = z.object({
  reviewerPHID: z.string(),
});

const bugbugTransactionSchema = z.object({
  id: z.number(),
  phid: z.string(),
  type: z
    .string()
    .nullable()
    .transform((value) => value ?? ''),
  authorPHID: z
    .string()
    .nullable()
    .transform((value) => value ?? ''),
  dateCreated: z.number(),
  fields: z
    .object({
      operations: z.array(z.object({ operation: z.string(), phid: z.string() })).optional(),
      old: z
        .union([z.string(), z.null(), z.unknown().transform(() => null)])
        .optional()
        .transform((value) => (typeof value === 'string' ? value : null)),
      new: z
        .union([z.string(), z.null(), z.unknown().transform(() => null)])
        .optional()
        .transform((value) => (typeof value === 'string' ? value : null)),
    })
    .passthrough(),
});

const bugbugRevisionSchema = z.object({
  id: z.number(),
  phid: z.string(),
  fields: z.object({
    authorPHID: z.string(),
    dateCreated: z.number().optional(),
    dateModified: z.number(),
    status: z.object({ value: z.string() }).optional(),
  }),
  attachments: z
    .object({
      reviewers: z.object({ reviewers: z.array(reviewerAttachmentSchema) }).optional(),
    })
    .optional(),
  transactions: z.array(bugbugTransactionSchema).default([]),
});

type BugbugRevision = z.infer<typeof bugbugRevisionSchema>;

// Map bugbug's raw transaction shape (uppercase PHID keys, nullable fields)
// to the PhabTransaction interface produced by the Conduit client so the
// existing extractors run against the same input shape. Mirrors the spread
// pattern used in fetchTransactions so absent operations/old/new stay absent
// rather than becoming explicit undefined.
const toPhabTransaction = (raw: BugbugRevision['transactions'][number]): PhabTransaction => ({
  id: raw.id,
  phid: raw.phid,
  type: raw.type,
  authorPhid: raw.authorPHID,
  dateCreated: raw.dateCreated,
  fields: {
    ...(raw.fields.operations === undefined ? {} : { operations: raw.fields.operations }),
    ...(raw.fields.old === null ? {} : { old: raw.fields.old }),
    ...(raw.fields.new === null ? {} : { new: raw.fields.new }),
  },
});

const toPhabRevision = (raw: BugbugRevision): PhabRevision => ({
  id: raw.id,
  phid: raw.phid,
  authorPhid: raw.fields.authorPHID,
  dateModified: raw.fields.dateModified,
  ...(raw.fields.dateCreated === undefined ? {} : { dateCreated: raw.fields.dateCreated }),
  ...(raw.fields.status === undefined ? {} : { status: raw.fields.status.value }),
});

// Stream newline-delimited JSON lines from a Node readable, buffering across
// chunk boundaries. A naive split('\n') on each chunk would mis-frame any
// record that straddles a boundary — with 333 MB of input that happens on
// every read.
async function* iterateJsonLines(
  readable: NodeJS.ReadableStream,
): AsyncGenerator<string, void, void> {
  const decoder = new TextDecoder('utf8');
  let buffer = '';
  for await (const chunk of readable) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length > 0) yield line;
      newlineIndex = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.length > 0) yield buffer;
}

export interface FetchBugbugParams {
  readonly conduitClient: ConduitClient;
  readonly projectSlugs: readonly string[];
  readonly now?: Date;
  readonly lookbackDays?: number;
  readonly sourceUrl?: string;
  readonly zstdCommand?: readonly string[];
  readonly fetchFn?: typeof fetch;
  readonly onRevisionProcessed?: (args: {
    readonly phid: string;
    readonly index: number;
    readonly total: number;
  }) => void | Promise<void>;
}

export interface FetchBugbugResult {
  readonly samples: PhabSample[];
  readonly pending: PhabPendingSample[];
  readonly landings: PhabLanding[];
  readonly revisionPhidsSeen: readonly string[];
  // Logins for every member of the resolved project(s) — mirror of
  // fetchPhabSamples' return field. The caller uses this as the
  // authoritative team roster for purging legacy samples/landings.
  readonly teamLogins: ReadonlySet<string>;
}

export const fetchBugbugSamples = async (params: FetchBugbugParams): Promise<FetchBugbugResult> => {
  const {
    conduitClient,
    projectSlugs,
    now = new Date(),
    lookbackDays,
    sourceUrl = BUGBUG_REVISIONS_URL,
    zstdCommand = DEFAULT_ZSTD_COMMAND,
    fetchFn = fetch,
    onRevisionProcessed,
  } = params;

  if (projectSlugs.length === 0) {
    throw new Error('at least one project slug is required');
  }
  if (zstdCommand.length === 0) {
    throw new Error('zstdCommand must include at least the executable name');
  }

  const { projectPhids, memberPhids } = await lookupProjectMembers(conduitClient, projectSlugs);
  if (projectPhids.length === 0) {
    throw new Error(`no project slugs resolved: ${projectSlugs.join(', ')}`);
  }
  if (memberPhids.length === 0) {
    throw new Error(
      `resolved projects have no members: ${projectSlugs.join(', ')} — is this a reviewer group?`,
    );
  }
  const allowedReviewerPhids = new Set(memberPhids);

  // Optional lookback filter. When omitted, every revision whose reviewers
  // intersect the team is processed — retention pruning happens later in
  // collect(). When provided, drop revisions whose dateModified predates the
  // cutoff to match the Conduit path's modifiedStart constraint.
  const cutoffUnixSeconds =
    lookbackDays === undefined
      ? undefined
      : Math.floor((now.getTime() - lookbackDays * 86_400 * 1000) / 1000);

  const response = await fetchFn(sourceUrl, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(
      `bugbug artifact fetch failed: HTTP ${response.status.toString()} at ${sourceUrl}`,
    );
  }
  if (response.body === null) {
    throw new Error(`bugbug artifact returned no body at ${sourceUrl}`);
  }

  const [command, ...commandArgs] = zstdCommand;
  if (command === undefined) {
    throw new Error('zstdCommand[0] is required');
  }
  const zstd = spawn(command, commandArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  const stderrChunks: Buffer[] = [];
  zstd.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  // Pipe the compressed HTTP body into the subprocess stdin without
  // materializing the ~333 MB blob in memory. Written as an explicit
  // reader loop instead of Readable.fromWeb(...).pipe(...) because the
  // fetch() Web ReadableStream type doesn't line up cleanly with Node's
  // Readable.fromWeb signature under typescript-eslint strict.
  const reader = response.body.getReader();
  const pipePromise = (async (): Promise<void> => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!zstd.stdin.write(value)) {
          await new Promise<void>((resolve) => {
            zstd.stdin.once('drain', resolve);
          });
        }
      }
    } catch (error: unknown) {
      // EPIPE happens when the subprocess closes stdin early (e.g. on a
      // malformed compressed stream). The exit-code check below decides
      // pass/fail, so swallow EPIPE and surface the real diagnostic there.
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== 'EPIPE') throw error;
    } finally {
      try {
        zstd.stdin.end();
      } catch {
        // Already closed on EPIPE.
      }
    }
  })();

  const collectedRevisions: { record: BugbugRevision; transactions: PhabTransaction[] }[] = [];
  const userPhids = new Set<string>();
  let malformedLineCount = 0;
  let schemaFailureCount = 0;

  for await (const line of iterateJsonLines(zstd.stdout)) {
    let rawValue: unknown;
    try {
      rawValue = JSON.parse(line);
    } catch {
      malformedLineCount += 1;
      continue;
    }
    const parsed = bugbugRevisionSchema.safeParse(rawValue);
    if (!parsed.success) {
      schemaFailureCount += 1;
      continue;
    }
    const record = parsed.data;

    // Short-circuit by team membership before touching transactions — cuts
    // ~99% of records out of the ~600k in the full dump.
    const reviewers = record.attachments?.reviewers?.reviewers ?? [];
    if (!reviewers.some((entry) => allowedReviewerPhids.has(entry.reviewerPHID))) {
      continue;
    }

    if (cutoffUnixSeconds !== undefined && record.fields.dateModified < cutoffUnixSeconds) {
      continue;
    }

    const transactions = record.transactions.map((raw) => toPhabTransaction(raw));
    userPhids.add(record.fields.authorPHID);
    for (const tx of transactions) {
      userPhids.add(tx.authorPhid);
      for (const op of tx.fields.operations ?? []) {
        userPhids.add(op.phid);
      }
    }
    collectedRevisions.push({ record, transactions });
  }

  // Drain any pending input write; surface non-zero exits.
  await pipePromise.catch(() => {
    // Ignore — the exit code check below is the source of truth.
  });
  const exitCode: number = await new Promise((resolve) => {
    if (zstd.exitCode !== null) {
      resolve(zstd.exitCode);
      return;
    }
    zstd.on('close', (code) => {
      resolve(code ?? -1);
    });
  });
  if (exitCode !== 0) {
    const stderrText = Buffer.concat(stderrChunks).toString('utf8').trim();
    throw new Error(
      `decompression subprocess exited ${exitCode.toString()}: ${stderrText.slice(0, 500)}`,
    );
  }

  if (malformedLineCount > 0 || schemaFailureCount > 0) {
    process.stderr.write(
      `bugbug: skipped ${malformedLineCount.toString()} malformed line(s), ${schemaFailureCount.toString()} schema failure(s)\n`,
    );
  }

  const loginByPhid =
    userPhids.size === 0
      ? new Map<string, string>()
      : await resolveLogins(conduitClient, [...userPhids]);

  const samples: PhabSample[] = [];
  const pending: PhabPendingSample[] = [];
  const landings: PhabLanding[] = [];
  const total = collectedRevisions.length;
  for (const [index, { record, transactions }] of collectedRevisions.entries()) {
    const revision = toPhabRevision(record);
    const extracted = extractSamplesFromTransactions(revision, transactions, loginByPhid, {
      allowedReviewerPhids,
    });
    samples.push(...extracted.samples);
    pending.push(...extracted.pending);
    if (revision.dateCreated !== undefined) {
      const landing = extractLandingFromTransactions(
        revision,
        transactions,
        loginByPhid,
        revision.dateCreated,
      );
      if (landing !== null) landings.push(landing);
    }
    if (onRevisionProcessed !== undefined) {
      await onRevisionProcessed({ phid: revision.phid, index, total });
    }
  }

  // teamLogins is populated in the next commit; emit an empty set here so
  // the return shape lines up with the declared type.
  const teamLogins: ReadonlySet<string> = new Set();
  return {
    samples,
    pending,
    landings,
    revisionPhidsSeen: collectedRevisions.map((entry) => entry.record.phid),
    teamLogins,
  };
};
