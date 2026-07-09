import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { FC } from 'react';

import { SLA_HOURS } from '../../../src/config';
import { allGroups, dataDirectoryForGroup, getGroup } from '../../../src/groups';
import { loadPeopleMap } from '../../../src/scripts/people';
import { GroupView } from '../../GroupView';
import { loadHistory } from '../../history';
import { buildMetadataSummary } from '../../metadata';
import { loadPending } from '../../pending';
import { loadSamples } from '../../samples';

export const revalidate = 3600;

interface RouteParams {
  readonly params: Promise<{ readonly group: string }>;
}

// Statically generate every known group so each gets a cacheable, ISR-backed
// page (and a stable URL Slack can unfurl). Unknown ids fall through to
// notFound() at request time.
export const generateStaticParams = (): { group: string }[] =>
  allGroups().map((group) => ({ group: group.id }));

export const generateMetadata = async ({ params }: RouteParams): Promise<Metadata> => {
  const { group: groupId } = await params;
  const group = getGroup(groupId);
  if (group === undefined) return {};
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
    hasGithub: (group.github?.length ?? 0) > 0,
  });
  return {
    title: summary.title,
    description: summary.description,
    openGraph: { title: summary.title, description: summary.description },
    twitter: { card: 'summary', title: summary.title, description: summary.description },
  };
};

const GroupPage: FC<RouteParams> = async ({ params }) => {
  const { group: groupId } = await params;
  const group = getGroup(groupId);
  if (group === undefined) notFound();
  return <GroupView group={group} />;
};

export default GroupPage;
