import { promises as fs } from 'node:fs';
import path from 'node:path';

import { DateTime } from 'luxon';

import { asBusinessHours, type BusinessHours } from '../types/brand';

import { businessHoursBetween } from './businessHours';
import { createGithubClient, fetchGithubSamples, type GithubSample } from './github';
import { createConduitClient, fetchPhabSamples, type PhabSample } from './phabricator';
import { computeStats, type WindowStats } from './stats';

const SLA_HOURS = 4;
const RETENTION_DAYS = 60;
const FOLLOWUP_LOOKBACK_DAYS = 3;
const BACKFILL_LOOKBACK_DAYS = 21;
const WINDOW_7_DAYS = 7;
const WINDOW_14_DAYS = 14;
const ET_ZONE = 'America/New_York';

export type Sample =
  | (PhabSample & { readonly tatBusinessHours: BusinessHours })
  | (GithubSample & { readonly tatBusinessHours: BusinessHours });

export interface HistoryRow {
  readonly date: string;
  readonly phab: { readonly window7d: WindowStats; readonly window14d: WindowStats };
  readonly github: { readonly window7d: WindowStats; readonly window14d: WindowStats };
}

const sampleKey = (sample: { source: string; id: unknown; reviewer: string }): string =>
  `${sample.source}:${String(sample.id)}:${sample.reviewer}`;

const withTat = <T extends PhabSample | GithubSample>(
  sample: T,
): T & { tatBusinessHours: BusinessHours } => ({
  ...sample,
  tatBusinessHours: businessHoursBetween(sample.requestedAt, sample.firstActionAt),
});

const filterWithin = (
  samples: readonly Sample[],
  windowDays: number,
  now: Date,
): BusinessHours[] => {
  const cutoffMs = now.getTime() - windowDays * 86_400 * 1000;
  return samples
    .filter((s) => Date.parse(s.requestedAt) >= cutoffMs)
    .map((s) => s.tatBusinessHours);
};

export const collect = async (options: {
  readonly existingSamples: readonly Sample[];
  readonly existingHistory: readonly HistoryRow[];
  readonly fetchPhab: (lookbackDays: number) => Promise<readonly PhabSample[]>;
  readonly fetchGithub: (lookbackDays: number) => Promise<readonly GithubSample[]>;
  readonly now?: Date;
  readonly slaHours?: number;
}): Promise<{
  readonly samples: Sample[];
  readonly history: HistoryRow[];
  readonly lookbackDays: number;
}> => {
  const now = options.now ?? new Date();
  const slaHours = options.slaHours ?? SLA_HOURS;
  const lookbackDays =
    options.existingSamples.length === 0 ? BACKFILL_LOOKBACK_DAYS : FOLLOWUP_LOOKBACK_DAYS;

  const [phabSamples, ghSamples] = await Promise.all([
    options.fetchPhab(lookbackDays),
    options.fetchGithub(lookbackDays),
  ]);

  const merged = new Map<string, Sample>();
  for (const fresh of phabSamples) {
    merged.set(sampleKey(fresh), withTat(fresh));
  }
  for (const fresh of ghSamples) {
    merged.set(sampleKey(fresh), withTat(fresh));
  }
  for (const existing of options.existingSamples) {
    merged.set(sampleKey(existing), existing);
  }

  const retentionCutoff = now.getTime() - RETENTION_DAYS * 86_400 * 1000;
  const samples = [...merged.values()].filter((s) => Date.parse(s.requestedAt) >= retentionCutoff);

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
      window7d: computeStats(
        filterWithin(phabSeries, WINDOW_7_DAYS, now).map((value) => asBusinessHours(value)),
        slaHours,
      ),
      window14d: computeStats(
        filterWithin(phabSeries, WINDOW_14_DAYS, now).map((value) => asBusinessHours(value)),
        slaHours,
      ),
    },
    github: {
      window7d: computeStats(
        filterWithin(ghSeries, WINDOW_7_DAYS, now).map((value) => asBusinessHours(value)),
        slaHours,
      ),
      window14d: computeStats(
        filterWithin(ghSeries, WINDOW_14_DAYS, now).map((value) => asBusinessHours(value)),
        slaHours,
      ),
    },
  };

  const historyWithoutToday = options.existingHistory.filter((row) => row.date !== todayEt);
  const history = [...historyWithoutToday, todayRow].sort((a, b) => a.date.localeCompare(b.date));

  return { samples, history, lookbackDays };
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

  const existingSamples = await readJsonFile<Sample[]>(samplesPath, []);
  const existingHistory = await readJsonFile<HistoryRow[]>(historyPath, []);

  const conduit = createConduitClient({
    endpoint: 'https://phabricator.services.mozilla.com/api',
    apiToken: requireEnv('PHABRICATOR_TOKEN'),
  });
  const gh = createGithubClient(requireEnv('GITHUB_PAT'));

  const { samples, history } = await collect({
    existingSamples,
    existingHistory,
    fetchPhab: (lookbackDays) =>
      fetchPhabSamples({
        client: conduit,
        projectSlug: 'home-newtab-reviewers',
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
