import path from 'node:path';

import { DateTime } from 'luxon';
import { z } from 'zod';

import {
  CYCLE_SLA_HOURS,
  DEFAULT_PHAB_PROJECT_SLUG,
  ET_ZONE,
  GITHUB_OWNER,
  GITHUB_REPO,
  PHAB_ORIGIN,
  POST_REVIEW_SLA_HOURS,
  ROUNDS_SLA,
  SLA_HOURS,
} from '../config';
import {
  asBusinessHours,
  asIsoTimestamp,
  asPrNumber,
  asReviewerLogin,
  asRevisionPhid,
  type BusinessHours,
} from '../types/brand';

import { businessHoursBetween } from './businessHours';
import {
  createGithubClient,
  fetchGithubSamples,
  type GithubLanding,
  type GithubPendingSample,
  type GithubSample,
} from './github';
import { readJsonFile, writeJsonFileAtomic } from './jsonFile';
import { EMPTY_PEOPLE_MAP, loadPeopleMap, type PeopleMap, timezoneForReviewer } from './people';
import {
  createConduitClient,
  fetchPhabSamples,
  type PhabLanding,
  type PhabPendingSample,
  type PhabSample,
  type PhabTransaction,
} from './phabricator';
import { computeStats, type WindowStats } from './stats';

const RETENTION_DAYS = 90;
const FOLLOWUP_LOOKBACK_DAYS = 3;
const BACKFILL_LOOKBACK_DAYS = 45;
const WINDOW_7_DAYS = 7;
const WINDOW_14_DAYS = 14;
const WINDOW_30_DAYS = 30;

export type Sample =
  | (PhabSample & { readonly tatBusinessHours: BusinessHours })
  | (GithubSample & { readonly tatBusinessHours: BusinessHours });

export type PendingSample = PhabPendingSample | GithubPendingSample;

// Stored landing record. Raw PhabLanding / GithubLanding plus the two
// business-hours derivations (author timezone). postReviewBusinessHours is
// null iff firstReviewAt is null.
interface LandingBusinessHours {
  readonly cycleBusinessHours: BusinessHours;
  readonly postReviewBusinessHours: BusinessHours | null;
}
export type Landing = (PhabLanding | GithubLanding) & LandingBusinessHours;

export interface SourceWindows {
  readonly window7d: WindowStats;
  readonly window14d: WindowStats;
  readonly window30d: WindowStats;
}

// Instantaneous backlog snapshot: pending reviewers right now (from pending.json)
// plus their age in business hours. One row per ET day, replaced idempotently
// like HistoryRow. Zero values are encoded explicitly so trendline consumers
// don't need to special-case an absent entry vs. a truly empty backlog.
export interface BacklogSourceStats {
  readonly openCount: number;
  readonly oldestBusinessHours: BusinessHours;
  readonly p90BusinessHours: BusinessHours;
}

export interface BacklogSnapshot {
  readonly date: string;
  readonly phab: BacklogSourceStats;
  readonly github: BacklogSourceStats;
}

export interface HistoryRow {
  readonly date: string;
  // Review turnaround (requestedAt → firstActionAt), per-reviewer. Historical
  // back-compat: unchanged from pre-landings rows.
  readonly phab: SourceWindows;
  readonly github: SourceWindows;
  // Per-PR landing metrics. Optional so rows written before the feature shipped
  // keep validating. Cycle = createdAt → landedAt. PostReview = firstReviewAt
  // → landedAt (null firstReviewAt drops out). Rounds = WindowStats shape but
  // units are review-round counts (SLA = 1 one-shot).
  readonly phabCycle?: SourceWindows | undefined;
  readonly githubCycle?: SourceWindows | undefined;
  readonly phabPostReview?: SourceWindows | undefined;
  readonly githubPostReview?: SourceWindows | undefined;
  readonly phabRounds?: SourceWindows | undefined;
  readonly githubRounds?: SourceWindows | undefined;
}

const phabSampleSchema = z.object({
  source: z.literal('phab'),
  id: z.string().transform((v) => asRevisionPhid(v)),
  revisionId: z.number().int().positive().optional(),
  author: z
    .string()
    .transform((v) => asReviewerLogin(v))
    .optional(),
  reviewer: z.string().transform((v) => asReviewerLogin(v)),
  requestedAt: z.string().transform((v) => asIsoTimestamp(v)),
  firstActionAt: z.string().transform((v) => asIsoTimestamp(v)),
  tatBusinessHours: z.number().transform((v) => asBusinessHours(v)),
});

const githubSampleSchema = z.object({
  source: z.literal('github'),
  id: z.number().transform((v) => asPrNumber(v)),
  author: z
    .string()
    .transform((v) => asReviewerLogin(v))
    .optional(),
  reviewer: z.string().transform((v) => asReviewerLogin(v)),
  requestedAt: z.string().transform((v) => asIsoTimestamp(v)),
  firstActionAt: z.string().transform((v) => asIsoTimestamp(v)),
  tatBusinessHours: z.number().transform((v) => asBusinessHours(v)),
});

export const sampleSchema = z.discriminatedUnion('source', [phabSampleSchema, githubSampleSchema]);

// Landing schema. The nullable-coupling invariant between firstReviewAt and
// postReviewBusinessHours is enforced with a .refine — either both are null
// (merged without review) or both are set. Mixing the two would silently
// produce bad postReviewBusinessHours values.
const optionalIsoTimestamp = z
  .string()
  .transform((v) => asIsoTimestamp(v))
  .nullable();
const optionalBusinessHours = z
  .number()
  .transform((v) => asBusinessHours(v))
  .nullable();

const phabLandingSchema = z
  .object({
    source: z.literal('phab'),
    id: z.string().transform((v) => asRevisionPhid(v)),
    revisionId: z.number().int().positive(),
    author: z
      .string()
      .transform((v) => asReviewerLogin(v))
      .optional(),
    createdAt: z.string().transform((v) => asIsoTimestamp(v)),
    firstReviewAt: optionalIsoTimestamp,
    landedAt: z.string().transform((v) => asIsoTimestamp(v)),
    cycleBusinessHours: z.number().transform((v) => asBusinessHours(v)),
    postReviewBusinessHours: optionalBusinessHours,
    reviewRounds: z.number().int().nonnegative(),
  })
  .refine(
    (v) => (v.firstReviewAt === null) === (v.postReviewBusinessHours === null),
    'firstReviewAt and postReviewBusinessHours must both be null or both be set',
  );

const githubLandingSchema = z
  .object({
    source: z.literal('github'),
    id: z.number().transform((v) => asPrNumber(v)),
    author: z
      .string()
      .transform((v) => asReviewerLogin(v))
      .optional(),
    createdAt: z.string().transform((v) => asIsoTimestamp(v)),
    firstReviewAt: optionalIsoTimestamp,
    landedAt: z.string().transform((v) => asIsoTimestamp(v)),
    cycleBusinessHours: z.number().transform((v) => asBusinessHours(v)),
    postReviewBusinessHours: optionalBusinessHours,
    reviewRounds: z.number().int().nonnegative(),
  })
  .refine(
    (v) => (v.firstReviewAt === null) === (v.postReviewBusinessHours === null),
    'firstReviewAt and postReviewBusinessHours must both be null or both be set',
  );

export const landingSchema = z.union([phabLandingSchema, githubLandingSchema]);

const phabPendingSampleSchema = z.object({
  source: z.literal('phab'),
  id: z.string().transform((v) => asRevisionPhid(v)),
  revisionId: z.number().int().positive(),
  author: z
    .string()
    .transform((v) => asReviewerLogin(v))
    .optional(),
  reviewer: z.string().transform((v) => asReviewerLogin(v)),
  requestedAt: z.string().transform((v) => asIsoTimestamp(v)),
});

const githubPendingSampleSchema = z.object({
  source: z.literal('github'),
  id: z.number().transform((v) => asPrNumber(v)),
  author: z
    .string()
    .transform((v) => asReviewerLogin(v))
    .optional(),
  reviewer: z.string().transform((v) => asReviewerLogin(v)),
  requestedAt: z.string().transform((v) => asIsoTimestamp(v)),
});

export const pendingSampleSchema = z.discriminatedUnion('source', [
  phabPendingSampleSchema,
  githubPendingSampleSchema,
]);

const windowStatsSchema = z.object({
  n: z.number().int().nonnegative(),
  median: z.number().nonnegative(),
  mean: z.number().nonnegative(),
  p90: z.number().nonnegative(),
  pctUnderSLA: z.number().min(0).max(100),
});

const sourceWindowsSchema = z.object({
  window7d: windowStatsSchema,
  window14d: windowStatsSchema,
  window30d: windowStatsSchema,
});

const backlogSourceStatsSchema = z.object({
  openCount: z.number().int().nonnegative(),
  oldestBusinessHours: z
    .number()
    .nonnegative()
    .transform((v) => asBusinessHours(v)),
  p90BusinessHours: z
    .number()
    .nonnegative()
    .transform((v) => asBusinessHours(v)),
});

export const backlogSnapshotSchema = z.object({
  date: z.string(),
  phab: backlogSourceStatsSchema,
  github: backlogSourceStatsSchema,
});

export const historyRowSchema = z.object({
  date: z.string(),
  phab: sourceWindowsSchema,
  github: sourceWindowsSchema,
  phabCycle: sourceWindowsSchema.optional(),
  githubCycle: sourceWindowsSchema.optional(),
  phabPostReview: sourceWindowsSchema.optional(),
  githubPostReview: sourceWindowsSchema.optional(),
  phabRounds: sourceWindowsSchema.optional(),
  githubRounds: sourceWindowsSchema.optional(),
});

const sampleKey = (sample: { source: string; id: unknown; reviewer: string }): string =>
  `${sample.source}:${String(sample.id)}:${sample.reviewer}`;

const landingKey = (landing: { source: string; id: unknown }): string =>
  `${landing.source}:${String(landing.id)}`;

const withTat = <T extends PhabSample | GithubSample>(
  sample: T,
  peopleMap: PeopleMap,
): T & { tatBusinessHours: BusinessHours } => ({
  ...sample,
  tatBusinessHours: businessHoursBetween(
    sample.requestedAt,
    sample.firstActionAt,
    timezoneForReviewer(peopleMap, sample.source, sample.reviewer),
  ),
});

// Landings: cycleBusinessHours spans createdAt → landedAt, postReview spans
// firstReviewAt → landedAt. Both use the author's configured timezone
// (fallback America/New_York) since cycle time is the author's wait. When
// firstReviewAt is null, the PR/revision landed without a recorded human
// review (e.g. Phab silent-land); postReviewBusinessHours is null to match.
const withLandingBusinessHours = (
  landing: PhabLanding | GithubLanding,
  peopleMap: PeopleMap,
): Landing => {
  const authorLogin = landing.author ?? '';
  const zone = timezoneForReviewer(peopleMap, landing.source, authorLogin);
  const cycle = businessHoursBetween(landing.createdAt, landing.landedAt, zone);
  const postReview =
    landing.firstReviewAt === null
      ? null
      : businessHoursBetween(landing.firstReviewAt, landing.landedAt, zone);
  // Preserve the source-discriminated shape by branching — a union-wide spread
  // collapses the discriminant to `'phab' | 'github'` and trips the downstream
  // narrowing.
  if (landing.source === 'phab') {
    return { ...landing, cycleBusinessHours: cycle, postReviewBusinessHours: postReview };
  }
  return { ...landing, cycleBusinessHours: cycle, postReviewBusinessHours: postReview };
};

// Anchor windows on ET calendar-day boundaries. "N-day window" means N distinct
// ET calendar days ending with today, so a 7-day window includes today plus the
// 6 prior ET days. Cutoff = start of (today minus N-1 days).
export const etWindowCutoffMs = (now: Date, windowDays: number): number =>
  DateTime.fromJSDate(now, { zone: ET_ZONE })
    .startOf('day')
    .minus({ days: windowDays - 1 })
    .toMillis();

// Shared predicate: is this sample inside the N-day ET window anchored on `now`?
// Both collect.ts's window stats and Headline.tsx's sample list rely on this,
// so there's exactly one notion of "in window."
export const isSampleInWindow = (sample: Sample, windowDays: number, now: Date): boolean =>
  Date.parse(sample.requestedAt) >= etWindowCutoffMs(now, windowDays);

const filterWithin = (samples: readonly Sample[], windowDays: number, now: Date): BusinessHours[] =>
  samples.filter((s) => isSampleInWindow(s, windowDays, now)).map((s) => s.tatBusinessHours);

// Landings window on landedAt (the metric's anchor date), not requestedAt.
// Callers pick which numeric field to reduce over — cycle, post-review, or
// rounds. Null post-review values (no reviewer action before land) drop out.
export const isLandingInWindow = (landing: Landing, windowDays: number, now: Date): boolean =>
  Date.parse(landing.landedAt) >= etWindowCutoffMs(now, windowDays);

type LandingMetricExtractor = (l: Landing) => number | null;

const filterLandingsWithin = (
  landings: readonly Landing[],
  windowDays: number,
  now: Date,
  extract: LandingMetricExtractor,
): number[] =>
  landings
    .filter((l) => isLandingInWindow(l, windowDays, now))
    .map((l) => extract(l))
    .filter((v): v is number => v !== null);

const pendingKey = (p: PendingSample): string => `${p.source}:${String(p.id)}:${p.reviewer}`;

// Compute the real-time backlog from pending samples. Age is measured in the
// reviewer's timezone (matches how tatBusinessHours is computed) so a pending
// request that sits overnight across a weekend isn't counted as 48h stale. The
// peopleMap is optional — absent entries fall back to America/New_York. The
// date field is the ET calendar day at `now`, so replacing today's row stays
// idempotent like the history file.
export const computeBacklogSnapshot = (
  pending: readonly PendingSample[],
  now: Date,
  peopleMap: PeopleMap = EMPTY_PEOPLE_MAP,
): BacklogSnapshot => {
  const nowIso = asIsoTimestamp(now.toISOString());
  const dateEt = DateTime.fromJSDate(now, { zone: ET_ZONE }).toISODate() ?? '';

  const computeSource = (source: 'phab' | 'github'): BacklogSourceStats => {
    const ages = pending
      .filter((p) => p.source === source)
      .map((p) =>
        businessHoursBetween(
          p.requestedAt,
          nowIso,
          timezoneForReviewer(peopleMap, p.source, p.reviewer),
        ),
      );
    if (ages.length === 0) {
      return {
        openCount: 0,
        oldestBusinessHours: asBusinessHours(0),
        p90BusinessHours: asBusinessHours(0),
      };
    }
    const sorted = [...ages].sort((a, b) => a - b);
    const p90Position = (sorted.length - 1) * 0.9;
    const lowerIndex = Math.floor(p90Position);
    const upperIndex = Math.ceil(p90Position);
    const fraction = p90Position - lowerIndex;
    const lower = sorted[lowerIndex] ?? 0;
    const upper = sorted[upperIndex] ?? lower;
    const p90 = lower + (upper - lower) * fraction;
    const oldest = sorted.at(-1) ?? 0;
    return {
      openCount: ages.length,
      oldestBusinessHours: asBusinessHours(oldest),
      p90BusinessHours: asBusinessHours(p90),
    };
  };

  return {
    date: dateEt,
    phab: computeSource('phab'),
    github: computeSource('github'),
  };
};

export const collect = async (options: {
  readonly existingSamples: readonly Sample[];
  readonly existingLandings?: readonly Landing[];
  readonly existingHistory: readonly HistoryRow[];
  readonly fetchPhab: (lookbackDays: number) => Promise<{
    samples: readonly PhabSample[];
    pending: readonly PhabPendingSample[];
    landings: readonly PhabLanding[];
  }>;
  readonly fetchGithub: (lookbackDays: number) => Promise<{
    samples: readonly GithubSample[];
    pending: readonly GithubPendingSample[];
    landings: readonly GithubLanding[];
  }>;
  readonly peopleMap?: PeopleMap;
  readonly now?: Date;
  readonly slaHours?: number;
  readonly cycleSlaHours?: number;
  readonly postReviewSlaHours?: number;
  readonly roundsSla?: number;
}): Promise<{
  readonly samples: Sample[];
  readonly pending: PendingSample[];
  readonly landings: Landing[];
  readonly history: HistoryRow[];
  readonly lookbackDays: number;
}> => {
  const now = options.now ?? new Date();
  const slaHours = options.slaHours ?? SLA_HOURS;
  const cycleSlaHours = options.cycleSlaHours ?? CYCLE_SLA_HOURS;
  const postReviewSlaHours = options.postReviewSlaHours ?? POST_REVIEW_SLA_HOURS;
  const roundsSla = options.roundsSla ?? ROUNDS_SLA;
  const peopleMap = options.peopleMap ?? EMPTY_PEOPLE_MAP;
  const existingLandings = options.existingLandings ?? [];
  // Trigger a full backfill on either file's first run. Samples populates
  // from review-request events (per-reviewer), landings from merge/publish
  // events (per-PR) — a repo can have populated samples but zero landings
  // when the feature is rolled out, so we widen the window until both
  // histories are seeded.
  const lookbackDays =
    options.existingSamples.length === 0 || existingLandings.length === 0
      ? BACKFILL_LOOKBACK_DAYS
      : FOLLOWUP_LOOKBACK_DAYS;

  const [phabResult, ghResult] = await Promise.all([
    options.fetchPhab(lookbackDays),
    options.fetchGithub(lookbackDays),
  ]);

  // Fresh extraction wins for keys touched by this run's fetch — so extractor
  // bug fixes heal samples inside the current follow-up / backfill window.
  // Anything older than the fetch window is kept as-is from existingSamples
  // (long tail of persisted data), and its tatBusinessHours is recomputed via
  // withTat so peopleMap edits still propagate retroactively.
  const merged = new Map<string, Sample>();
  for (const existing of options.existingSamples) {
    merged.set(sampleKey(existing), withTat(existing, peopleMap));
  }
  for (const fresh of phabResult.samples) {
    merged.set(sampleKey(fresh), withTat(fresh, peopleMap));
  }
  for (const fresh of ghResult.samples) {
    merged.set(sampleKey(fresh), withTat(fresh, peopleMap));
  }

  const retentionCutoff = etWindowCutoffMs(now, RETENTION_DAYS);
  const samples = [...merged.values()].filter((s) => Date.parse(s.requestedAt) >= retentionCutoff);

  // Landings merge: fresh per-run extraction wins for touched (source,id)
  // keys. Existing landings outside the current lookback are kept verbatim
  // (like samples). Business hours are recomputed on every entry so peopleMap
  // edits propagate retroactively.
  const mergedLandings = new Map<string, Landing>();
  for (const existing of existingLandings) {
    mergedLandings.set(landingKey(existing), withLandingBusinessHours(existing, peopleMap));
  }
  for (const fresh of phabResult.landings) {
    mergedLandings.set(landingKey(fresh), withLandingBusinessHours(fresh, peopleMap));
  }
  for (const fresh of ghResult.landings) {
    mergedLandings.set(landingKey(fresh), withLandingBusinessHours(fresh, peopleMap));
  }
  const landings = [...mergedLandings.values()].filter(
    (l) => Date.parse(l.landedAt) >= retentionCutoff,
  );

  // Pending is authoritative from the fresh open-state fetch — no merge with
  // existing state. A pending entry that resolved to a sample simply doesn't
  // appear in this run. Dedup by (source, id, reviewer) across the two sources.
  const pendingMerged = new Map<string, PendingSample>();
  for (const p of phabResult.pending) pendingMerged.set(pendingKey(p), p);
  for (const p of ghResult.pending) pendingMerged.set(pendingKey(p), p);
  const pending = [...pendingMerged.values()];

  const phabSeries = samples.filter(
    (s): s is Extract<Sample, { source: 'phab' }> => s.source === 'phab',
  );
  const ghSeries = samples.filter(
    (s): s is Extract<Sample, { source: 'github' }> => s.source === 'github',
  );
  const phabLandings = landings.filter(
    (l): l is Extract<Landing, { source: 'phab' }> => l.source === 'phab',
  );
  const ghLandings = landings.filter(
    (l): l is Extract<Landing, { source: 'github' }> => l.source === 'github',
  );

  const landingWindows = (
    series: readonly Landing[],
    extract: LandingMetricExtractor,
    sla: number,
  ): SourceWindows => ({
    window7d: computeStats(filterLandingsWithin(series, WINDOW_7_DAYS, now, extract), sla),
    window14d: computeStats(filterLandingsWithin(series, WINDOW_14_DAYS, now, extract), sla),
    window30d: computeStats(filterLandingsWithin(series, WINDOW_30_DAYS, now, extract), sla),
  });

  const todayEt = DateTime.fromJSDate(now, { zone: ET_ZONE }).toISODate() ?? '';
  const todayRow: HistoryRow = {
    date: todayEt,
    phab: {
      window7d: computeStats(filterWithin(phabSeries, WINDOW_7_DAYS, now), slaHours),
      window14d: computeStats(filterWithin(phabSeries, WINDOW_14_DAYS, now), slaHours),
      window30d: computeStats(filterWithin(phabSeries, WINDOW_30_DAYS, now), slaHours),
    },
    github: {
      window7d: computeStats(filterWithin(ghSeries, WINDOW_7_DAYS, now), slaHours),
      window14d: computeStats(filterWithin(ghSeries, WINDOW_14_DAYS, now), slaHours),
      window30d: computeStats(filterWithin(ghSeries, WINDOW_30_DAYS, now), slaHours),
    },
    phabCycle: landingWindows(phabLandings, (l) => l.cycleBusinessHours, cycleSlaHours),
    githubCycle: landingWindows(ghLandings, (l) => l.cycleBusinessHours, cycleSlaHours),
    phabPostReview: landingWindows(
      phabLandings,
      (l) => l.postReviewBusinessHours,
      postReviewSlaHours,
    ),
    githubPostReview: landingWindows(
      ghLandings,
      (l) => l.postReviewBusinessHours,
      postReviewSlaHours,
    ),
    phabRounds: landingWindows(phabLandings, (l) => l.reviewRounds, roundsSla),
    githubRounds: landingWindows(ghLandings, (l) => l.reviewRounds, roundsSla),
  };

  const historyWithoutToday = options.existingHistory.filter((row) => row.date !== todayEt);
  const history = [...historyWithoutToday, todayRow].sort((a, b) => a.date.localeCompare(b.date));

  return { samples, pending, landings, history, lookbackDays };
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`environment variable ${name} is required`);
  }
  return value;
};

// Cached phab transactions from a partial run — resumable when a collect fails
// mid-flight (e.g. 429 on transaction.search). Gitignored; lives only on the
// local disk between a failed attempt and its retry.
const phabTransactionSchema = z.object({
  id: z.number(),
  phid: z.string(),
  type: z.string(),
  authorPhid: z.string(),
  dateCreated: z.number(),
  // old/new are populated on `type: 'status'` transactions only; without them
  // in the cache, extractLandingFromTransactions can't detect status→published
  // on cache-hit revisions (they'd need their dateModified to bump to trigger
  // a refetch). Preserve them on round-trip.
  fields: z.object({
    operations: z.array(z.object({ operation: z.string(), phid: z.string() })).optional(),
    old: z.string().optional(),
    new: z.string().optional(),
  }),
});

// Bump when an extractor or cache-shape change means previously cached
// transactions would be parsed incorrectly by current code. A mismatch causes
// loadPhabProgress to return an empty cache, which forces a full rebuild on
// the next run — safer than trusting a stale cache across breaking fixes.
// Version 2 invalidates pre-a19dec4 caches that had status transactions with
// stripped fields.old/fields.new, which made Phab landings undetectable.
export const PHAB_PROGRESS_SCHEMA_VERSION = 2;

const phabProgressSchema = z.object({
  schemaVersion: z.literal(PHAB_PROGRESS_SCHEMA_VERSION),
  lookbackDays: z.number().int().positive(),
  createdAt: z.string(),
  transactionsByRevisionPhid: z.record(z.array(phabTransactionSchema)),
});

// The cache persists across successful runs now — it's not just a mid-flight
// resume artifact. Correctness is guaranteed by the per-revision dateModified
// revalidation in fetchPhabSamples, so arbitrary gaps between runs are safe.
// The TTL is purely a circuit breaker for bugs, long vacations, or schema
// drift: beyond 30 days we rebuild from scratch rather than trust old state.
const PROGRESS_TTL_MS = 30 * 24 * 3600 * 1000;

// Pure helper: keep only cache entries for revisions that actually showed up
// in this run's revision search. Prevents the cache from growing unbounded
// with closed/abandoned revisions that will never be queried again.
export const prunePhabCache = (
  seen: ReadonlySet<string>,
  cache: ReadonlyMap<string, readonly PhabTransaction[]>,
): Map<string, readonly PhabTransaction[]> => {
  const pruned = new Map<string, readonly PhabTransaction[]>();
  for (const phid of seen) {
    const txs = cache.get(phid);
    if (txs !== undefined) pruned.set(phid, txs);
  }
  return pruned;
};

interface LoadedProgress {
  readonly transactions: Map<string, PhabTransaction[]>;
  readonly createdAt: string;
}

export const loadPhabProgress = async (
  filePath: string,
  currentLookbackDays: number,
  now: Date,
): Promise<LoadedProgress> => {
  const fallback: LoadedProgress = { transactions: new Map(), createdAt: now.toISOString() };
  const raw = await readJsonFile<unknown>(filePath, null);
  if (raw === null) return fallback;
  const parsed = phabProgressSchema.safeParse(raw);
  if (!parsed.success) return fallback;
  if (parsed.data.lookbackDays !== currentLookbackDays) return fallback;
  const age = now.getTime() - Date.parse(parsed.data.createdAt);
  if (!Number.isFinite(age) || age > PROGRESS_TTL_MS) return fallback;
  const transactions = new Map<string, PhabTransaction[]>();
  for (const [phid, txs] of Object.entries(parsed.data.transactionsByRevisionPhid)) {
    transactions.set(
      phid,
      txs.map((tx) => ({
        id: tx.id,
        phid: tx.phid,
        type: tx.type,
        authorPhid: tx.authorPhid,
        dateCreated: tx.dateCreated,
        fields: {
          ...(tx.fields.operations === undefined ? {} : { operations: tx.fields.operations }),
          ...(tx.fields.old === undefined ? {} : { old: tx.fields.old }),
          ...(tx.fields.new === undefined ? {} : { new: tx.fields.new }),
        },
      })),
    );
  }
  return { transactions, createdAt: parsed.data.createdAt };
};

export const runCollectionFromDisk = async (dataDirectory: string): Promise<void> => {
  const samplesPath = path.join(dataDirectory, 'samples.json');
  const historyPath = path.join(dataDirectory, 'history.json');
  const pendingPath = path.join(dataDirectory, 'pending.json');
  const landingsPath = path.join(dataDirectory, 'landings.json');
  const backlogPath = path.join(dataDirectory, 'backlog.json');
  const progressPath = path.join(dataDirectory, '.phab-progress.json');

  const existingSamplesRaw = await readJsonFile<unknown>(samplesPath, []);
  const existingHistoryRaw = await readJsonFile<unknown>(historyPath, []);
  const existingLandingsRaw = await readJsonFile<unknown>(landingsPath, []);
  const existingBacklogRaw = await readJsonFile<unknown>(backlogPath, []);
  const existingSamples = z.array(sampleSchema).parse(existingSamplesRaw);
  const existingHistory = z.array(historyRowSchema).parse(existingHistoryRaw);
  const existingLandings = z.array(landingSchema).parse(existingLandingsRaw);
  const existingBacklog = z.array(backlogSnapshotSchema).parse(existingBacklogRaw);
  const peopleMap = await loadPeopleMap(dataDirectory);

  const now = new Date();
  // Mirrors the decision inside collect(): widen to backfill when either
  // feature's persisted history is empty (samples-first-run OR landings-
  // first-run). Keeps the phab progress cache's lookback key in sync.
  const lookbackDays =
    existingSamples.length === 0 || existingLandings.length === 0
      ? BACKFILL_LOOKBACK_DAYS
      : FOLLOWUP_LOOKBACK_DAYS;
  const { transactions: resumeCache, createdAt: progressCreatedAt } = await loadPhabProgress(
    progressPath,
    lookbackDays,
    now,
  );
  if (resumeCache.size > 0) {
    process.stderr.write(`phab cache loaded (${resumeCache.size.toString()} revisions)\n`);
  }

  const writeProgress = async (
    transactionsByRevisionPhid: ReadonlyMap<string, readonly PhabTransaction[]>,
  ): Promise<void> => {
    await writeJsonFileAtomic(progressPath, {
      schemaVersion: PHAB_PROGRESS_SCHEMA_VERSION,
      lookbackDays,
      createdAt: progressCreatedAt,
      transactionsByRevisionPhid: Object.fromEntries(transactionsByRevisionPhid),
    });
  };

  const conduit = createConduitClient({
    endpoint: `${PHAB_ORIGIN}/api`,
    apiToken: requireEnv('PHABRICATOR_TOKEN'),
    // Phab's transaction.search limiter keeps cutting us off around the
    // 100-150 mark per session. Cede the budget voluntarily: pause 30 min
    // after every 100 transaction.search calls to stay under the ceiling.
    methodCooldowns: [{ method: 'transaction.search', every: 100, cooldownMs: 30 * 60 * 1000 }],
  });
  const gh = createGithubClient(requireEnv('GH_PAT'));

  const seenRevisionPhids = new Set<string>();
  const { samples, pending, landings, history } = await collect({
    existingSamples,
    existingLandings,
    existingHistory,
    peopleMap,
    fetchPhab: async (lookbackDaysArgument) => {
      const result = await fetchPhabSamples({
        client: conduit,
        projectSlugs: (process.env.PHAB_PROJECT_SLUGS ?? DEFAULT_PHAB_PROJECT_SLUG)
          .split(',')
          .map((slug) => slug.trim())
          .filter((slug) => slug.length > 0),
        lookbackDays: lookbackDaysArgument,
        resumeCache: {
          createdAt: Math.floor(Date.parse(progressCreatedAt) / 1000),
          transactionsByRevisionPhid: resumeCache,
        },
        onRevisionTransactions: async (phid, transactions) => {
          resumeCache.set(phid, [...transactions]);
          await writeProgress(resumeCache);
        },
      });
      for (const phid of result.revisionPhidsSeen) seenRevisionPhids.add(phid);
      return { samples: result.samples, pending: result.pending, landings: result.landings };
    },
    fetchGithub: (lookbackDaysArgument) =>
      fetchGithubSamples({
        client: gh,
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        lookbackDays: lookbackDaysArgument,
      }),
  });

  // Backlog snapshot: replace today's row idempotently (matches history.json
  // behaviour). Old snapshots are kept as-is — they're frozen in time and
  // can't be recomputed from samples.json after the fact.
  const todaySnapshot = computeBacklogSnapshot(pending, now, peopleMap);
  const backlogWithoutToday = existingBacklog.filter((row) => row.date !== todaySnapshot.date);
  const backlog = [...backlogWithoutToday, todaySnapshot].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  await writeJsonFileAtomic(samplesPath, samples);
  await writeJsonFileAtomic(historyPath, history);
  await writeJsonFileAtomic(pendingPath, pending);
  await writeJsonFileAtomic(landingsPath, landings);
  await writeJsonFileAtomic(backlogPath, backlog);
  // Rewrite the phab cache file with only the revisions we saw this run and a
  // fresh createdAt anchored on run start (`now`). This keeps the cache from
  // accumulating closed/stale revisions and lets the next run's dateModified
  // check correctly re-fetch anything modified after `now`.
  const prunedCache = prunePhabCache(seenRevisionPhids, resumeCache);
  await writeJsonFileAtomic(progressPath, {
    lookbackDays,
    createdAt: now.toISOString(),
    transactionsByRevisionPhid: Object.fromEntries(prunedCache),
  });
};

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  const dataDirectory = path.join(process.cwd(), 'data');
  try {
    await runCollectionFromDisk(dataDirectory);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`collect failed: ${message}\n`);
    process.exitCode = 1;
  }
}
