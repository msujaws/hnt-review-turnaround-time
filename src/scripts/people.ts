import { promises as fs } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { asIanaTimezone, type IanaTimezone } from '../types/brand';

export type SourceKind = 'github' | 'phab';

export interface PeopleMap {
  readonly github: Readonly<Record<string, IanaTimezone>>;
  readonly phab: Readonly<Record<string, IanaTimezone>>;
}

const DEFAULT_FALLBACK_TIMEZONE = asIanaTimezone('America/New_York');

const timezoneRecordSchema = z.record(z.string()).transform((record) => {
  const entries = Object.entries(record).map(([login, zone]) => [login, asIanaTimezone(zone)]);
  return Object.fromEntries(entries) as Record<string, IanaTimezone>;
});

const peopleMapSchema = z.object({
  github: timezoneRecordSchema.optional(),
  phab: timezoneRecordSchema.optional(),
});

export const parsePeopleMap = (raw: unknown): PeopleMap => {
  const parsed = peopleMapSchema.parse(raw);
  return {
    github: parsed.github ?? {},
    phab: parsed.phab ?? {},
  };
};

export const EMPTY_PEOPLE_MAP: PeopleMap = { github: {}, phab: {} };

export const loadPeopleMap = async (dataDirectory: string): Promise<PeopleMap> => {
  const filePath = path.join(dataDirectory, 'people.json');
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    return parsePeopleMap(JSON.parse(contents));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return EMPTY_PEOPLE_MAP;
    }
    throw error;
  }
};

export const timezoneForReviewer = (
  map: PeopleMap,
  source: SourceKind,
  reviewer: string,
): IanaTimezone => map[source][reviewer] ?? DEFAULT_FALLBACK_TIMEZONE;
