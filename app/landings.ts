import path from 'node:path';

import { z } from 'zod';

import { landingSchema, type Landing } from '../src/scripts/collect';
import { readValidatedJsonFile } from '../src/scripts/jsonFile';

export const loadLandings = async (dataDirectory: string): Promise<Landing[]> =>
  readValidatedJsonFile(path.join(dataDirectory, 'landings.json'), z.array(landingSchema), []);
