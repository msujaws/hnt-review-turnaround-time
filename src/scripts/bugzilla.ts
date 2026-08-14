import { z } from 'zod';

import { BUGZILLA_ORIGIN } from '../config';
import { asBugNumber, asIsoTimestamp, type BugNumber, type IsoTimestamp } from '../types/brand';

// One bug that reached RESOLVED FIXED (or VERIFIED FIXED — same resolution,
// different status). The days-to-fix value is deliberately not stored: it is
// derived at window time in collect(), the same way tatBusinessHours and the
// landing business-hours fields are recomputed on every merge.
export interface BugSample {
  readonly source: 'bugzilla';
  readonly id: BugNumber;
  readonly summary: string;
  readonly product: string;
  readonly component: string;
  readonly filedAt: IsoTimestamp;
  readonly resolvedAt: IsoTimestamp;
}

// Which slice of Bugzilla a group owns. `components` omitted or empty means the
// whole product — that is how GeckoView is configured, and it picks up IME and
// PDF Viewer bugs a hand-listed component set would miss.
export interface BugzillaScope {
  readonly product: string;
  readonly components?: readonly string[] | undefined;
}

// Param pairs rather than a Record because BMO expects repeated `component=`
// keys for a multi-component query, which an object cannot express.
export type BugzillaSearchParams = readonly (readonly [string, string])[];

// One GET against a BMO REST resource (`bug`, `product`). Kept path-generic
// because scope validation needs `product` alongside the `bug` search.
export interface BugzillaClient {
  readonly get: (path: string, params: BugzillaSearchParams) => Promise<unknown>;
}

// BMO caps an unbounded `limit=0` at its own discretion, so page explicitly.
const PAGE_SIZE = 500;

// Hard stop at 10k bugs per scope. Measured volume is 35-424 fixed bugs per
// group per 90 days, so reaching this means the query or the response shape is
// wrong, not that a team got busy. Throwing beats truncating: a silently short
// result set would skew the median with no signal that it happened.
const MAX_PAGES = 20;

const INCLUDE_FIELDS = 'id,summary,product,component,creation_time,cf_last_resolved';

// Field names are BMO's, snake_case included.
const bugRowSchema = z.object({
  id: z.number().int().positive(),
  summary: z.string(),
  product: z.string(),
  component: z.string(),
  creation_time: z.string(),
  // Absent on a bug that has never been resolved, and null on a few rows BMO
  // predates the field on. Either way there is no fix timestamp to measure to.
  cf_last_resolved: z.string().nullish(),
});

const bugSearchSchema = z.object({ bugs: z.array(bugRowSchema) });

// Some BMO failures report themselves in the body rather than only the status.
// Note this does NOT cover a bad product or component — see assertScopeExists.
const bugErrorSchema = z.object({ error: z.literal(true), message: z.string() });

const productSchema = z.object({
  products: z.array(
    z.object({ name: z.string(), components: z.array(z.object({ name: z.string() })) }),
  ),
});

type BugRow = z.infer<typeof bugRowSchema>;

const scopeLabel = (scope: BugzillaScope): string => {
  const components = scope.components ?? [];
  return components.length === 0 ? scope.product : `${scope.product} :: ${components.join(', ')}`;
};

// BMO's `greaterthan` on cf_last_resolved takes a bare YYYY-MM-DD date.
const cutoffDate = (now: Date, lookbackDays: number): string =>
  new Date(now.getTime() - lookbackDays * 86_400 * 1000).toISOString().slice(0, 10);

const paramsForScope = (
  scope: BugzillaScope,
  cutoff: string,
  offset: number,
): BugzillaSearchParams => {
  const params: (readonly [string, string])[] = [['product', scope.product]];
  for (const component of scope.components ?? []) params.push(['component', component]);
  params.push(
    ['resolution', 'FIXED'],
    ['f1', 'cf_last_resolved'],
    ['o1', 'greaterthan'],
    ['v1', cutoff],
    ['include_fields', INCLUDE_FIELDS],
    ['limit', String(PAGE_SIZE)],
    ['offset', String(offset)],
  );
  return params;
};

// BMO answers a nonexistent product OR component with HTTP 200 and an empty bug
// list — there is no error status and no error body to catch. Left unchecked, a
// renamed component makes a group report zero fixed bugs indefinitely and
// nothing anywhere says why. So resolve every configured scope against the
// product's real component list first and fail loudly on a mismatch. One extra
// request per scope per run, against a metric that otherwise cannot tell
// "nothing was fixed" apart from "this query has been broken for months".
export const assertScopeExists = async (
  client: BugzillaClient,
  scope: BugzillaScope,
): Promise<void> => {
  const raw = await client.get('product', [
    ['names', scope.product],
    ['include_fields', 'name,components.name'],
  ]);
  const product = productSchema.parse(raw).products[0];
  if (product === undefined) {
    throw new Error(`Bugzilla product "${scope.product}" does not exist`);
  }
  const known = new Set(product.components.map((component) => component.name));
  const missing = (scope.components ?? []).filter((component) => !known.has(component));
  if (missing.length > 0) {
    throw new Error(
      `Bugzilla product "${scope.product}" has no component(s) ${missing.map((c) => `"${c}"`).join(', ')}` +
        ` — it was probably renamed. Known components: ${[...known].sort().join(', ')}`,
    );
  }
};

// Null when the bug has no fix timestamp, or when the timestamps disagree about
// causality (resolved at or before filed). Both are dropped rather than clamped
// to zero, so they don't drag the median toward a fix time that never happened.
const toBugSample = (row: BugRow): BugSample | null => {
  const resolved = row.cf_last_resolved;
  if (resolved === undefined || resolved === null || resolved.length === 0) return null;
  const filedAt = asIsoTimestamp(row.creation_time);
  const resolvedAt = asIsoTimestamp(resolved);
  if (Date.parse(resolvedAt) <= Date.parse(filedAt)) return null;
  return {
    source: 'bugzilla',
    id: asBugNumber(row.id),
    summary: row.summary,
    product: row.product,
    component: row.component,
    filedAt,
    resolvedAt,
  };
};

const fetchScopeRows = async (
  client: BugzillaClient,
  scope: BugzillaScope,
  cutoff: string,
): Promise<BugRow[]> => {
  const rows: BugRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const raw = await client.get('bug', paramsForScope(scope, cutoff, page * PAGE_SIZE));
    const failure = bugErrorSchema.safeParse(raw);
    if (failure.success) {
      throw new Error(`Bugzilla search for ${scopeLabel(scope)} failed: ${failure.data.message}`);
    }
    const bugs = bugSearchSchema.parse(raw).bugs;
    rows.push(...bugs);
    if (bugs.length < PAGE_SIZE) return rows;
  }
  throw new Error(
    `Bugzilla search for ${scopeLabel(scope)} exceeded ${String(MAX_PAGES * PAGE_SIZE)} bugs; ` +
      'refusing to truncate a result set the median would be computed from',
  );
};

// One query per scope, deduped by bug id so an overlapping whole-product and
// per-component scope pair can't double-count a bug into the median.
export const fetchBugSamples = async (params: {
  readonly client: BugzillaClient;
  readonly scopes: readonly BugzillaScope[];
  readonly lookbackDays: number;
  readonly now?: Date;
}): Promise<{ samples: BugSample[] }> => {
  const { client, scopes, lookbackDays } = params;
  const cutoff = cutoffDate(params.now ?? new Date(), lookbackDays);
  const byId = new Map<number, BugSample>();
  for (const scope of scopes) {
    await assertScopeExists(client, scope);
    for (const row of await fetchScopeRows(client, scope, cutoff)) {
      const sample = toBugSample(row);
      if (sample !== null && !byId.has(sample.id)) byId.set(sample.id, sample);
    }
  }
  return { samples: [...byId.values()] };
};

export const createBugzillaClient = (
  options: {
    readonly origin?: string;
    readonly fetchFn?: typeof fetch;
  } = {},
): BugzillaClient => {
  const origin = options.origin ?? BUGZILLA_ORIGIN;
  const fetchFn = options.fetchFn ?? fetch;
  return {
    get: async (path, params) => {
      const query = new URLSearchParams();
      for (const [key, value] of params) query.append(key, value);
      const response = await fetchFn(`${origin}/rest/${path}?${query.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(
          `Bugzilla ${path} request failed with status ${String(response.status)} ${response.statusText}`,
        );
      }
      return (await response.json()) as unknown;
    },
  };
};
