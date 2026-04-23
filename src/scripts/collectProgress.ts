import { writeJsonFileAtomic } from './jsonFile';

// Point-in-time status for a single runCollectionFromDisk invocation, written
// atomically to data/.collect-progress.json on every meaningful state change.
// Lets operators (and CI) see whether a long-running backfill is still making
// progress, waiting out a cooldown, or stuck in an error state without
// tailing stdout. The file is gitignored and overwritten on every run — it
// is not a historical log.
export interface CollectProgress {
  readonly startedAt: string;
  lastUpdated: string;
  phase: CollectProgressPhase;
  message: string;
  phab: {
    revisionsProcessed: number;
    revisionsFetched: number;
    revisionsTotal: number | null;
  };
  github: {
    prsProcessed: number | null;
  };
}

// Named set so readers don't have to guess; adding a phase is a code change.
export type CollectProgressPhase =
  | 'init'
  | 'phab-revisions'
  | 'phab-transactions'
  | 'phab-cooldown'
  | 'github'
  | 'computing'
  | 'writing'
  | 'done'
  | 'error';

export interface ProgressWriter {
  snapshot: () => CollectProgress;
  update: (mutator: (state: CollectProgress) => void, now?: Date) => Promise<void>;
}

const cloneProgress = (state: CollectProgress): CollectProgress => ({
  startedAt: state.startedAt,
  lastUpdated: state.lastUpdated,
  phase: state.phase,
  message: state.message,
  phab: { ...state.phab },
  github: { ...state.github },
});

export const createProgressWriter = (filePath: string, startedAt: Date): ProgressWriter => {
  const state: CollectProgress = {
    startedAt: startedAt.toISOString(),
    lastUpdated: startedAt.toISOString(),
    phase: 'init',
    message: '',
    phab: { revisionsProcessed: 0, revisionsFetched: 0, revisionsTotal: null },
    github: { prsProcessed: null },
  };
  return {
    snapshot: (): CollectProgress => cloneProgress(state),
    update: async (mutator, now = new Date()): Promise<void> => {
      mutator(state);
      state.lastUpdated = now.toISOString();
      await writeJsonFileAtomic(filePath, state);
    },
  };
};
