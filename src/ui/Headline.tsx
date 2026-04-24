import type { CSSProperties, FC, ReactElement, ReactNode } from 'react';

import { GITHUB_OWNER, GITHUB_REPO, PHAB_ORIGIN } from '../config';
import { isLandingInWindow, isSampleInWindow, type Landing, type Sample } from '../scripts/collect';
import type { WindowStats } from '../scripts/stats';

import { asMaterialSymbolName, Icon } from './Icon';
import {
  TIER_CARD_CLASSES,
  TIER_TEXT_CLASSES,
  TIER_VALUE_TEXT_CLASSES,
  tierForHours,
  tierForPctUnderSla,
  type SlaTier,
} from './slaTier';

const SCHEDULE_ICON = asMaterialSymbolName('schedule');
const EXPAND_ICON = asMaterialSymbolName('expand_more');

const CARD_BASE_CLASSES =
  'flex flex-col gap-1 rounded-md p-4 animate-pop-in transition-all duration-200 ease-bouncy hover:-translate-y-0.5 hover:scale-[1.03]';
const CARD_NEUTRAL_CLASSES =
  'bg-neutral-900 ring-1 ring-neutral-800 hover:bg-neutral-800 hover:ring-neutral-700';
const VALUE_NEUTRAL_CLASSES = 'text-neutral-100';

const formatHours = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(1)}h`;
};

// Integer rounds; display as "1", "2", "3"… no decimal or unit suffix because
// the header already labels the panel as "Rounds".
const formatRounds = (value: number): string => String(Math.round(value));

type MetricUnit = 'hours' | 'rounds';

const formatStatValue = (value: number, hasData: boolean, unit: MetricUnit): string => {
  if (!hasData) return 'N/A';
  return unit === 'rounds' ? formatRounds(value) : formatHours(value);
};
const formatPercent = (value: number): string => `${Math.round(value).toString()}%`;
const formatTimestamp = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace('T', ' ').slice(0, 16);
};

interface StatCellProps {
  readonly label: string;
  readonly value: string;
  readonly tier?: SlaTier | undefined;
  readonly animationDelayMs?: number | undefined;
}

const StatCell: FC<StatCellProps> = ({ label, value, tier, animationDelayMs }) => {
  const cardTone = tier === undefined ? CARD_NEUTRAL_CLASSES : TIER_CARD_CLASSES[tier];
  const valueTone = tier === undefined ? VALUE_NEUTRAL_CLASSES : TIER_VALUE_TEXT_CLASSES[tier];
  const style: CSSProperties | undefined =
    animationDelayMs === undefined
      ? undefined
      : { animationDelay: `${animationDelayMs.toString()}ms` };
  return (
    <div className={`${CARD_BASE_CLASSES} ${cardTone}`} style={style}>
      <span className="text-xs uppercase tracking-wide text-neutral-400">{label}</span>
      <span className={`text-2xl font-semibold ${valueTone}`}>{value}</span>
    </div>
  );
};

const windowDaysFor = (label: '7-day' | '14-day' | '30-day'): number => {
  if (label === '7-day') return 7;
  if (label === '14-day') return 14;
  return 30;
};

// Identifier used for both Sample and Landing rows — both carry a source
// discriminator, an id, and an optional Phab revisionId, which is all this
// component needs to build the outbound link.
interface ItemIdentifierInput {
  readonly source: 'phab' | 'github';
  readonly id: string | number;
  readonly revisionId?: number | undefined;
}

const LINK_CLASSES =
  'font-mono text-sky-400 underline decoration-sky-700 underline-offset-4 hover:text-sky-300';

const ItemIdentifier: FC<{ readonly item: ItemIdentifierInput }> = ({ item }) => {
  if (item.source === 'github') {
    return (
      <a
        href={`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/pull/${String(item.id)}`}
        className={LINK_CLASSES}
        rel="noopener noreferrer"
        target="_blank"
      >
        #{String(item.id)}
      </a>
    );
  }
  if (item.revisionId !== undefined) {
    const label = `D${item.revisionId.toString()}`;
    return (
      <a
        href={`${PHAB_ORIGIN}/${label}`}
        className={LINK_CLASSES}
        rel="noopener noreferrer"
        target="_blank"
      >
        {label}
      </a>
    );
  }
  return <span className="font-mono text-neutral-300">{String(item.id)}</span>;
};

// Discriminated set of row kinds. The row renderer, in-window predicate, and
// sort key are chosen per kind inside WindowRow — callers pass the kind +
// items and get the right table back.
export type HeadlineItems =
  | { readonly kind: 'tat'; readonly items: readonly Sample[] }
  | { readonly kind: 'cycle'; readonly items: readonly Landing[] }
  | { readonly kind: 'postReview'; readonly items: readonly Landing[] }
  | { readonly kind: 'rounds'; readonly items: readonly Landing[] };

interface TableShellProps {
  readonly headers: readonly string[];
  readonly children: ReactNode;
}

const TableShell: FC<TableShellProps> = ({ headers, children }) => (
  <div className="mt-2 overflow-x-auto rounded-md border border-neutral-800 bg-neutral-950">
    <table className="w-full text-left text-xs text-neutral-300">
      <thead className="bg-neutral-900 text-neutral-400">
        <tr>
          {headers.map((header, index) => (
            <th
              key={header}
              className={
                index === headers.length - 1
                  ? 'px-3 py-2 text-right font-medium'
                  : 'px-3 py-2 font-medium'
              }
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

const AuthorCell: FC<{ readonly author: string | undefined }> = ({ author }) => (
  <td className="px-3 py-2 text-neutral-200">
    {author ?? <span className="text-neutral-500">—</span>}
  </td>
);

const TatRow: FC<{ readonly item: Sample; readonly slaHours: number }> = ({ item, slaHours }) => {
  const tier = tierForHours(item.tatBusinessHours, slaHours);
  return (
    <tr className="border-t border-neutral-800">
      <td className="px-3 py-2">
        <ItemIdentifier item={item} />
      </td>
      <AuthorCell author={item.author} />
      <td className="px-3 py-2 text-neutral-200">{item.reviewer}</td>
      <td className="px-3 py-2 text-neutral-400">{formatTimestamp(item.requestedAt)}</td>
      <td className="px-3 py-2 text-neutral-400">{formatTimestamp(item.firstActionAt)}</td>
      <td className={`px-3 py-2 text-right font-medium ${TIER_TEXT_CLASSES[tier]}`}>
        {formatHours(item.tatBusinessHours)}
      </td>
    </tr>
  );
};

const CycleRow: FC<{ readonly item: Landing; readonly slaHours: number }> = ({
  item,
  slaHours,
}) => {
  const tier = tierForHours(item.cycleBusinessHours, slaHours);
  return (
    <tr className="border-t border-neutral-800">
      <td className="px-3 py-2">
        <ItemIdentifier item={item} />
      </td>
      <AuthorCell author={item.author} />
      <td className="px-3 py-2 text-neutral-400">{formatTimestamp(item.createdAt)}</td>
      <td className="px-3 py-2 text-neutral-400">{formatTimestamp(item.landedAt)}</td>
      <td className={`px-3 py-2 text-right font-medium ${TIER_TEXT_CLASSES[tier]}`}>
        {formatHours(item.cycleBusinessHours)}
      </td>
    </tr>
  );
};

// Only rendered after the null-firstReviewAt filter — both firstReviewAt and
// postReviewBusinessHours are guaranteed non-null here by the Landing schema's
// coupling refinement.
type PostReviewRowItem = Landing & {
  readonly firstReviewAt: string;
  readonly postReviewBusinessHours: number;
};

const PostReviewRow: FC<{
  readonly item: PostReviewRowItem;
  readonly slaHours: number;
}> = ({ item, slaHours }) => {
  const tier = tierForHours(item.postReviewBusinessHours, slaHours);
  return (
    <tr className="border-t border-neutral-800">
      <td className="px-3 py-2">
        <ItemIdentifier item={item} />
      </td>
      <AuthorCell author={item.author} />
      <td className="px-3 py-2 text-neutral-400">{formatTimestamp(item.firstReviewAt)}</td>
      <td className="px-3 py-2 text-neutral-400">{formatTimestamp(item.landedAt)}</td>
      <td className={`px-3 py-2 text-right font-medium ${TIER_TEXT_CLASSES[tier]}`}>
        {formatHours(item.postReviewBusinessHours)}
      </td>
    </tr>
  );
};

// Rounds reuse tierForHours because the tier shape is identical: value ≤ SLA
// = good, ≤ 2× SLA = warn, over = bad. With ROUNDS_SLA=1 that maps to
// 1 round=good, 2=warn, 3+=bad.
const RoundsRow: FC<{ readonly item: Landing; readonly roundsSla: number }> = ({
  item,
  roundsSla,
}) => {
  const tier = tierForHours(item.reviewRounds, roundsSla);
  return (
    <tr className="border-t border-neutral-800">
      <td className="px-3 py-2">
        <ItemIdentifier item={item} />
      </td>
      <AuthorCell author={item.author} />
      <td className="px-3 py-2 text-neutral-400">{formatTimestamp(item.landedAt)}</td>
      <td className={`px-3 py-2 text-right font-medium ${TIER_TEXT_CLASSES[tier]}`}>
        {formatRounds(item.reviewRounds)}
      </td>
    </tr>
  );
};

const TAT_HEADERS = ['Review', 'Author', 'Reviewer', 'Requested', 'First action', 'TAT'] as const;
const CYCLE_HEADERS = ['Review', 'Author', 'Created', 'Landed', 'Cycle'] as const;
const POST_REVIEW_HEADERS = ['Review', 'Author', 'First review', 'Landed', 'Post-review'] as const;
const ROUNDS_HEADERS = ['Review', 'Author', 'Landed', 'Rounds'] as const;

const sampleKey = (sample: Sample): string =>
  `${sample.source}:${String(sample.id)}:${sample.reviewer}`;

const landingKey = (landing: Landing): string => `${landing.source}:${String(landing.id)}`;

interface WindowItemsProps {
  readonly kindItems: HeadlineItems;
  readonly slaHours: number;
  readonly windowDays: number;
  readonly now: Date;
}

const renderWindowItems = (props: WindowItemsProps): ReactElement | null => {
  const { kindItems, slaHours, windowDays, now } = props;
  if (kindItems.kind === 'tat') {
    const rows = kindItems.items
      .filter((s) => isSampleInWindow(s, windowDays, now))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    if (rows.length === 0) return null;
    return (
      <TableShell headers={TAT_HEADERS}>
        {rows.map((item) => (
          <TatRow key={sampleKey(item)} item={item} slaHours={slaHours} />
        ))}
      </TableShell>
    );
  }
  if (kindItems.kind === 'cycle') {
    const rows = kindItems.items
      .filter((l) => isLandingInWindow(l, windowDays, now))
      .sort((a, b) => b.landedAt.localeCompare(a.landedAt));
    if (rows.length === 0) return null;
    return (
      <TableShell headers={CYCLE_HEADERS}>
        {rows.map((item) => (
          <CycleRow key={landingKey(item)} item={item} slaHours={slaHours} />
        ))}
      </TableShell>
    );
  }
  if (kindItems.kind === 'postReview') {
    const rows = kindItems.items
      .filter(
        (l): l is PostReviewRowItem =>
          l.firstReviewAt !== null && l.postReviewBusinessHours !== null,
      )
      .filter((l) => isLandingInWindow(l, windowDays, now))
      .sort((a, b) => b.landedAt.localeCompare(a.landedAt));
    if (rows.length === 0) return null;
    return (
      <TableShell headers={POST_REVIEW_HEADERS}>
        {rows.map((item) => (
          <PostReviewRow key={landingKey(item)} item={item} slaHours={slaHours} />
        ))}
      </TableShell>
    );
  }
  const rows = kindItems.items
    .filter((l) => isLandingInWindow(l, windowDays, now))
    .sort((a, b) => b.landedAt.localeCompare(a.landedAt));
  if (rows.length === 0) return null;
  return (
    <TableShell headers={ROUNDS_HEADERS}>
      {rows.map((item) => (
        <RoundsRow key={landingKey(item)} item={item} roundsSla={slaHours} />
      ))}
    </TableShell>
  );
};

interface WindowRowProps {
  readonly label: '7-day' | '14-day' | '30-day';
  readonly stats: WindowStats;
  readonly slaHours: number;
  readonly kindItems: HeadlineItems;
  readonly now: Date;
  readonly unit: MetricUnit;
  readonly slaLabel: string;
  readonly countLabel: string;
}

// Rounds display as integers (formatRounds rounds to nearest), so the tier
// needs to agree with what the user sees. Otherwise a mean of 1.3 renders as
// "1" but tiers as warn (1.3 > ROUNDS_SLA of 1).
const statsTier = (
  value: number,
  stats: WindowStats,
  slaHours: number,
  unit: MetricUnit,
): SlaTier | undefined => {
  if (stats.n === 0) return undefined;
  const effective = unit === 'rounds' ? Math.round(value) : value;
  return tierForHours(effective, slaHours);
};

const pctTier = (stats: WindowStats): SlaTier | undefined =>
  stats.n === 0 ? undefined : tierForPctUnderSla(stats.pctUnderSLA);

const StatGrid: FC<{
  readonly stats: WindowStats;
  readonly slaHours: number;
  readonly unit: MetricUnit;
  readonly slaLabel: string;
}> = ({ stats, slaHours, unit, slaLabel }) => (
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    <StatCell
      label="Median"
      value={formatStatValue(stats.median, stats.n > 0, unit)}
      tier={statsTier(stats.median, stats, slaHours, unit)}
      animationDelayMs={0}
    />
    <StatCell
      label="Mean"
      value={formatStatValue(stats.mean, stats.n > 0, unit)}
      tier={statsTier(stats.mean, stats, slaHours, unit)}
      animationDelayMs={70}
    />
    <StatCell
      label="p90"
      value={formatStatValue(stats.p90, stats.n > 0, unit)}
      tier={statsTier(stats.p90, stats, slaHours, unit)}
      animationDelayMs={140}
    />
    <StatCell
      label={slaLabel}
      value={formatPercent(stats.pctUnderSLA)}
      tier={pctTier(stats)}
      animationDelayMs={210}
    />
  </div>
);

const formatCount = (n: number, countLabel: string): string => {
  if (n === 0) return `no ${countLabel}s in window`;
  return `${n.toString()} ${n === 1 ? countLabel : `${countLabel}s`}`;
};

const RowBody: FC<WindowRowProps> = ({ label, stats, slaHours, unit, slaLabel, countLabel }) => (
  <>
    <div className="flex items-center gap-2 text-sm font-medium text-neutral-300">
      <span>{label}</span>
      <span className="text-neutral-500">·</span>
      <span className="text-neutral-500">{formatCount(stats.n, countLabel)}</span>
    </div>
    <StatGrid stats={stats} slaHours={slaHours} unit={unit} slaLabel={slaLabel} />
  </>
);

const WindowRow: FC<WindowRowProps> = (props) => {
  const windowDays = windowDaysFor(props.label);
  const table = renderWindowItems({
    kindItems: props.kindItems,
    slaHours: props.slaHours,
    windowDays,
    now: props.now,
  });
  if (table === null) {
    return (
      <div className="flex flex-col gap-2">
        <RowBody {...props} />
      </div>
    );
  }
  return (
    <details
      data-testid={`window-${windowDays.toString()}d-details`}
      className="group flex flex-col gap-2 rounded-md"
    >
      <summary className="flex cursor-pointer list-none flex-col gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-neutral-300">
            <span>{props.label}</span>
            <span className="text-neutral-500">·</span>
            <span className="text-neutral-500">{formatCount(props.stats.n, props.countLabel)}</span>
          </div>
          <Icon
            name={EXPAND_ICON}
            className="text-base text-neutral-500 transition-transform group-open:rotate-180"
          />
        </div>
        <StatGrid
          stats={props.stats}
          slaHours={props.slaHours}
          unit={props.unit}
          slaLabel={props.slaLabel}
        />
      </summary>
      {table}
    </details>
  );
};

// Headline accepts the underlying items either as `samples` (legacy, TAT-only)
// or `items` (new, discriminated). Exactly one source is expected; when both
// are supplied, `items` wins — this lets existing call sites stay on `samples`
// while new landing panels pass the richer discriminator.
export interface HeadlineProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly window7d: WindowStats;
  readonly window14d: WindowStats;
  readonly window30d: WindowStats;
  readonly slaHours: number;
  readonly samples?: readonly Sample[];
  readonly items?: HeadlineItems;
  readonly now: Date;
  readonly unit?: MetricUnit;
  readonly slaLabel?: string;
  readonly countLabel?: string;
  readonly collapsible?: boolean;
  readonly defaultOpen?: boolean;
  readonly children?: ReactNode;
}

interface HeaderContentProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly statusText: string;
  readonly showChevron: boolean;
}

const HeaderContent: FC<HeaderContentProps> = ({ title, description, statusText, showChevron }) => (
  <>
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-xl font-semibold text-neutral-100">{title}</h2>
      <span className="flex items-center gap-2 text-sm text-neutral-400">
        <Icon name={SCHEDULE_ICON} className="text-base" />
        {statusText}
        {showChevron ? (
          <Icon
            name={EXPAND_ICON}
            className="text-base text-neutral-500 transition-transform group-open:rotate-180"
          />
        ) : null}
      </span>
    </div>
    {description === undefined ? null : <p className="text-sm text-neutral-400">{description}</p>}
  </>
);

export const Headline: FC<HeadlineProps> = ({
  title,
  description,
  window7d,
  window14d,
  window30d,
  slaHours,
  samples,
  items,
  now,
  unit = 'hours',
  slaLabel,
  countLabel = 'review',
  collapsible = false,
  defaultOpen = false,
  children,
}) => {
  const effectiveSlaLabel = slaLabel ?? `Under ${slaHours.toString()}h SLA`;
  const emptyState = `awaiting first ${countLabel}s`;
  const statusText = window7d.n + window14d.n + window30d.n === 0 ? emptyState : 'rolling windows';
  const kindItems: HeadlineItems = items ?? { kind: 'tat', items: samples ?? [] };
  const windowRows = (
    <>
      <WindowRow
        label="7-day"
        stats={window7d}
        slaHours={slaHours}
        kindItems={kindItems}
        now={now}
        unit={unit}
        slaLabel={effectiveSlaLabel}
        countLabel={countLabel}
      />
      <WindowRow
        label="14-day"
        stats={window14d}
        slaHours={slaHours}
        kindItems={kindItems}
        now={now}
        unit={unit}
        slaLabel={effectiveSlaLabel}
        countLabel={countLabel}
      />
      <WindowRow
        label="30-day"
        stats={window30d}
        slaHours={slaHours}
        kindItems={kindItems}
        now={now}
        unit={unit}
        slaLabel={effectiveSlaLabel}
        countLabel={countLabel}
      />
    </>
  );
  if (collapsible) {
    return (
      <details className="group flex flex-col gap-4" open={defaultOpen}>
        <summary className="flex cursor-pointer list-none flex-col gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&::-webkit-details-marker]:hidden">
          <HeaderContent
            title={title}
            description={description}
            statusText={statusText}
            showChevron
          />
        </summary>
        {windowRows}
        {children}
      </details>
    );
  }
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <HeaderContent
          title={title}
          description={description}
          statusText={statusText}
          showChevron={false}
        />
      </header>
      {windowRows}
      {children}
    </section>
  );
};
