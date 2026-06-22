import path from 'node:path';

import { z } from 'zod';

import { sampleSchema, type Sample } from '../src/scripts/collect';
import { readValidatedJsonFile } from '../src/scripts/jsonFile';

export const loadSamples = async (dataDirectory: string): Promise<Sample[]> =>
  readValidatedJsonFile(path.join(dataDirectory, 'samples.json'), z.array(sampleSchema), []);
