import { z } from 'zod';

declare const __brand: unique symbol;
export type Brand<T, B> = T & { readonly [__brand]: B };

export type RevisionPhid = Brand<string, 'RevisionPhid'>;
export type PrNumber = Brand<number, 'PrNumber'>;
export type ReviewerLogin = Brand<string, 'ReviewerLogin'>;
export type BusinessHours = Brand<number, 'BusinessHours'>;
export type IsoTimestamp = Brand<string, 'IsoTimestamp'>;
export type IanaTimezone = Brand<string, 'IanaTimezone'>;

const revisionPhidSchema = z.string().regex(/^PHID-DREV-[a-z0-9]{20}$/, 'invalid revision PHID');

const prNumberSchema = z.number().int().positive();

const reviewerLoginSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'must not be whitespace-only');

const businessHoursSchema = z.number().finite().nonnegative();

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
