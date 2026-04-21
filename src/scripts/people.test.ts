import { describe, expect, it } from 'vitest';

import { asIanaTimezone } from '../types/brand';

import { parsePeopleMap, timezoneForReviewer } from './people';

describe('parsePeopleMap', () => {
  it('parses a valid nested map', () => {
    const raw = {
      github: { jpetto: 'America/Chicago' },
      phab: { maxx: 'America/Chicago' },
    };
    const map = parsePeopleMap(raw);
    expect(map.github.jpetto).toBe('America/Chicago');
    expect(map.phab.maxx).toBe('America/Chicago');
  });

  it('rejects an unknown timezone string', () => {
    expect(() => parsePeopleMap({ github: { jpetto: 'Not/AZone' }, phab: {} })).toThrow(
      /timezone/i,
    );
  });

  it('defaults missing sections to empty', () => {
    const map = parsePeopleMap({});
    expect(map.github).toEqual({});
    expect(map.phab).toEqual({});
  });
});

describe('timezoneForReviewer', () => {
  const map = {
    github: { jpetto: asIanaTimezone('America/Chicago') },
    phab: { maxx: asIanaTimezone('America/Chicago') },
  };

  it('returns the mapped timezone for a known reviewer', () => {
    expect(timezoneForReviewer(map, 'github', 'jpetto')).toBe('America/Chicago');
    expect(timezoneForReviewer(map, 'phab', 'maxx')).toBe('America/Chicago');
  });

  it('falls back to America/New_York for an unknown reviewer', () => {
    expect(timezoneForReviewer(map, 'github', 'unknown-user')).toBe('America/New_York');
    expect(timezoneForReviewer(map, 'phab', 'also-unknown')).toBe('America/New_York');
  });

  it('does not cross sources', () => {
    // jpetto is a GitHub login, not a Phab username → fallback.
    expect(timezoneForReviewer(map, 'phab', 'jpetto')).toBe('America/New_York');
  });
});
