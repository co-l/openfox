# PR Review Workflow

> How to review, fix, and merge pull requests in OpenFox — agent-assisted.

## Overview

PRs target `develop`. Features accumulate via squash-merges. `main` stays aligned with the latest published version (see release process in [AGENTS.md](../AGENTS.md#release)).

PRs can come from **same-repo branches** or **forks**. The workflow handles both.

## Detect PR origin

Before starting, check whether the PR is from a fork:

```bash
gh pr view <N> --json headRepositoryOwner --jq '.headRepositoryOwner.login'
# Output: "co-l"           → same-repo branch
# Output: "JamesDAdams"    → fork
```

## Agent-Assisted Workflow

The agent drives the review. The user reviews code, confirms fixes, and does manual testing.

### Phase 1 — Setup

The agent creates an isolated workspace and pulls in the PR branch.

```bash
# 1. Create/switch to a review workspace (auto-creates if new)
workspace switch review-pr-<N>

# 2. Point origin to GitHub (workspaces use --shared clone, origin
#    defaults to the local repo path — gh needs a GitHub remote)
git remote set-url origin git@github.com:co-l/openfox.git

# 3. Sync workspace with develop
git fetch origin
git reset --hard origin/develop

# 4. Fetch the PR branch
gh pr checkout <N>
```

### Phase 2 — Review

The agent examines the PR:

- Read the diff: `git diff origin/develop...HEAD`
- List changed files: `git diff --stat origin/develop...HEAD`
- Run existing tests to check for regressions
- Inspect code quality, error handling, edge cases
- Report findings to the user with specific line references

### Phase 3 — Fix

The user approves the fix plan. The agent applies fixes in the workspace and commits.

```bash
# 4. Apply fixes (agent uses write_file / edit_file tools)
#    NOTE: agent does NOT commit or push until user says so
```

### Phase 4 — User Tests

The agent starts the dev server and hands off with a summary — no asking, just doing:

```bash
# Agent starts the dev server (no question — just do it)
dev_server start   # → http://localhost:<port>
```

Handoff format:

> **"PR #N is ready at http://localhost:<port>.**
>
> **Metrics:** Tests X → Y (+Z), Typecheck ✅, Lint ✅
>
> **What I fixed:**
>
> - _bullet list of specific changes_
> - _why each matters_
>
> **What to test:**
>
> - _specific things to click/look for_
> - _edge cases_"

The user opens the link and kicks the tires. Loop back to Phase 3 if adjustments are needed.

### Phase 5 — Merge

When the user says **"Merge it"**, the agent:

```bash
# 6. Switch back to the review workspace
workspace switch review-pr-<N>

# 7. Push fixes to the PR branch
#    Same-repo:
git push origin HEAD:<remote-branch-name>
#    Fork (maintainer_can_modify=true):
git remote add fork-<N> git@github.com:<user>/openfox.git
git push fork-<N> HEAD:<remote-branch-name>
git remote remove fork-<N>

# 8. Squash-merge via API
gh api repos/co-l/openfox/pulls/<N>/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: description (#<N>)"

# 9. Return to main project
workspace switch original

# 10. Update develop locally
git checkout develop && git pull origin develop --ff-only

# 11. Clean up the review workspace
workspace delete review-pr-<N>
```

## Full Example (Fork PR)

```bash
# ── Setup ──
workspace switch review-pr-103
git remote set-url origin git@github.com:co-l/openfox.git
git fetch origin && git reset --hard origin/develop
gh pr checkout 103

# ── Review ──
git diff --stat origin/develop...HEAD
npm run typecheck
npm run test:unit

# ── Fix (agent proposes → user approves) ──
# agent applies fixes via edit_file
git add -A && git commit -m "review: fix windows path handling in npm spawn"

# ── Agent starts dev server and hands off ──
dev_server start
# "PR #103 ready at http://localhost:.... Metrics: Tests 2225→2232 (+7), Typecheck ✅, Lint ✅
#  What I fixed: ... What to test: ..."
# ── User tests, iterates if needed ──

# ── Merge (user says "merge it") ──
workspace switch review-pr-103
git remote add fork-103 git@github.com:RenZan/openfox.git
git push fork-103 HEAD:feature/manage-pdf-images
git remote remove fork-103
gh api repos/co-l/openfox/pulls/103/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: PDF embedded-image support (#103)"
workspace switch original
git checkout develop && git pull origin develop --ff-only
workspace delete review-pr-103
```

## Fork PRs Without Push Access

If the fork doesn't have `maintainer_can_modify=true`, you can't push to it directly.
Instead, merge the PR as-is, then cherry-pick your fixes onto develop.

```bash
# 1. Fetch the PR branch
gh pr checkout <N>

# 2. Apply fixes, commit, and tag
# ... agent applies fixes ...
git add -A && git commit -m "review: fix ..."
git tag review-fix-<N>

# 3. Squash-merge the ORIGINAL PR (without your fixes)
gh api repos/co-l/openfox/pulls/<N>/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: description (#<N>)"

# 4. Update develop
git checkout develop && git pull origin develop --ff-only

# 5. Cherry-pick your fixes
git cherry-pick review-fix-<N>
git tag -d review-fix-<N>
git push origin develop

# 6. Clean up
workspace switch original
workspace delete review-pr-<N>
```

## Common Pitfalls

### Orphaned workspaces

### `gh pr merge` GraphQL deprecation

`gh pr merge` may fail with `GraphQL: Projects (classic) is being deprecated` even when the merge succeeds. Use the REST API directly instead:

```bash
gh api repos/co-l/openfox/pulls/<N>/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: description (#<N>)"
```

### Orphaned workspaces

If a workspace switch fails midway, clean up manually:

```bash
workspace delete <name>          # via tool
# or manually:
rm -rf ~/.local/share/openfox/workspaces/<project>/<name>
```

## Squash-Merge via API

Always use the REST API for merging to avoid GraphQL deprecation errors:

```bash
# Change base to develop first (if targeting main)
gh api repos/co-l/openfox/pulls/<N> -X PATCH -f base=develop

# Squash-merge
gh api repos/co-l/openfox/pulls/<N>/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: description (#<N>)"

# Pull locally
git checkout develop && git pull origin develop --ff-only
```
