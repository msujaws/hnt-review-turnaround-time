import path from 'node:path';

import { z } from 'zod';

import { landingSchema, type Landing } from '../src/scripts/collect';
import { readValidatedJsonFile } from '../src/scripts/jsonFile';

export const loadLandings = async (): Promise<Landing[]> =>
  readValidatedJsonFile(
    path.join(process.cwd(), 'data', 'landings.json'),
    z.array(landingSchema),
    [],
  );
