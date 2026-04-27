import { z } from 'zod';

import { PHAB_ORIGIN } from '../config';

import { createConduitClient } from './phabricator';

const responseSchema = z.object({
  data: z.array(
    z.object({
      phid: z.string(),
      fields: z.object({ name: z.string() }),
      attachments: z
        .object({
          slugs: z.object({ slugs: z.array(z.object({ slug: z.string() })) }).optional(),
        })
        .optional(),
    }),
  ),
});

const main = async (): Promise<void> => {
  const phids = process.argv.slice(2).filter((argument) => argument.startsWith('PHID-PROJ-'));
  if (phids.length === 0) {
    throw new Error('usage: bun run src/scripts/lookup-phab-project.ts PHID-PROJ-...');
  }
  const apiToken = process.env.PHABRICATOR_TOKEN;
  if (apiToken === undefined || apiToken.length === 0) {
    throw new Error('PHABRICATOR_TOKEN is required');
  }
  const client = createConduitClient({ endpoint: `${PHAB_ORIGIN}/api`, apiToken });
  const raw = await client.call('project.search', {
    constraints: { phids },
    attachments: { slugs: true },
  });
  const parsed = responseSchema.parse(raw);
  for (const entry of parsed.data) {
    const slug = entry.attachments?.slugs?.slugs[0]?.slug ?? '';
    process.stdout.write(`${entry.phid}\t${slug}\t${entry.fields.name}\n`);
  }
};

try {
  await main();
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
