import { promises as fs } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { sampleSchema, type Sample } from '../src/scripts/collect';

export const loadSamples = async (): Promise<Sample[]> => {
  const filePath = path.join(process.cwd(), 'data', 'samples.json');
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    return z.array(sampleSchema).parse(JSON.parse(contents));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};
