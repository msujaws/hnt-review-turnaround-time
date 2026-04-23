import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProgressWriter, type CollectProgress } from './collectProgress';

describe('createProgressWriter', () => {
  let temporaryDirectory: string;
  let progressPath: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'collect-progress-'));
    progressPath = path.join(temporaryDirectory, '.collect-progress.json');
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  const readProgress = async (): Promise<CollectProgress> =>
    JSON.parse(await fs.readFile(progressPath, 'utf8')) as CollectProgress;

  it('writes the initial state on the first update, with startedAt fixed to the constructor arg', async () => {
    const writer = createProgressWriter(progressPath, new Date('2026-04-23T14:00:00.000Z'));
    await writer.update((state) => {
      state.phase = 'init';
      state.message = 'starting';
    }, new Date('2026-04-23T14:00:00.000Z'));
    const persisted = await readProgress();
    expect(persisted.startedAt).toBe('2026-04-23T14:00:00.000Z');
    expect(persisted.lastUpdated).toBe('2026-04-23T14:00:00.000Z');
    expect(persisted.phase).toBe('init');
    expect(persisted.message).toBe('starting');
    expect(persisted.phab).toEqual({
      revisionsProcessed: 0,
      revisionsFetched: 0,
      revisionsTotal: null,
    });
    expect(persisted.github).toEqual({ prsProcessed: null });
  });

  it('advances lastUpdated on each update without moving startedAt', async () => {
    const writer = createProgressWriter(progressPath, new Date('2026-04-23T14:00:00.000Z'));
    await writer.update((state) => {
      state.phase = 'init';
    }, new Date('2026-04-23T14:00:00.000Z'));
    await writer.update((state) => {
      state.phase = 'phab-transactions';
    }, new Date('2026-04-23T14:05:30.000Z'));
    const persisted = await readProgress();
    expect(persisted.startedAt).toBe('2026-04-23T14:00:00.000Z');
    expect(persisted.lastUpdated).toBe('2026-04-23T14:05:30.000Z');
    expect(persisted.phase).toBe('phab-transactions');
  });

  it('accumulates numeric counters across successive updates', async () => {
    const writer = createProgressWriter(progressPath, new Date('2026-04-23T14:00:00.000Z'));
    for (let index = 0; index < 3; index += 1) {
      await writer.update((state) => {
        state.phab.revisionsProcessed += 1;
        state.phab.revisionsFetched += 1;
      }, new Date('2026-04-23T14:00:00.000Z'));
    }
    const persisted = await readProgress();
    expect(persisted.phab.revisionsProcessed).toBe(3);
    expect(persisted.phab.revisionsFetched).toBe(3);
  });

  it('snapshot returns a deep copy that does not reflect later updates', async () => {
    const writer = createProgressWriter(progressPath, new Date('2026-04-23T14:00:00.000Z'));
    await writer.update((state) => {
      state.phab.revisionsProcessed = 5;
    }, new Date('2026-04-23T14:00:00.000Z'));
    const snapshot = writer.snapshot();
    await writer.update((state) => {
      state.phab.revisionsProcessed = 12;
    }, new Date('2026-04-23T14:01:00.000Z'));
    expect(snapshot.phab.revisionsProcessed).toBe(5);
    expect(writer.snapshot().phab.revisionsProcessed).toBe(12);
  });

  it('writes valid JSON parsable as CollectProgress', async () => {
    const writer = createProgressWriter(progressPath, new Date('2026-04-23T14:00:00.000Z'));
    await writer.update((state) => {
      state.phase = 'done';
      state.message = 'completed';
      state.phab.revisionsTotal = 200;
    }, new Date('2026-04-23T14:45:00.000Z'));
    const contents = await fs.readFile(progressPath, 'utf8');
    const parsed = JSON.parse(contents) as CollectProgress;
    expect(parsed.phase).toBe('done');
    expect(parsed.phab.revisionsTotal).toBe(200);
  });
});
