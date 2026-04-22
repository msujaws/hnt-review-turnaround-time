import path from 'node:path';

import { z } from 'zod';

import { historyRowSchema, type HistoryRow } from '../src/scripts/collect';
import { readValidatedJsonFile } from '../src/scripts/jsonFile';

export const loadHistory = async (): Promise<HistoryRow[]> =>
  readValidatedJsonFile(
    path.join(process.cwd(), 'data', 'history.json'),
    z.array(historyRowSchema),
    [],
  );
