import { promises as fs } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { pendingSampleSchema, type PendingSample } from '../src/scripts/collect';

export const loadPending = async (): Promise<PendingSample[]> => {
  const filePath = path.join(process.cwd(), 'data', 'pending.json');
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    return z.array(pendingSampleSchema).parse(JSON.parse(contents));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};
