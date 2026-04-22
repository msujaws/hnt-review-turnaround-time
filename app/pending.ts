import path from 'node:path';

import { z } from 'zod';

import { pendingSampleSchema, type PendingSample } from '../src/scripts/collect';
import { readValidatedJsonFile } from '../src/scripts/jsonFile';

export const loadPending = async (): Promise<PendingSample[]> =>
  readValidatedJsonFile(
    path.join(process.cwd(), 'data', 'pending.json'),
    z.array(pendingSampleSchema),
    [],
  );
