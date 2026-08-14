import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadBugs } from './bugs';

let dataDirectory: string;

beforeEach(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'bugs-loader-'));
});

afterEach(async () => {
  await fs.rm(dataDirectory, { recursive: true, force: true });
});

const write = async (contents: unknown): Promise<void> => {
  await fs.writeFile(path.join(dataDirectory, 'bugs.json'), JSON.stringify(contents), 'utf8');
};

describe('loadBugs', () => {
  // A group whose first collect hasn't run yet has no bugs.json. The panel must
  // render empty rather than crashing the page.
  it('returns an empty list when the file is missing', async () => {
    await expect(loadBugs(dataDirectory)).resolves.toEqual([]);
  });

  it('parses and brands a persisted bug row', async () => {
    await write([
      {
        source: 'bugzilla',
        id: 2_036_233,
        summary: 'Sports widget',
        product: 'Firefox',
        component: 'New Tab Page',
        filedAt: '2026-04-14T00:00:00Z',
        resolvedAt: '2026-04-20T00:00:00Z',
      },
    ]);
    const bugs = await loadBugs(dataDirectory);
    expect(bugs).toHaveLength(1);
    expect(bugs[0]?.id).toBe(2_036_233);
    expect(bugs[0]?.resolvedAt).toBe('2026-04-20T00:00:00Z');
  });

  it('throws on a malformed row rather than silently dropping it', async () => {
    await write([{ source: 'bugzilla', id: 1 }]);
    await expect(loadBugs(dataDirectory)).rejects.toThrow();
  });
});
