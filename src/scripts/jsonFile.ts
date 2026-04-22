import { promises as fs } from 'node:fs';
import path from 'node:path';

const isNodeErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

// Read raw JSON. ENOENT returns `fallback`; all other read/parse errors
// bubble — the caller decides what "file exists but is unreadable" means.
export const readJsonFile = async <T>(filePath: string, fallback: T): Promise<T> => {
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

// Atomic JSON write: full contents land in a sibling `.tmp` file, then a
// single rename swaps it over the target. rename(2) is atomic on POSIX, so
// readers either see the pre-write contents or the post-write contents —
// never a half-flushed payload. A crash mid-write leaves the original file
// intact and at worst a stray `.tmp` sibling on disk.
export const writeJsonFileAtomic = async (filePath: string, data: unknown): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, filePath);
};
