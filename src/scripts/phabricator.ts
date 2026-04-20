import { z } from 'zod';

import {
  asIsoTimestamp,
  asReviewerLogin,
  asRevisionPhid,
  type IsoTimestamp,
  type ReviewerLogin,
  type RevisionPhid,
} from '../types/brand';

export interface PhabSample {
  readonly source: 'phab';
  readonly id: RevisionPhid;
  readonly reviewer: ReviewerLogin;
  readonly requestedAt: IsoTimestamp;
  readonly firstActionAt: IsoTimestamp;
}

export interface PhabRevision {
  readonly id: number;
  readonly phid: string;
  readonly authorPhid: string;
}

interface ReviewerOperation {
  readonly operation: string;
  readonly phid: string;
}

export interface PhabTransaction {
  readonly id: number;
  readonly phid: string;
  readonly type: string;
  readonly authorPhid: string;
  readonly dateCreated: number;
  readonly fields: {
    readonly operations?: readonly ReviewerOperation[];
  };
}

export interface ConduitClient {
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}

const REVIEWER_ACTION_TYPES = new Set(['accept', 'request-changes', 'reject', 'comment', 'inline']);
const REVIEWER_ADD_OPS = new Set(['add', 'request']);

const toIso = (unixSeconds: number): IsoTimestamp =>
  asIsoTimestamp(new Date(unixSeconds * 1000).toISOString());

export const extractSamplesFromTransactions = (
  revision: PhabRevision,
  transactions: readonly PhabTransaction[],
  loginByPhid: ReadonlyMap<string, string>,
): PhabSample[] => {
  const requestedAtByReviewer = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.type !== 'reviewers') continue;
    for (const op of tx.fields.operations ?? []) {
      if (!REVIEWER_ADD_OPS.has(op.operation)) continue;
      if (op.phid === revision.authorPhid) continue;
      if (!requestedAtByReviewer.has(op.phid)) {
        requestedAtByReviewer.set(op.phid, tx.dateCreated);
      }
    }
  }

  const samples: PhabSample[] = [];
  for (const [reviewerPhid, requestedAt] of requestedAtByReviewer) {
    const firstAction = transactions
      .filter(
        (tx) =>
          tx.authorPhid === reviewerPhid &&
          REVIEWER_ACTION_TYPES.has(tx.type) &&
          tx.dateCreated >= requestedAt,
      )
      .sort((a, b) => a.dateCreated - b.dateCreated)[0];
    if (firstAction === undefined) continue;
    const login = loginByPhid.get(reviewerPhid);
    if (login === undefined) continue;
    samples.push({
      source: 'phab',
      id: asRevisionPhid(revision.phid),
      reviewer: asReviewerLogin(login),
      requestedAt: toIso(requestedAt),
      firstActionAt: toIso(firstAction.dateCreated),
    });
  }
  return samples;
};

const projectSearchSchema = z.object({
  data: z.array(z.object({ phid: z.string() })),
});

const revisionSearchSchema = z.object({
  data: z.array(
    z.object({
      id: z.number(),
      phid: z.string(),
      fields: z.object({ authorPHID: z.string() }),
    }),
  ),
  cursor: z.object({ after: z.string().nullable() }),
});

const transactionSchema = z.object({
  id: z.number(),
  phid: z.string(),
  type: z.string(),
  authorPHID: z.string(),
  dateCreated: z.number(),
  fields: z.object({
    operations: z
      .array(
        z.object({
          operation: z.string(),
          phid: z.string(),
        }),
      )
      .optional(),
  }),
});

const transactionSearchSchema = z.object({
  data: z.array(transactionSchema),
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

const lookupProjectPhid = async (client: ConduitClient, slug: string): Promise<string> => {
  const raw = await client.call('project.search', { constraints: { slugs: [slug] } });
  const parsed = projectSearchSchema.parse(raw);
  const entry = parsed.data[0];
  if (entry === undefined) {
    throw new Error(`project slug not found: ${slug}`);
  }
  return entry.phid;
};

const fetchRevisions = async (
  client: ConduitClient,
  projectPhid: string,
  modifiedStart: number,
): Promise<PhabRevision[]> => {
  const revisions: PhabRevision[] = [];
  let after: string | null = null;
  do {
    const params: Record<string, unknown> = {
      constraints: { projects: [projectPhid], modifiedStart },
      order: 'newest',
    };
    if (after !== null) params.after = after;
    const raw = await client.call('differential.revision.search', params);
    const parsed = revisionSearchSchema.parse(raw);
    for (const item of parsed.data) {
      revisions.push({ id: item.id, phid: item.phid, authorPhid: item.fields.authorPHID });
    }
    after = parsed.cursor.after;
  } while (after !== null);
  return revisions;
};

const fetchTransactions = async (
  client: ConduitClient,
  revisionPhid: string,
): Promise<PhabTransaction[]> => {
  const transactions: PhabTransaction[] = [];
  let after: string | null = null;
  do {
    const params: Record<string, unknown> = { objectIdentifier: revisionPhid };
    if (after !== null) params.after = after;
    const raw = await client.call('transaction.search', params);
    const parsed = transactionSearchSchema.parse(raw);
    for (const item of parsed.data) {
      transactions.push({
        id: item.id,
        phid: item.phid,
        type: item.type,
        authorPhid: item.authorPHID,
        dateCreated: item.dateCreated,
        fields: item.fields.operations === undefined ? {} : { operations: item.fields.operations },
      });
    }
    after = parsed.cursor.after;
  } while (after !== null);
  return transactions;
};

const resolveLogins = async (
  client: ConduitClient,
  phids: readonly string[],
): Promise<Map<string, string>> => {
  const byPhid = new Map<string, string>();
  if (phids.length === 0) return byPhid;
  const raw = await client.call('user.search', { constraints: { phids } });
  const parsed = userSearchSchema.parse(raw);
  for (const entry of parsed.data) {
    byPhid.set(entry.phid, entry.fields.username);
  }
  return byPhid;
};

export const fetchPhabSamples = async (params: {
  readonly client: ConduitClient;
  readonly projectSlug: string;
  readonly lookbackDays: number;
  readonly now?: Date;
}): Promise<PhabSample[]> => {
  const { client, projectSlug, lookbackDays } = params;
  const now = params.now ?? new Date();
  const modifiedStart = Math.floor((now.getTime() - lookbackDays * 86_400 * 1000) / 1000);

  const projectPhid = await lookupProjectPhid(client, projectSlug);
  const revisions = await fetchRevisions(client, projectPhid, modifiedStart);

  const transactionsByRevision = new Map<string, PhabTransaction[]>();
  const userPhids = new Set<string>();
  for (const rev of revisions) {
    userPhids.add(rev.authorPhid);
    const transactions = await fetchTransactions(client, rev.phid);
    transactionsByRevision.set(rev.phid, transactions);
    for (const tx of transactions) {
      userPhids.add(tx.authorPhid);
      for (const op of tx.fields.operations ?? []) {
        userPhids.add(op.phid);
      }
    }
  }

  const loginByPhid = await resolveLogins(client, [...userPhids]);

  const samples: PhabSample[] = [];
  for (const rev of revisions) {
    const txs = transactionsByRevision.get(rev.phid) ?? [];
    samples.push(...extractSamplesFromTransactions(rev, txs, loginByPhid));
  }
  return samples;
};

export const createConduitClient = (options: {
  readonly endpoint: string;
  readonly apiToken: string;
  readonly fetchFn?: typeof fetch;
}): ConduitClient => {
  const { endpoint, apiToken } = options;
  const fetchFn = options.fetchFn ?? fetch;
  return {
    call: async (method, params) => {
      const body = new URLSearchParams();
      body.set('api.token', apiToken);
      body.set('params', JSON.stringify(params));
      body.set('output', 'json');
      const response = await fetchFn(`${endpoint}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!response.ok) {
        throw new Error(`Conduit ${method} failed with status ${String(response.status)}`);
      }
      const json = (await response.json()) as { result?: unknown; error_info?: string | null };
      if (json.error_info !== undefined && json.error_info !== null) {
        throw new Error(`Conduit ${method} error: ${json.error_info}`);
      }
      return json.result;
    },
  };
};
