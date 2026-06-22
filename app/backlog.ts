import path from 'node:path';

import { z } from 'zod';

import { backlogSnapshotSchema, type BacklogSnapshot } from '../src/scripts/collect';
import { readValidatedJsonFile } from '../src/scripts/jsonFile';

export const loadBacklog = async (dataDirectory: string): Promise<BacklogSnapshot[]> =>
  readValidatedJsonFile(
    path.join(dataDirectory, 'backlog.json'),
    z.array(backlogSnapshotSchema),
    [],
  );
