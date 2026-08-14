// One-shot: retro-fill history.json's bugFix key from bugs.json.
//
// This is possible only because bug windows are anchored on resolvedAt and
// bugs.json holds the entire 90-day resolved set — so any past day's windows are
// exactly recomputable, with no lost state. That is not true of the review
// metrics: their windows need the per-day pending state that was never recorded,
// which is why there is no equivalent script for them.
//
// Without this, the bug trendline would show a flat zero line for every existing
// history row and a single real point at the right edge, because buildChartData
// plots a missing key as zero. Run it once per group after the first real
// collect; re-running is safe and also repairs the pctUnderSLA series if
// FIXED_WITHIN_DAYS is ever changed.

import path from 'node:path';

import { DateTime } from 'luxon';
import { z } from 'zod';

import { ET_ZONE, FIXED_WITHIN_DAYS } from '../config';
import { allGroups, dataDirectoryForGroup, getGroup } from '../groups';

import type { BugSample } from './bugzilla';
import {
  bugFixWindows,
  bugSampleSchema,
  historyRowSchema,
  RETENTION_DAYS,
  type HistoryRow,
  WINDOW_30_DAYS,
} from './collect';
import { readJsonFile, writeJsonFileAtomic } from './jsonFile';

// A row's widest window is 30 days, and bugs.json reaches back RETENTION_DAYS.
// So a row can only be computed in full if it is itself no older than the
// difference. Anything older would produce a number that looks authoritative
// but was computed from a truncated bug set, which is worse than an absent key.
const COVERAGE_DAYS = RETENTION_DAYS - WINDOW_30_DAYS;

export const isRowFullyCovered = (date: string, now: Date): boolean => {
  const rowDay = DateTime.fromISO(date, { zone: ET_ZONE }).startOf('day');
  if (!rowDay.isValid) return false;
  const earliest = DateTime.fromJSDate(now, { zone: ET_ZONE })
    .startOf('day')
    .minus({ days: COVERAGE_DAYS });
  return rowDay >= earliest;
};

// Each row is computed against the end of its own ET day, matching how
// GroupView anchors `dashboardNow` on the latest snapshot's end of day.
const rowAnchor = (date: string): Date =>
  DateTime.fromISO(date, { zone: ET_ZONE }).endOf('day').toJSDate();

export const backfillBugHistory = (
  history: readonly HistoryRow[],
  bugs: readonly BugSample[],
  now: Date,
  fixedWithinDays: number,
): HistoryRow[] =>
  history.map((row) =>
    isRowFullyCovered(row.date, now)
      ? { ...row, bugFix: bugFixWindows(bugs, rowAnchor(row.date), fixedWithinDays) }
      : row,
  );

export const runBackfillBugHistory = async (dataDirectory: string): Promise<number> => {
  const historyPath = path.join(dataDirectory, 'history.json');
  const bugsPath = path.join(dataDirectory, 'bugs.json');
  const history = z.array(historyRowSchema).parse(await readJsonFile<unknown>(historyPath, []));
  const bugs = z.array(bugSampleSchema).parse(await readJsonFile<unknown>(bugsPath, []));
  if (bugs.length === 0) {
    process.stderr.write(`${dataDirectory}: no bugs.json yet — run collect first\n`);
    return 0;
  }
  const filled = backfillBugHistory(history, bugs, new Date(), FIXED_WITHIN_DAYS);
  await writeJsonFileAtomic(historyPath, filled);
  return filled.filter((row) => row.bugFix !== undefined).length;
};

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  const requested = process.argv.slice(2);
  const groups =
    requested.length === 0
      ? allGroups()
      : requested.map((id) => {
          const group = getGroup(id);
          if (group === undefined) throw new Error(`unknown group id "${id}"`);
          return group;
        });
  for (const group of groups) {
    const filled = await runBackfillBugHistory(dataDirectoryForGroup(group.id));
    process.stdout.write(`${group.id}: ${filled.toString()} history rows carry bugFix\n`);
  }
}
