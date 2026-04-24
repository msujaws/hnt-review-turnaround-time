import type { SourceWindows } from '../scripts/collect';

// True iff the 7-day window has samples and its median is over the SLA.
// Scoped tightly on purpose: the tab is the top-level at-a-glance signal, and
// the primary SLA is the review TAT one (4h). The narrower windows
// (14/30-day) and the secondary landing metrics (cycle, post-review, rounds)
// still tint their own stat cards via TIER_CARD_CLASSES — they just don't
// escalate to the tab-level red.
export const window7dMedianOverSla = (windows: SourceWindows, slaThreshold: number): boolean =>
  windows.window7d.n > 0 && windows.window7d.median > slaThreshold;
