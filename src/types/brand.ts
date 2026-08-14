import { z } from 'zod';

declare const __brand: unique symbol;
export type Brand<T, B> = T & { readonly [__brand]: B };

export type RevisionPhid = Brand<string, 'RevisionPhid'>;
export type PrNumber = Brand<number, 'PrNumber'>;
export type ReviewerLogin = Brand<string, 'ReviewerLogin'>;
export type BusinessHours = Brand<number, 'BusinessHours'>;
export type CalendarDays = Brand<number, 'CalendarDays'>;
export type BugNumber = Brand<number, 'BugNumber'>;
export type IsoTimestamp = Brand<string, 'IsoTimestamp'>;
export type IanaTimezone = Brand<string, 'IanaTimezone'>;
export type GroupId = Brand<string, 'GroupId'>;
export type GithubRepoSlug = Brand<string, 'GithubRepoSlug'>;

const revisionPhidSchema = z.string().regex(/^PHID-DREV-[a-z0-9]{20}$/, 'invalid revision PHID');

const prNumberSchema = z.number().int().positive();

const reviewerLoginSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'must not be whitespace-only');

const businessHoursSchema = z.number().finite().nonnegative();

// Wall-clock days, used by the bug filed-to-fixed metric. Numerically identical
// to BusinessHours but deliberately a separate brand: bug lifetimes are not
// clipped to 9-5 weekdays, and a value of 47 means seven weeks here versus six
// working days there. Keeping them distinct stops the two from being swapped
// into each other's formatters or stat thresholds.
const calendarDaysSchema = z.number().finite().nonnegative();

const bugNumberSchema = z.number().int().positive();

const isoTimestampSchema = z.string().refine((value) => {
  if (value.length === 0) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}, 'invalid ISO timestamp');

export const asRevisionPhid = (value: string): RevisionPhid =>
  revisionPhidSchema.parse(value) as RevisionPhid;

export const asPrNumber = (value: number): PrNumber => prNumberSchema.parse(value) as PrNumber;

export const asReviewerLogin = (value: string): ReviewerLogin =>
  reviewerLoginSchema.parse(value) as ReviewerLogin;

export const asBusinessHours = (value: number): BusinessHours =>
  businessHoursSchema.parse(value) as BusinessHours;

export const asCalendarDays = (value: number): CalendarDays =>
  calendarDaysSchema.parse(value) as CalendarDays;

export const asBugNumber = (value: number): BugNumber => bugNumberSchema.parse(value) as BugNumber;

export const asIsoTimestamp = (value: string): IsoTimestamp =>
  isoTimestampSchema.parse(value) as IsoTimestamp;

const ianaTimezoneSchema = z.string().refine((value) => {
  if (value.length === 0) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'invalid IANA timezone');

export const asIanaTimezone = (value: string): IanaTimezone =>
  ianaTimezoneSchema.parse(value) as IanaTimezone;

// A review-group identifier: a URL-safe slug used both as the dropdown route
// segment and the per-group data directory name. Membership in the known set
// lives in src/groups.ts (getGroup); this only enforces the slug shape so the
// brand stays free of a circular import on the registry.
const groupIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, 'invalid group id');

export const asGroupId = (value: string): GroupId => groupIdSchema.parse(value) as GroupId;

// A GitHub repository identifier in `owner/repo` form (e.g.
// `Pocket/content-monorepo`). Case is preserved because it feeds PR URLs;
// display labels lowercase it separately. Exactly one slash, both segments
// non-empty and whitespace-free.
const githubRepoSlugSchema = z
  .string()
  .regex(/^[^\s/]+\/[^\s/]+$/, 'invalid GitHub repo slug (expected owner/repo)');

export const asGithubRepoSlug = (value: string): GithubRepoSlug =>
  githubRepoSlugSchema.parse(value) as GithubRepoSlug;
