import type { FC } from 'react';

import { FAST_HOURS } from '../config';
import type { Sample } from '../scripts/collect';

import { asMaterialSymbolName, Icon } from './Icon';
import { buildLeaderboard, type LeaderboardRow } from './leaderboard';
import { tierForHours, tierForPctUnderSla, TIER_TEXT_CLASSES } from './slaTier';

const TROPHY_ICON = asMaterialSymbolName('emoji_events');
const BOLT_ICON = asMaterialSymbolName('bolt');

const formatHours = (value: number): string => `${(Math.round(value * 10) / 10).toFixed(1)}h`;
const formatPercent = (value: number): string => `${Math.round(value).toString()}%`;

interface SectionProps {
  readonly label: string;
  readonly rows: readonly LeaderboardRow[];
  readonly slaHours: number;
}

const LeaderboardSection: FC<SectionProps> = ({ label, rows, slaHours }) => (
  <div className="flex flex-col gap-2">
    <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</h3>
    <div className="overflow-x-auto rounded-md border border-emerald-900/40 bg-neutral-950">
      <table className="w-full text-left text-xs text-neutral-300">
        <thead className="bg-neutral-900 text-neutral-400">
          <tr>
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Reviewer</th>
            <th className="px-3 py-2 text-right font-medium">% under {slaHours.toString()}h</th>
            <th className="px-3 py-2 text-right font-medium">Median</th>
            <th className="px-3 py-2 text-right font-medium">Under {FAST_HOURS.toString()}h</th>
            <th className="px-3 py-2 text-right font-medium">Reviews</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${row.source}:${row.reviewer}`}
              data-testid="leaderboard-row"
              className="border-t border-neutral-800"
            >
              <td className="px-3 py-2 text-neutral-400">
                {index === 0 ? (
                  <Icon name={TROPHY_ICON} className="text-base text-amber-300" />
                ) : (
                  (index + 1).toString()
                )}
              </td>
              <td className="px-3 py-2 font-medium text-neutral-100">{row.reviewer}</td>
              <td
                className={`px-3 py-2 text-right font-medium ${TIER_TEXT_CLASSES[tierForPctUnderSla(row.pctUnderSla)]}`}
              >
                {formatPercent(row.pctUnderSla)}
              </td>
              <td
                className={`px-3 py-2 text-right ${TIER_TEXT_CLASSES[tierForHours(row.medianTat, slaHours)]}`}
              >
                {formatHours(row.medianTat)}
              </td>
              <td className="px-3 py-2 text-right text-emerald-200">{row.fastCount.toString()}</td>
              <td className="px-3 py-2 text-right text-neutral-400">{row.count.toString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export interface ReviewerLeaderboardProps {
  readonly samples: readonly Sample[];
  readonly now: Date;
  readonly slaHours: number;
}

// Celebrates the reviewers with the best recent turnaround. Per-source sections
// (Phabricator, GitHub) mirror the dashboard's tab split; a Phabricator-only
// group simply shows one section. Ranking + qualification live in
// buildLeaderboard; this component is presentational.
export const ReviewerLeaderboard: FC<ReviewerLeaderboardProps> = ({ samples, now, slaHours }) => {
  const rows = buildLeaderboard(samples, { now, slaHours });
  const phab = rows.filter((row) => row.source === 'phab');
  const github = rows.filter((row) => row.source === 'github');

  return (
    <section
      aria-labelledby="leaderboard-heading"
      className="flex flex-col gap-3 rounded-md border border-emerald-900/40 bg-emerald-950/20 p-4"
    >
      <header className="flex items-center gap-2">
        <Icon name={TROPHY_ICON} className="text-xl text-amber-300" />
        <h2 id="leaderboard-heading" className="text-lg font-semibold text-emerald-100">
          Review leaderboard
        </h2>
        <Icon name={BOLT_ICON} className="text-base text-emerald-300" />
      </header>
      <p className="text-xs text-neutral-400">
        Reviewers ranked by the share of their recent reviews that beat the {slaHours.toString()}h
        SLA, with ties broken by fastest median turnaround.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm italic text-neutral-500">Not enough reviews yet to rank reviewers.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {phab.length > 0 && (
            <LeaderboardSection label="Phabricator" rows={phab} slaHours={slaHours} />
          )}
          {github.length > 0 && (
            <LeaderboardSection label="GitHub" rows={github} slaHours={slaHours} />
          )}
        </div>
      )}
    </section>
  );
};
