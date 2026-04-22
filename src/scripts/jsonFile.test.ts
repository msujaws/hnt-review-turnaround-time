import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readJsonFile, writeJsonFileAtomic } from './jsonFile';

let tmpdir: string;

beforeEach(async () => {
  tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'hnt-json-'));
});

afterEach(async () => {
  await fs.rm(tmpdir, { recursive: true, force: true });
});

describe('writeJsonFileAtomic', () => {
  it('writes pretty-printed JSON with a trailing newline', async () => {
    const target = path.join(tmpdir, 'out.json');
    await writeJsonFileAtomic(target, { n: 1 });
    const contents = await fs.readFile(target, 'utf8');
    expect(contents).toBe(`${JSON.stringify({ n: 1 }, null, 2)}\n`);
  });

  it('creates the parent directory if it does not exist', async () => {
    const target = path.join(tmpdir, 'nested', 'deep', 'out.json');
    await writeJsonFileAtomic(target, { ok: true });
    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ ok: true });
  });

  it('leaves the prior file intact when the rename step fails', async () => {
    const target = path.join(tmpdir, 'out.json');
    await fs.writeFile(target, `${JSON.stringify({ old: true })}\n`, 'utf8');
    const renameSpy = vi
      .spyOn(fs, 'rename')
      .mockRejectedValueOnce(new Error('simulated mid-write crash'));
    await expect(writeJsonFileAtomic(target, { new: true })).rejects.toThrow(
      'simulated mid-write crash',
    );
    const after = JSON.parse(await fs.readFile(target, 'utf8')) as unknown;
    expect(after).toEqual({ old: true });
    renameSpy.mockRestore();
  });

  it('does not leave a half-written target if the write step fails', async () => {
    const target = path.join(tmpdir, 'out.json');
    await fs.writeFile(target, `${JSON.stringify({ old: true })}\n`, 'utf8');
    const writeSpy = vi
      .spyOn(fs, 'writeFile')
      .mockRejectedValueOnce(new Error('simulated disk full'));
    await expect(writeJsonFileAtomic(target, { new: true })).rejects.toThrow('simulated disk full');
    const after = JSON.parse(await fs.readFile(target, 'utf8')) as unknown;
    expect(after).toEqual({ old: true });
    writeSpy.mockRestore();
  });
});

describe('readJsonFile', () => {
  it('returns the fallback when the file does not exist', async () => {
    const missing = path.join(tmpdir, 'missing.json');
    const result = await readJsonFile(missing, { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

  it('parses and returns the JSON contents when the file exists', async () => {
    const target = path.join(tmpdir, 'data.json');
    await fs.writeFile(target, '{"answer":42}\n', 'utf8');
    const result = await readJsonFile<{ answer: number }>(target, { answer: 0 });
    expect(result).toEqual({ answer: 42 });
  });

  it('rethrows errors other than ENOENT', async () => {
    await expect(readJsonFile(tmpdir, null)).rejects.toBeInstanceOf(Error);
  });
});
