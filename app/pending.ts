import path from 'node:path';

import { z } from 'zod';

import { pendingSampleSchema, type PendingSample } from '../src/scripts/collect';
import { readValidatedJsonFile } from '../src/scripts/jsonFile';

export const loadPending = async (dataDirectory: string): Promise<PendingSample[]> =>
  readValidatedJsonFile(path.join(dataDirectory, 'pending.json'), z.array(pendingSampleSchema), []);
