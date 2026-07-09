import { GITHUB_OWNER, GITHUB_REPO } from '../config';

// Repo-less legacy github rows normalize to content-monorepo — the same
// default the collector's dedup keys use, so display and keying agree.
const DEFAULT_GITHUB_REPO_SLUG = `${GITHUB_OWNER}/${GITHUB_REPO}`;

// Resolve a github record's `owner/repo` slug, defaulting legacy rows.
export const githubRepoSlug = (repo: string | undefined): string =>
  repo ?? DEFAULT_GITHUB_REPO_SLUG;

// Outbound PR link for a github record, routed to the correct repo.
export const githubPrUrl = (repo: string | undefined, id: string | number): string =>
  `https://github.com/${githubRepoSlug(repo)}/pull/${String(id)}`;

// Short display name — the repo portion after the owner (e.g. "merino-py").
// Shown alongside the PR number so rows from different repos are legible even
// when their PR numbers collide.
export const githubRepoShortName = (repo: string | undefined): string => {
  const slug = githubRepoSlug(repo);
  const slash = slug.indexOf('/');
  return slash === -1 ? slug : slug.slice(slash + 1);
};
