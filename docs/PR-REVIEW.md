# PR Review Workflow

> How to review, fix, and merge pull requests in OpenFox.

## Overview

PRs target `develop`. Features accumulate via squash-merges. `main` stays aligned with the latest published version (see [RELEASE.md](RELEASE.md)).

## Simple Review (no changes needed)

If the PR needs no fixes, squash-merge directly via the API:

```bash
gh api repos/co-l/openfox/pulls/<N>/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: description (#<N>)"

git checkout develop && git pull origin develop --ff-only
```

## Review + Fix (PR needs changes)

### Correct workflow (avoids worktree confusion)

```bash
# 1. Fetch the PR branch locally
gh pr checkout <N>

# 2. Create a worktree FROM the existing PR branch
#    (ensureWorktree detects the branch exists and skips -b)
worktree create <branch-name>

# 3. Apply fixes inside the worktree
#    ... make changes, run tests, commit ...

# 4. Push fixes back to the PR branch
git push origin HEAD:<remote-branch-name>

# 5. Close the worktree
worktree close

# 6. Squash-merge via API
gh api repos/co-l/openfox/pulls/<N>/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: description (#<N>)"

# 7. Update develop locally
git checkout develop && git pull origin develop --ff-only

# 8. Clean up local branch
git branch -D <branch-name>
```

### Concrete example

```bash
gh pr checkout 68
worktree create feature/drag-n-drop-files
# ... fix, commit, test ...
git push origin HEAD:feature/drag-n-drop-files
worktree close
gh api repos/co-l/openfox/pulls/68/merge -X PUT \
  -f merge_method=squash \
  -f commit_title="feat: support PDF, text, and SVG file attachments (#68)"
git checkout develop && git pull origin develop --ff-only
git branch -D feature/drag-n-drop-files
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

`worktree close` currently doesn't run `git worktree remove`. If you need to clean up manually:

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
