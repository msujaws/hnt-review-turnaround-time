import path from 'node:path';

import { z } from 'zod';

import { backlogSnapshotSchema, type BacklogSnapshot } from '../src/scripts/collect';
import { readValidatedJsonFile } from '../src/scripts/jsonFile';

export const loadBacklog = async (): Promise<BacklogSnapshot[]> =>
  readValidatedJsonFile(
    path.join(process.cwd(), 'data', 'backlog.json'),
    z.array(backlogSnapshotSchema),
    [],
  );
