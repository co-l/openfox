# PR Review Workflow

> How to review, fix, and merge pull requests in OpenFox.

## Overview

PRs target `develop`. Features accumulate via squash-merges. `main` stays aligned with the latest published version (see [RELEASE.md](RELEASE.md)).

PRs can come from **same-repo branches** or **forks**. The workflow differs slightly — see below.

## Detect PR origin

Before starting, check whether the PR is from a fork:

```bash
gh pr view <N> --json headRepositoryOwner --jq '.headRepositoryOwner.login'
# Output: "co-l"           → same-repo branch
# Output: "JamesDAdams"    → fork
```

## Simple Review (no changes needed)

If the PR needs no fixes, squash-merge directly via the API:

```bash
gh api repos/co-l/openfox/pulls/<N>/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: description (#<N>)"

git checkout develop && git pull origin develop --ff-only
```

## Review + Fix (PR needs changes)

### Same-repo PRs

Your fix commits become part of the squash-merge — push them to the PR branch first.

```bash
# 1. Fetch the PR branch locally
gh pr checkout <N>

# 2. Create a worktree FROM the existing PR branch
#    (use the `worktree create` tool — detects existing branch, skips -b)
worktree create <branch-name>

# 3. Apply fixes inside the worktree
#    ... make changes, run tests, commit ...

# 4. Push fixes back to the PR branch
git push origin HEAD:<remote-branch-name>

# 5. Close the worktree
worktree close

# 6. Squash-merge via API (includes your fixes)
gh api repos/co-l/openfox/pulls/<N>/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: description (#<N>)"

# 7. Update develop locally
git checkout develop && git pull origin develop --ff-only

# 8. Clean up local branch
git branch -D <branch-name>
```

### Fork PRs

You generally can't push to the fork's branch. Instead, **merge the PR as-is**, then cherry-pick your fixes onto develop.

Tag your fix commits so they're easy to reference after the worktree is closed:

```bash
# 1. Fetch the PR branch locally
gh pr checkout <N>

# 2. Create a worktree FROM the existing PR branch
worktree create <branch-name>

# 3. Apply fixes inside the worktree
#    ... make changes, run tests, commit ...
#    Tag the fix commit(s) for later cherry-pick
git tag review-fix-<N>

# 4. Close the worktree (use the `worktree close` tool)
worktree close

# 5. Squash-merge the ORIGINAL PR (without your fixes)
gh api repos/co-l/openfox/pulls/<N>/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: description (#<N>)"

# 6. Update develop locally
git checkout develop && git pull origin develop --ff-only

# 7. Cherry-pick your fixes onto develop
#    Single fix:  git cherry-pick review-fix-<N>
#    Multi-fix:   git cherry-pick review-fix-<N>^..review-fix-<N>
git cherry-pick review-fix-<N>
git tag -d review-fix-<N>

# 8. Push
git push origin develop

# 9. Clean up local branch
git branch -D <branch-name>
```

#### Alternative: push directly to the fork

If you have push access to the fork, add it as a remote and push there:

```bash
gh pr checkout <N>
worktree create <branch-name>
# ... fix, commit, test ...

# Add fork as remote (one-time)
gh repo fork --remote --remote-name fork

# Push fixes to the fork's PR branch
git push fork HEAD:<remote-branch-name>

# Now squash-merge includes your fixes (continue with same-repo steps)
worktree close
gh api repos/co-l/openfox/pulls/<N>/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: description (#<N>)"
git checkout develop && git pull origin develop --ff-only
git branch -D <branch-name>
```

### Concrete example (fork)

```bash
gh pr checkout 78
worktree create feat/add-plugins-page
# ... fix, commit, test ...
git tag review-fix-78
worktree close
gh api repos/co-l/openfox/pulls/78/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: add plugin management UI (#78)"
git checkout develop && git pull origin develop --ff-only
git cherry-pick review-fix-78
git tag -d review-fix-78
git push origin develop
git branch -D feat/add-plugins-page
```

## Common Pitfalls

### Don't create a worktree first, then switch branches inside it

```bash
# WRONG — creates worktree from develop, then switches to PR branch
worktree create my-review       # branch created from develop
gh pr checkout 68               # switches to different branch → confusion
git add -A                      # stages cross-branch differences → disaster

# RIGHT — fetch PR branch first, then create worktree from it
gh pr checkout 68               # local branch from fork
worktree create feature/...     # branch exists → worktree created on it
```

### Pre-commit hook failures

The pre-commit hook runs the full test suite. If tests fail due to pre-existing issues in the PR code (not your changes), you can skip the hook:

```bash
git commit --no-verify -m "fix: ..."
```

But first try to fix the issue — the project aims to keep the hook passing.

### Orphaned worktrees

The `worktree close` tool doesn't run `git worktree remove`. If you need to clean up manually:

```bash
git worktree remove <path>      # deregister
rm -rf <path>                   # delete directory
```

## Squash-Merge via API

`gh pr merge` may fail with `GraphQL: Projects (classic) is being deprecated` even when the merge succeeds. Use the REST API directly:

```bash
# Change base to develop first (if targeting main)
gh api repos/co-l/openfox/pulls/<N> -X PATCH -f base=develop

# Squash-merge via API
gh api repos/co-l/openfox/pulls/<N>/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: description (#<N>)"

# Pull locally
git checkout develop && git pull origin develop --ff-only
```
