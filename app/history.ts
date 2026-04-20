import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { HistoryRow } from '../src/scripts/collect';

export const loadHistory = async (): Promise<HistoryRow[]> => {
  const filePath = path.join(process.cwd(), 'data', 'history.json');
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    return JSON.parse(contents) as HistoryRow[];
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};
