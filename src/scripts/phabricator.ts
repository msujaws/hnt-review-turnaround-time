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
  readonly revisionId?: number | undefined;
  // Patch author login. Absent on legacy rows collected before this field
  // existed; every fresh extract populates it.
  readonly author?: ReviewerLogin | undefined;
  readonly reviewer: ReviewerLogin;
  readonly requestedAt: IsoTimestamp;
  readonly firstActionAt: IsoTimestamp;
}

export interface PhabPendingSample {
  readonly source: 'phab';
  readonly id: RevisionPhid;
  readonly revisionId: number;
  // Patch author login. Absent on legacy rows collected before this field
  // existed; every fresh extract populates it.
  readonly author?: ReviewerLogin | undefined;
  readonly reviewer: ReviewerLogin;
  readonly requestedAt: IsoTimestamp;
}

export interface ExtractedTransactions {
  readonly samples: readonly PhabSample[];
  readonly pending: readonly PhabPendingSample[];
}

export interface PhabRevision {
  readonly id: number;
  readonly phid: string;
  readonly authorPhid: string;
  // Unix seconds. Compared against resumeCache.createdAt to decide whether a
  // cached transaction list is still valid, so no stale cache is ever served.
  readonly dateModified: number;
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
  options: { readonly allowedReviewerPhids?: ReadonlySet<string> } = {},
): ExtractedTransactions => {
  const { allowedReviewerPhids } = options;
  // Process transactions chronologically, tracking per-reviewer request windows.
  // A reviewer's "active request" starts on add/request and ends on remove. The
  // sample is the first action that falls inside any active window; a later
  // remove/re-add after that action doesn't produce a second sample.
  const ordered = [...transactions].sort((a, b) => a.dateCreated - b.dateCreated);

  const currentRequestAt = new Map<string, number>();
  const emitted = new Map<string, { requestedAt: number; firstActionAt: number }>();

  for (const tx of ordered) {
    if (tx.type === 'reviewers') {
      for (const op of tx.fields.operations ?? []) {
        if (op.phid === revision.authorPhid) continue;
        if (allowedReviewerPhids !== undefined && !allowedReviewerPhids.has(op.phid)) continue;
        if (REVIEWER_ADD_OPS.has(op.operation)) {
          currentRequestAt.set(op.phid, tx.dateCreated);
        } else if (op.operation === 'remove') {
          currentRequestAt.delete(op.phid);
        }
      }
      continue;
    }
    if (!REVIEWER_ACTION_TYPES.has(tx.type)) continue;
    if (tx.authorPhid === revision.authorPhid) continue;
    if (emitted.has(tx.authorPhid)) continue;
    const requestedAt = currentRequestAt.get(tx.authorPhid);
    if (requestedAt === undefined) continue;
    emitted.set(tx.authorPhid, { requestedAt, firstActionAt: tx.dateCreated });
  }

  const samples: PhabSample[] = [];
  const authorLogin = loginByPhid.get(revision.authorPhid);
  for (const [reviewerPhid, { requestedAt, firstActionAt }] of emitted) {
    const login = loginByPhid.get(reviewerPhid);
    if (login === undefined) continue;
    samples.push({
      source: 'phab',
      id: asRevisionPhid(revision.phid),
      revisionId: revision.id,
      ...(authorLogin === undefined ? {} : { author: asReviewerLogin(authorLogin) }),
      reviewer: asReviewerLogin(login),
      requestedAt: toIso(requestedAt),
      firstActionAt: toIso(firstActionAt),
    });
  }

  // Pending = reviewers still in an active request window at end of timeline
  // who didn't emit a completed sample. Reviewers whose phid has no login
  // mapping are dropped (same rule applied to completed samples above).
  const pending: PhabPendingSample[] = [];
  for (const [reviewerPhid, requestedAt] of currentRequestAt) {
    if (emitted.has(reviewerPhid)) continue;
    const login = loginByPhid.get(reviewerPhid);
    if (login === undefined) continue;
    pending.push({
      source: 'phab',
      id: asRevisionPhid(revision.phid),
      revisionId: revision.id,
      ...(authorLogin === undefined ? {} : { author: asReviewerLogin(authorLogin) }),
      reviewer: asReviewerLogin(login),
      requestedAt: toIso(requestedAt),
    });
  }

  return { samples, pending };
};

const projectSearchSchema = z.object({
  data: z.array(
    z.object({
      phid: z.string(),
      attachments: z
        .object({
          members: z
            .object({
              members: z.array(z.object({ phid: z.string() })),
            })
            .optional(),
        })
        .optional(),
    }),
  ),
});

const revisionSearchSchema = z.object({
  data: z.array(
    z.object({
      id: z.number(),
      phid: z.string(),
      fields: z.object({ authorPHID: z.string(), dateModified: z.number() }),
    }),
  ),
  cursor: z.object({ after: z.string().nullable() }),
});

const transactionSchema = z.object({
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

const lookupProjectMembers = async (
  client: ConduitClient,
  slugs: readonly string[],
): Promise<{ projectPhids: string[]; memberPhids: string[] }> => {
  const raw = await client.call('project.search', {
    constraints: { slugs: [...slugs] },
    attachments: { members: true },
  });
  const parsed = projectSearchSchema.parse(raw);
  const projectPhids = parsed.data.map((entry) => entry.phid);
  const uniqueMembers = new Set<string>();
  for (const entry of parsed.data) {
    for (const member of entry.attachments?.members?.members ?? []) {
      uniqueMembers.add(member.phid);
    }
  }
  return { projectPhids, memberPhids: [...uniqueMembers] };
};

// Revision statuses that still need a reviewer's attention. The open-state
// query is bounded by OPEN_REVISION_LOOKBACK_DAYS so we don't pull every
// long-abandoned open revision on the account — each revision costs a
// transaction.search call, which is where Phab's per-session rate limit bites.
const OPEN_REVISION_STATUSES = ['needs-review', 'changes-planned', 'needs-revision'] as const;
const OPEN_REVISION_LOOKBACK_DAYS = 90;

const fetchRevisions = async (
  client: ConduitClient,
  constraints: Record<string, unknown>,
): Promise<PhabRevision[]> => {
  const revisions: PhabRevision[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  do {
    const params: Record<string, unknown> = {
      constraints,
      order: 'newest',
    };
    if (after !== null) params.after = after;
    const raw = await client.call('differential.revision.search', params);
    const parsed = revisionSearchSchema.parse(raw);
    for (const item of parsed.data) {
      if (seen.has(item.phid)) continue;
      seen.add(item.phid);
      revisions.push({
        id: item.id,
        phid: item.phid,
        authorPhid: item.fields.authorPHID,
        dateModified: item.fields.dateModified,
      });
    }
    after = parsed.cursor.after;
  } while (after !== null);
  return revisions;
};

const TRANSACTION_PAGE_LIMIT = 100;

const fetchTransactions = async (
  client: ConduitClient,
  revisionPhid: string,
): Promise<PhabTransaction[]> => {
  const transactions: PhabTransaction[] = [];
  let after: string | null = null;
  do {
    const params: Record<string, unknown> = {
      objectIdentifier: revisionPhid,
      limit: TRANSACTION_PAGE_LIMIT,
    };
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

export interface PhabResumeCache {
  // Unix seconds. A cached revision's transactions are reused only when the
  // revision's dateModified is <= this value — otherwise we re-fetch.
  readonly createdAt: number;
  readonly transactionsByRevisionPhid: ReadonlyMap<string, readonly PhabTransaction[]>;
}

export const fetchPhabSamples = async (params: {
  readonly client: ConduitClient;
  readonly projectSlugs: readonly string[];
  readonly lookbackDays: number;
  readonly now?: Date;
  readonly resumeCache?: PhabResumeCache;
  readonly onRevisionTransactions?: (
    phid: string,
    transactions: readonly PhabTransaction[],
  ) => void | Promise<void>;
}): Promise<{ samples: PhabSample[]; pending: PhabPendingSample[] }> => {
  const { client, projectSlugs, lookbackDays } = params;
  const resumeCache = params.resumeCache;
  const onRevisionTransactions = params.onRevisionTransactions;
  const now = params.now ?? new Date();
  const modifiedStart = Math.floor((now.getTime() - lookbackDays * 86_400 * 1000) / 1000);
  const openModifiedStart = Math.floor(
    (now.getTime() - OPEN_REVISION_LOOKBACK_DAYS * 86_400 * 1000) / 1000,
  );

  if (projectSlugs.length === 0) {
    throw new Error('at least one project slug is required');
  }
  const { projectPhids, memberPhids } = await lookupProjectMembers(client, projectSlugs);
  if (projectPhids.length === 0) {
    throw new Error(`no project slugs resolved: ${projectSlugs.join(', ')}`);
  }
  if (memberPhids.length === 0) {
    throw new Error(
      `resolved projects have no members: ${projectSlugs.join(', ')} — is this a reviewer group?`,
    );
  }

  // Two independent revision queries, deduped by PHID:
  // 1. Recently-modified revisions (any status) — the follow-up / backfill window.
  //    Needed to resolve stale pending entries into completed samples.
  // 2. Open-status revisions (any modification date) — authoritative current
  //    pending state. Catches stale-but-still-open revisions the recent query
  //    would miss.
  const recentRevisions = await fetchRevisions(client, {
    reviewerPHIDs: [...memberPhids],
    modifiedStart,
  });
  const openRevisions = await fetchRevisions(client, {
    reviewerPHIDs: [...memberPhids],
    statuses: [...OPEN_REVISION_STATUSES],
    modifiedStart: openModifiedStart,
  });
  const revisionsByPhid = new Map<string, PhabRevision>();
  for (const rev of [...recentRevisions, ...openRevisions]) {
    revisionsByPhid.set(rev.phid, rev);
  }
  const revisions = [...revisionsByPhid.values()];
  const allowedReviewerPhids = new Set(memberPhids);

  const transactionsByRevision = new Map<string, readonly PhabTransaction[]>();
  const userPhids = new Set<string>();
  for (const rev of revisions) {
    userPhids.add(rev.authorPhid);
    const cached = resumeCache?.transactionsByRevisionPhid.get(rev.phid);
    const canReuseCache =
      cached !== undefined && rev.dateModified <= (resumeCache?.createdAt ?? -Infinity);
    let transactions: readonly PhabTransaction[];
    if (canReuseCache) {
      transactions = cached;
    } else {
      transactions = await fetchTransactions(client, rev.phid);
      if (onRevisionTransactions !== undefined) {
        await onRevisionTransactions(rev.phid, transactions);
      }
    }
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
  const pending: PhabPendingSample[] = [];
  for (const rev of revisions) {
    const txs = transactionsByRevision.get(rev.phid) ?? [];
    const extracted = extractSamplesFromTransactions(rev, txs, loginByPhid, {
      allowedReviewerPhids,
    });
    samples.push(...extracted.samples);
    pending.push(...extracted.pending);
  }
  return { samples, pending };
};

const flattenParams = (value: unknown, prefix: string, body: URLSearchParams): void => {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      flattenParams(item, `${prefix}[${index.toString()}]`, body);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const nextPrefix = prefix === '' ? key : `${prefix}[${key}]`;
      flattenParams(nested, nextPrefix, body);
    }
    return;
  }
  if (typeof value === 'string') {
    body.append(prefix, value);
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    body.append(prefix, value.toString());
  }
};

const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 180_000;
const DEFAULT_MIN_INTERVAL_MS = 5000;

const parseRetryAfter = (header: string | null): number | null => {
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
};

export interface MethodCooldown {
  readonly method: string;
  readonly every: number;
  readonly cooldownMs: number;
}

export const createConduitClient = (options: {
  readonly endpoint: string;
  readonly apiToken: string;
  readonly fetchFn?: typeof fetch;
  readonly sleepFn?: (ms: number) => Promise<void>;
  readonly maxRetries?: number;
  readonly minIntervalMs?: number;
  readonly nowFn?: () => number;
  readonly methodCooldowns?: readonly MethodCooldown[];
}): ConduitClient => {
  const { endpoint, apiToken } = options;
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn =
    options.sleepFn ??
    ((ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }));
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const nowFn = options.nowFn ?? Date.now;
  const methodCooldowns = options.methodCooldowns ?? [];
  const callCountByMethod = new Map<string, number>();
  let lastCallAt = Number.NEGATIVE_INFINITY;
  return {
    call: async (method, params) => {
      const body = new URLSearchParams();
      body.set('api.token', apiToken);
      flattenParams(params, '', body);
      const priorCount = callCountByMethod.get(method) ?? 0;
      const cooldown = methodCooldowns.find((entry) => entry.method === method);
      if (cooldown !== undefined && priorCount > 0 && priorCount % cooldown.every === 0) {
        // Pause ahead of the Nth+1 call — Phab's opaque per-endpoint limiter
        // caps us around this many transaction.search calls per session, so
        // we cede the budget voluntarily instead of eating another 429.
        await sleepFn(cooldown.cooldownMs);
      }
      const sinceLast = nowFn() - lastCallAt;
      if (sinceLast < minIntervalMs) {
        await sleepFn(minIntervalMs - sinceLast);
      }
      for (let attempt = 0; ; attempt += 1) {
        lastCallAt = nowFn();
        const response = await fetchFn(`${endpoint}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        if (response.status === 429 && attempt < maxRetries) {
          const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
          const fallback = Math.min(DEFAULT_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
          await sleepFn(retryAfter ?? fallback);
          continue;
        }
        if (!response.ok) {
          const retryAfterHeader = response.headers.get('Retry-After');
          let bodyText = '';
          try {
            const rawBody = await response.text();
            bodyText = rawBody.slice(0, 500);
          } catch {
            // Body already consumed or unreadable — keep empty snippet.
          }
          const parts = [`Conduit ${method} failed with status ${String(response.status)}`];
          if (retryAfterHeader !== null) parts.push(`Retry-After=${retryAfterHeader}`);
          const snippet = bodyText.replaceAll(/\s+/g, ' ').trim();
          if (snippet.length > 0) parts.push(`body="${snippet}"`);
          throw new Error(parts.join('; '));
        }
        const json = (await response.json()) as { result?: unknown; error_info?: string | null };
        if (json.error_info !== undefined && json.error_info !== null) {
          throw new Error(`Conduit ${method} error: ${json.error_info}`);
        }
        callCountByMethod.set(method, priorCount + 1);
        return json.result;
      }
    },
  };
};
