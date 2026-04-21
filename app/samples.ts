import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Sample } from '../src/scripts/collect';

export const loadSamples = async (): Promise<Sample[]> => {
  const filePath = path.join(process.cwd(), 'data', 'samples.json');
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    return JSON.parse(contents) as Sample[];
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};
