import { BUGZILLA_ORIGIN } from '../config';
import type { BugzillaScopeConfig } from '../groups';

// Outbound link for a bug row in the expanded panel table.
export const bugzillaBugUrl = (id: string | number): string =>
  `${BUGZILLA_ORIGIN}/show_bug.cgi?id=${String(id)}`;

// Buglist link for the panel description, reproducing the same scope the
// collector queries so a reader can click through and audit the number. If this
// drifts from paramsForScope in src/scripts/bugzilla.ts, the audit lies —
// resolution=FIXED in particular has to stay.
export const bugzillaBuglistUrl = (scopes: readonly BugzillaScopeConfig[]): string => {
  const query = new URLSearchParams();
  for (const scope of scopes) {
    query.append('product', scope.product);
    for (const component of scope.components ?? []) query.append('component', component);
  }
  query.append('resolution', 'FIXED');
  return `${BUGZILLA_ORIGIN}/buglist.cgi?${query.toString()}`;
};

// Human-readable scope, e.g. "Firefox :: New Tab Page" or bare "GeckoView" for
// a whole-product scope. Used as the link text so the panel says out loud which
// bugs it counts.
export const bugzillaScopeLabel = (scopes: readonly BugzillaScopeConfig[]): string =>
  scopes
    .flatMap((scope) => {
      const components = scope.components ?? [];
      return components.length === 0
        ? [scope.product]
        : components.map((component) => `${scope.product} :: ${component}`);
    })
    .join(', ');
