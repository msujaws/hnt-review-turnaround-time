import path from 'node:path';

import { z } from 'zod';

import { sampleSchema, type Sample } from '../src/scripts/collect';
import { readValidatedJsonFile } from '../src/scripts/jsonFile';

export const loadSamples = async (): Promise<Sample[]> =>
  readValidatedJsonFile(
    path.join(process.cwd(), 'data', 'samples.json'),
    z.array(sampleSchema),
    [],
  );
