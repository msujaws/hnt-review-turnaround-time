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

// Per-revision landing record — emitted once when a revision transitions to
// the "published" status. Separate from per-reviewer samples: one landing per
// revision, regardless of how many reviewers touched it. Author may be absent
// when the patch comes from a user outside the reviewer roster (same rule as
// PhabSample.author).
export interface PhabLanding {
  readonly source: 'phab';
  readonly id: RevisionPhid;
  readonly revisionId: number;
  readonly author?: ReviewerLogin | undefined;
  readonly createdAt: IsoTimestamp;
  // Earliest reviewer-action transaction. Null when the revision landed
  // without any recorded reviewer action (e.g. self-land, silent accept).
  readonly firstReviewAt: IsoTimestamp | null;
  readonly landedAt: IsoTimestamp;
  // Approximate: 1 + count of request-changes transactions. One-shot = 1.
  readonly reviewRounds: number;
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
  // Unix seconds. The revision's own creation time — used as the start point
  // for cycle time (createdAt → landedAt). Optional so legacy callers and
  // test fixtures that pre-date landings still construct the type.
  readonly dateCreated?: number;
  // Current revision status slug ('needs-review', 'accepted', 'abandoned',
  // 'published', 'draft', etc.). Optional so legacy fixtures that pre-date
  // this field keep compiling; in production fetchRevisions always populates
  // it. extractSamplesFromTransactions treats undefined as open so pending
  // still emits for those legacy paths.
  readonly status?: string;
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
    // Populated on `type: 'status'` transactions. Phabricator's status slugs:
    // 'needs-review' | 'accepted' | 'needs-revision' | 'changes-planned' |
    // 'published' | 'abandoned' | 'draft'. 'published' is the landed state.
    readonly old?: string | null;
    readonly new?: string | null;
  };
}

export interface ConduitClient {
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}

const REVIEWER_ACTION_TYPES = new Set(['accept', 'request-changes', 'reject', 'comment', 'inline']);
const REVIEWER_ADD_OPS = new Set(['add', 'request']);

const toIso = (unixSeconds: number): IsoTimestamp =>
  asIsoTimestamp(new Date(unixSeconds * 1000).toISOString());

// One landing per revision that reached the published status. Callers pass
// the revision's createdAt (unix seconds) since the revision.search response
// carries `dateCreated` at a different layer. Returns null when the revision
// never lands — open, accepted-but-unlanded, abandoned, and draft all map to
// null. If the revision re-opens and re-closes, the earliest close
// transaction wins (matches "when did this first land?").
//
// Phabricator surfaces landings via a dedicated 'close' transaction, not a
// 'status' transition with fields.new === 'published'. An early iteration of
// this extractor watched for the latter and found zero landings in a 45-day
// backfill of 411 revisions — the fix is to match the type that Phab
// actually emits. 'abandon' is similarly its own type (not handled here;
// abandoned revisions simply never emit a close and return null).
export const extractLandingFromTransactions = (
  revision: PhabRevision,
  transactions: readonly PhabTransaction[],
  loginByPhid: ReadonlyMap<string, string>,
  createdAtUnixSeconds: number,
): PhabLanding | null => {
  const ordered = [...transactions].sort((a, b) => a.dateCreated - b.dateCreated);
  const firstPublished = ordered.find((tx) => tx.type === 'close');
  if (firstPublished === undefined) return null;

  let firstReviewerAction: number | undefined;
  let changesRequestedCount = 0;
  for (const tx of ordered) {
    if (tx.authorPhid === revision.authorPhid) continue;
    if (!REVIEWER_ACTION_TYPES.has(tx.type)) continue;
    firstReviewerAction ??= tx.dateCreated;
    if (tx.type === 'request-changes') changesRequestedCount += 1;
  }

  const authorLogin = loginByPhid.get(revision.authorPhid);
  return {
    source: 'phab',
    id: asRevisionPhid(revision.phid),
    revisionId: revision.id,
    ...(authorLogin === undefined ? {} : { author: asReviewerLogin(authorLogin) }),
    createdAt: toIso(createdAtUnixSeconds),
    firstReviewAt: firstReviewerAction === undefined ? null : toIso(firstReviewerAction),
    landedAt: toIso(firstPublished.dateCreated),
    reviewRounds: 1 + changesRequestedCount,
  };
};

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
  // Skip the whole block when the revision is in a terminal state
  // (abandoned / published / draft / accepted): the request is no longer
  // actionable, so keeping it in pending would strand the reviewer in the
  // overdue list forever. undefined status falls through as "open" for
  // legacy fixtures that build PhabRevision without going through
  // fetchRevisions. Mirrors the GitHub gate in 78b1ecb.
  const pending: PhabPendingSample[] = [];
  const revisionIsOpen =
    revision.status === undefined || OPEN_REVISION_STATUSES.has(revision.status);
  if (revisionIsOpen) {
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
      fields: z.object({
        authorPHID: z.string(),
        dateCreated: z.number().optional(),
        dateModified: z.number(),
        // Phab's differential.revision.search always returns this, but legacy
        // test fixtures omit it. Optional + z.string() for the inner slug
        // keeps old fixtures parsing and fails-open on any new Phab status
        // (the pending gate checks membership in OPEN_REVISION_STATUSES, so
        // unknown slugs are correctly treated as non-open — the safe default).
        status: z.object({ value: z.string() }).optional(),
      }),
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
  fields: z
    .object({
      operations: z
        .array(
          z.object({
            operation: z.string(),
            phid: z.string(),
          }),
        )
        .optional(),
      // Status-change transactions carry `old`/`new` as status slugs. Other
      // transaction types reuse the same field names for unrelated payloads
      // (objects, nulls); fall back to null on any non-string value instead
      // of failing the whole page.
      old: z
        .union([z.string(), z.null(), z.unknown().transform(() => null)])
        .optional()
        .transform((v) => (typeof v === 'string' ? v : null)),
      new: z
        .union([z.string(), z.null(), z.unknown().transform(() => null)])
        .optional()
        .transform((v) => (typeof v === 'string' ? v : null)),
    })
    .passthrough(),
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
  // Phab returns a cursor on every search response. Tolerate its absence so
  // existing stubs that elide it keep parsing, but follow `after` when present.
  cursor: z.object({ after: z.string().nullable() }).optional(),
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

// Revision statuses that still need a reviewer's attention. Also the single
// source of truth for the pending-emission gate in
// extractSamplesFromTransactions — a revision whose current status isn't in
// this set has nothing actionable left, so pending would strand a reviewer in
// the overdue list. The open-state query is bounded by
// OPEN_REVISION_LOOKBACK_DAYS so we don't pull every long-abandoned open
// revision on the account — each revision costs a transaction.search call,
// which is where Phab's per-session rate limit bites.
const OPEN_REVISION_STATUSES: ReadonlySet<string> = new Set([
  'needs-review',
  'changes-planned',
  'needs-revision',
]);
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
        ...(item.fields.dateCreated === undefined ? {} : { dateCreated: item.fields.dateCreated }),
        ...(item.fields.status === undefined ? {} : { status: item.fields.status.value }),
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
      // Preserve operations (reviewer add/remove) and old/new (status
      // transitions). The latter are required by extractLandingFromTransactions
      // to detect status→published. Dropping them here was the reason zero
      // phab landings showed up in the first 45-day backfill.
      transactions.push({
        id: item.id,
        phid: item.phid,
        type: item.type,
        authorPhid: item.authorPHID,
        dateCreated: item.dateCreated,
        fields: {
          ...(item.fields.operations === undefined ? {} : { operations: item.fields.operations }),
          ...(item.fields.old === null ? {} : { old: item.fields.old }),
          ...(item.fields.new === null ? {} : { new: item.fields.new }),
        },
      });
    }
    after = parsed.cursor.after;
  } while (after !== null);
  return transactions;
};

// Phab's search endpoints cap a single `phids` constraint at ~100 and
// paginate the response with cursor.after at a default page size of 100.
// Miss either and results silently drop. Shared so every `phids`-keyed
// search (user.search, differential.revision.search, etc.) gets it right.
export const PHID_SEARCH_CHUNK_SIZE = 100;

export const paginatePhidSearch = async <T>(
  client: ConduitClient,
  method: string,
  phids: readonly string[],
  parsePage: (raw: unknown) => { readonly rows: readonly T[]; readonly after: string | null },
): Promise<T[]> => {
  const out: T[] = [];
  if (phids.length === 0) return out;
  for (let start = 0; start < phids.length; start += PHID_SEARCH_CHUNK_SIZE) {
    const batch = phids.slice(start, start + PHID_SEARCH_CHUNK_SIZE);
    let after: string | null = null;
    do {
      const params: Record<string, unknown> = { constraints: { phids: batch } };
      if (after !== null) params.after = after;
      const raw = await client.call(method, params);
      const page = parsePage(raw);
      out.push(...page.rows);
      after = page.after;
    } while (after !== null);
  }
  return out;
};

const resolveLogins = async (
  client: ConduitClient,
  phids: readonly string[],
): Promise<Map<string, string>> => {
  const users = await paginatePhidSearch(client, 'user.search', phids, (raw) => {
    const parsed = userSearchSchema.parse(raw);
    return { rows: parsed.data, after: parsed.cursor?.after ?? null };
  });
  const byPhid = new Map<string, string>();
  for (const entry of users) {
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
  // Fires once per revision in the deduped recent+open set, regardless of
  // whether transactions were served from resumeCache or freshly fetched.
  // Gives observers a cadence tick for progress reporting even during
  // cache-heavy runs where onRevisionTransactions stays quiet.
  readonly onRevisionProcessed?: (args: {
    readonly phid: string;
    readonly cached: boolean;
    readonly index: number;
    readonly total: number;
  }) => void | Promise<void>;
}): Promise<{
  samples: PhabSample[];
  pending: PhabPendingSample[];
  landings: PhabLanding[];
  revisionPhidsSeen: readonly string[];
}> => {
  const { client, projectSlugs, lookbackDays } = params;
  const resumeCache = params.resumeCache;
  const onRevisionTransactions = params.onRevisionTransactions;
  const onRevisionProcessed = params.onRevisionProcessed;
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
  const revisionsTotal = revisions.length;
  for (const [revisionIndex, rev] of revisions.entries()) {
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
    if (onRevisionProcessed !== undefined) {
      await onRevisionProcessed({
        phid: rev.phid,
        cached: canReuseCache,
        index: revisionIndex,
        total: revisionsTotal,
      });
    }
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
  const landings: PhabLanding[] = [];
  for (const rev of revisions) {
    const txs = transactionsByRevision.get(rev.phid) ?? [];
    const extracted = extractSamplesFromTransactions(rev, txs, loginByPhid, {
      allowedReviewerPhids,
    });
    samples.push(...extracted.samples);
    pending.push(...extracted.pending);
    // Landings need the revision's own dateCreated; skip if the API didn't
    // return it (very old revisions have been observed missing this field in
    // the wild). The rest of the metrics still populate fine without them.
    if (rev.dateCreated !== undefined) {
      const landing = extractLandingFromTransactions(rev, txs, loginByPhid, rev.dateCreated);
      if (landing !== null) landings.push(landing);
    }
  }
  return { samples, pending, landings, revisionPhidsSeen: revisions.map((r) => r.phid) };
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
