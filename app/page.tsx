import type { Metadata } from 'next';
import type { FC } from 'react';

import { SLA_HOURS } from '../src/config';
import { dataDirectoryForGroup, defaultGroup } from '../src/groups';
import { loadPeopleMap } from '../src/scripts/people';

import { GroupView } from './GroupView';
import { loadHistory } from './history';
import { buildMetadataSummary } from './metadata';
import { loadPending } from './pending';
import { loadSamples } from './samples';

export const revalidate = 3600;

// Page-level metadata (not layout-level): the layout can't see route params,
// and this keeps the bare `/` URL unfurling the default group's numbers for
// the existing Slack post.
export const generateMetadata = async (): Promise<Metadata> => {
  const group = defaultGroup();
  const dataDirectory = dataDirectoryForGroup(group.id);
  const [history, pending, samples, peopleMap] = await Promise.all([
    loadHistory(dataDirectory),
    loadPending(dataDirectory),
    loadSamples(dataDirectory),
    loadPeopleMap(dataDirectory),
  ]);
  const summary = buildMetadataSummary(history, SLA_HOURS, {
    pending,
    samples,
    now: new Date(),
    peopleMap,
    label: group.label,
    hasGithub: group.github !== undefined,
  });
  return {
    title: summary.title,
    description: summary.description,
    openGraph: { title: summary.title, description: summary.description },
    twitter: { card: 'summary', title: summary.title, description: summary.description },
  };
};

const Page: FC = () => <GroupView group={defaultGroup()} />;

export default Page;
