# PR Review Workflow

> How to review, fix, and merge pull requests in OpenFox — agent-assisted.

## Overview

**All PRs must target `develop`.** The setup phase enforces this automatically. Features accumulate via squash-merges. `main` stays aligned with the latest published version (see release process in [AGENTS.md](../AGENTS.md#release)).

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

# 5. Verify PR targets develop (all PRs must target develop, not main)
PR_BASE=$(gh pr view <N> --json baseRefName --jq '.baseRefName')
if [ "$PR_BASE" != "develop" ]; then
  echo "⚠️  PR #<N> targets '$PR_BASE' — retargeting to 'develop'"
  gh api repos/co-l/openfox/pulls/<N> -X PATCH -f base=develop
  git fetch origin
fi

# 6. Rebase PR branch onto latest develop (ensures review is against current code)
git rebase origin/develop
```

### Phase 2 — Review

The agent examines the PR:

- Read the diff: `git diff origin/develop...HEAD`
- List changed files: `git diff --stat origin/develop...HEAD`
- Run full test suite: `npm run test:unit && npm run test:e2e`
- Inspect code quality, error handling, edge cases
- Report findings to the user with specific line references

### Phase 3 — Fix

The user approves the fix plan. The agent applies fixes in the workspace.

```bash
# 4. Apply fixes (agent uses write_file / edit_file tools)
#    NOTE: Do NOT commit or push yet — that happens in Phase 5 after user tests.
#    Precommit hooks take >40s; if you do commit later, use a 120s timeout:
#    git commit -m "message"   # timeout: 120000ms
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
> Write each test item from the user's perspective. Describe what they do
> (e.g. 'tell the agent to…', 'click the branch modal button…', 'open
> settings and toggle…') and what they should observe as a result.
>
> - _specific things to try_
> - _edge cases_"

The user opens the link and kicks the tires. Loop back to Phase 3 if adjustments are needed.

### Phase 5 — Merge

When the user says **"Merge it"**, the agent:

```bash
# 6. Switch back to the review workspace
workspace switch review-pr-<N>

# 7. ⚠️ CRITICAL: Commit fixes before pushing!
#    Check for uncommitted changes first — if you skip this step, your
#    fixes won't be included in the merge.
git status --short
#    If there are uncommitted changes:
git add -A && git commit -m "review: <description>"   # timeout: 120000ms

# 8. Push fixes to the PR branch
#    After rebasing in Phase 1, the local branch has diverged from the remote,
#    so a force-push is needed. Use --force-with-lease first; fall back to
#    --force if the remote ref has moved since we last fetched.
#    Same-repo:
git push origin HEAD:<remote-branch-name> --force-with-lease || git push origin HEAD:<remote-branch-name> --force
#    Fork (maintainer_can_modify=true):
git remote add fork-<N> git@github.com:<user>/openfox.git
git push fork-<N> HEAD:<remote-branch-name> --force-with-lease || git push fork-<N> HEAD:<remote-branch-name> --force
git remote remove fork-<N>

# 9. Safety net — ensure PR targets develop (should already be develop from Phase 1)
gh api repos/co-l/openfox/pulls/<N> -X PATCH -f base=develop

# 10. Squash-merge via API
gh api repos/co-l/openfox/pulls/<N>/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: description (#<N>)"

# 11. Return to main project
workspace switch original

# 12. Update develop locally
git checkout develop && git pull origin develop --ff-only

# 13. Clean up the review workspace
workspace delete review-pr-<N>
```

## Full Example (Fork PR)

```bash
# ── Setup ──
workspace switch review-pr-103
git remote set-url origin git@github.com:co-l/openfox.git
git fetch origin && git reset --hard origin/develop
gh pr checkout 103

# Verify PR targets develop
PR_BASE=$(gh pr view 103 --json baseRefName --jq '.baseRefName')
if [ "$PR_BASE" != "develop" ]; then
  echo "⚠️  PR #103 targets '$PR_BASE' — retargeting to 'develop'"
  gh api repos/co-l/openfox/pulls/103 -X PATCH -f base=develop
  git fetch origin
fi

# ── Review ──
git diff --stat origin/develop...HEAD
npm run typecheck
npm run test:unit && npm run test:e2e

# ── Fix (agent proposes → user approves) ──
# agent applies fixes via edit_file
# NOTE: Do NOT commit or push yet — that happens after user tests.

# ── Agent starts dev server and hands off ──
dev_server start
# "PR #103 ready at http://localhost:.... Metrics: Tests 2225→2232 (+7), Typecheck ✅, Lint ✅
#  What I fixed: ... What to test: ..."
# ── User tests, iterates if needed ──

# ── Merge (user says "merge it") ──
workspace switch review-pr-103
git add -A && git commit -m "review: fix windows path handling in npm spawn"   # timeout: 120000ms
git remote add fork-103 git@github.com:RenZan/openfox.git
git push fork-103 HEAD:feature/manage-pdf-images --force-with-lease || git push fork-103 HEAD:feature/manage-pdf-images --force
git remote remove fork-103
gh api repos/co-l/openfox/pulls/103 -X PATCH -f base=develop
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

# 2. Verify PR targets develop
PR_BASE=$(gh pr view <N> --json baseRefName --jq '.baseRefName')
if [ "$PR_BASE" != "develop" ]; then
  echo "⚠️  PR #<N> targets '$PR_BASE' — retargeting to 'develop'"
  gh api repos/co-l/openfox/pulls/<N> -X PATCH -f base=develop
  git fetch origin
fi

# 3. Apply fixes, commit, and tag
# ... agent applies fixes ...
git add -A && git commit -m "review: fix ..."
git tag review-fix-<N>

# 4. Squash-merge the ORIGINAL PR (without your fixes)
gh api repos/co-l/openfox/pulls/<N>/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: description (#<N>)"

# 5. Update develop
git checkout develop && git pull origin develop --ff-only

# 6. Cherry-pick your fixes
git cherry-pick review-fix-<N>
git tag -d review-fix-<N>
git push origin develop

# 7. Clean up
workspace switch original
workspace delete review-pr-<N>
```

## Common Pitfalls

### Uncommitted fixes lost on merge

**Scenario:** You applied fixes in Phase 3, user tested in Phase 4, then said "merge it". You pushed and merged — but the fixes never made it in.

**Root cause:** The fixes were never committed. `git push` only sends commits, not unstaged/uncommitted changes.

**Prevention:** In Phase 5 step 7, always run `git status --short` before pushing. If it shows any changes, commit them first. The doc now has a ⚠️ marker at that step — treat it as a hard gate.

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
gh api repos/co-l/openfox/pulls/<N>/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: description (#<N>)"
```
