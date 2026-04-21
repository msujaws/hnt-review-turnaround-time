import { promises as fs } from 'node:fs';
import path from 'node:path';

import { DateTime } from 'luxon';
import { z } from 'zod';

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
  type GithubPendingSample,
  type GithubSample,
} from './github';
import { EMPTY_PEOPLE_MAP, loadPeopleMap, type PeopleMap, timezoneForReviewer } from './people';
import {
  createConduitClient,
  fetchPhabSamples,
  type PhabPendingSample,
  type PhabSample,
} from './phabricator';
import { computeStats, type WindowStats } from './stats';

const SLA_HOURS = 4;
const RETENTION_DAYS = 90;
const FOLLOWUP_LOOKBACK_DAYS = 3;
const BACKFILL_LOOKBACK_DAYS = 45;
const WINDOW_7_DAYS = 7;
const WINDOW_14_DAYS = 14;
const WINDOW_30_DAYS = 30;
const ET_ZONE = 'America/New_York';

export type Sample =
  | (PhabSample & { readonly tatBusinessHours: BusinessHours })
  | (GithubSample & { readonly tatBusinessHours: BusinessHours });

export type PendingSample = PhabPendingSample | GithubPendingSample;

export interface SourceWindows {
  readonly window7d: WindowStats;
  readonly window14d: WindowStats;
  readonly window30d: WindowStats;
}

export interface HistoryRow {
  readonly date: string;
  readonly phab: SourceWindows;
  readonly github: SourceWindows;
}

const phabSampleSchema = z.object({
  source: z.literal('phab'),
  id: z.string().transform((v) => asRevisionPhid(v)),
  revisionId: z.number().int().positive().optional(),
  reviewer: z.string().transform((v) => asReviewerLogin(v)),
  requestedAt: z.string().transform((v) => asIsoTimestamp(v)),
  firstActionAt: z.string().transform((v) => asIsoTimestamp(v)),
  tatBusinessHours: z.number().transform((v) => asBusinessHours(v)),
});

const githubSampleSchema = z.object({
  source: z.literal('github'),
  id: z.number().transform((v) => asPrNumber(v)),
  reviewer: z.string().transform((v) => asReviewerLogin(v)),
  requestedAt: z.string().transform((v) => asIsoTimestamp(v)),
  firstActionAt: z.string().transform((v) => asIsoTimestamp(v)),
  tatBusinessHours: z.number().transform((v) => asBusinessHours(v)),
});

export const sampleSchema = z.discriminatedUnion('source', [phabSampleSchema, githubSampleSchema]);

const phabPendingSampleSchema = z.object({
  source: z.literal('phab'),
  id: z.string().transform((v) => asRevisionPhid(v)),
  revisionId: z.number().int().positive(),
  reviewer: z.string().transform((v) => asReviewerLogin(v)),
  requestedAt: z.string().transform((v) => asIsoTimestamp(v)),
});

const githubPendingSampleSchema = z.object({
  source: z.literal('github'),
  id: z.number().transform((v) => asPrNumber(v)),
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

export const historyRowSchema = z.object({
  date: z.string(),
  phab: sourceWindowsSchema,
  github: sourceWindowsSchema,
});

const sampleKey = (sample: { source: string; id: unknown; reviewer: string }): string =>
  `${sample.source}:${String(sample.id)}:${sample.reviewer}`;

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

const pendingKey = (p: PendingSample): string => `${p.source}:${String(p.id)}:${p.reviewer}`;

export const collect = async (options: {
  readonly existingSamples: readonly Sample[];
  readonly existingHistory: readonly HistoryRow[];
  readonly fetchPhab: (
    lookbackDays: number,
  ) => Promise<{ samples: readonly PhabSample[]; pending: readonly PhabPendingSample[] }>;
  readonly fetchGithub: (
    lookbackDays: number,
  ) => Promise<{ samples: readonly GithubSample[]; pending: readonly GithubPendingSample[] }>;
  readonly peopleMap?: PeopleMap;
  readonly now?: Date;
  readonly slaHours?: number;
}): Promise<{
  readonly samples: Sample[];
  readonly pending: PendingSample[];
  readonly history: HistoryRow[];
  readonly lookbackDays: number;
}> => {
  const now = options.now ?? new Date();
  const slaHours = options.slaHours ?? SLA_HOURS;
  const peopleMap = options.peopleMap ?? EMPTY_PEOPLE_MAP;
  const lookbackDays =
    options.existingSamples.length === 0 ? BACKFILL_LOOKBACK_DAYS : FOLLOWUP_LOOKBACK_DAYS;

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
  };

  const historyWithoutToday = options.existingHistory.filter((row) => row.date !== todayEt);
  const history = [...historyWithoutToday, todayRow].sort((a, b) => a.date.localeCompare(b.date));

  return { samples, pending, history, lookbackDays };
};

const isNodeErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

const readJsonFile = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    return JSON.parse(contents) as T;
  } catch (error) {
    if (isNodeErrnoException(error) && error.code === 'ENOENT') {
      return fallback;
    }
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

export const runCollectionFromDisk = async (dataDirectory: string): Promise<void> => {
  const samplesPath = path.join(dataDirectory, 'samples.json');
  const historyPath = path.join(dataDirectory, 'history.json');
  const pendingPath = path.join(dataDirectory, 'pending.json');

  const existingSamplesRaw = await readJsonFile<unknown>(samplesPath, []);
  const existingHistoryRaw = await readJsonFile<unknown>(historyPath, []);
  const existingSamples = z.array(sampleSchema).parse(existingSamplesRaw);
  const existingHistory = z.array(historyRowSchema).parse(existingHistoryRaw);
  const peopleMap = await loadPeopleMap(dataDirectory);

  const conduit = createConduitClient({
    endpoint: 'https://phabricator.services.mozilla.com/api',
    apiToken: requireEnv('PHABRICATOR_TOKEN'),
  });
  const gh = createGithubClient(requireEnv('GH_PAT'));

  const { samples, pending, history } = await collect({
    existingSamples,
    existingHistory,
    peopleMap,
    fetchPhab: (lookbackDays) =>
      fetchPhabSamples({
        client: conduit,
        projectSlugs: (process.env.PHAB_PROJECT_SLUGS ?? 'home-newtab-reviewers')
          .split(',')
          .map((slug) => slug.trim())
          .filter((slug) => slug.length > 0),
        lookbackDays,
      }),
    fetchGithub: (lookbackDays) =>
      fetchGithubSamples({
        client: gh,
        owner: 'Pocket',
        repo: 'content-monorepo',
        lookbackDays,
      }),
  });

  await writeJsonFile(samplesPath, samples);
  await writeJsonFile(historyPath, history);
  await writeJsonFile(pendingPath, pending);
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
