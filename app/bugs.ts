import path from 'node:path';

import { z } from 'zod';

import { bugSampleSchema, type BugSample } from '../src/scripts/collect';
import { readValidatedJsonFile } from '../src/scripts/jsonFile';

export const loadBugs = async (dataDirectory: string): Promise<BugSample[]> =>
  readValidatedJsonFile(path.join(dataDirectory, 'bugs.json'), z.array(bugSampleSchema), []);
