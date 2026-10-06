# Release Process

> Playbook for AI agents publishing OpenFox releases.
> Read this before every release to ensure CHANGELOG.md stays accurate and useful.

## Overview

OpenFox ships frequently — 2–3 patch versions per day.
Each release gets its own section in CHANGELOG.md with three categories:

| Category         | What goes here                                           |
| ---------------- | -------------------------------------------------------- |
| **Features**     | Brand-new capabilities, new commands, new UI panels      |
| **Enhancements** | Improvements to existing features, refactors, perf, docs |
| **Bug Fixes**    | Defect resolutions, crash fixes, incorrect behavior      |

## Workflow

Every step below runs on `develop`. Nothing touches `main` until step 11, when the fully tested and published release is merged over — so `main` always reflects a successful release, never a work in progress.

### 1. Determine the release range

Find the last tagged version and the current HEAD:

```bash
LAST_TAG=$(git tag --sort=-version:refname | head -1)
echo "Last tag: $LAST_TAG"
```

If the last tag is `v2.0.87` and you're releasing `v2.0.88`, the range is `v2.0.87..HEAD`.

### 2. Generate the changelog entry via sub-agent

Call the **explorer** sub-agent with this prompt (replace the tag range):

```
Analyze OpenFox commits between v2.0.87..HEAD and produce a changelog for version 2.0.88.

For each commit:
1. `git show <sha>` — examine the diff
2. `git show <sha>^:<file>` — examine each file's before-state
3. Compare before vs after to determine what changed from the user's perspective

Every claim must be traceable to a specific line/variable/function in the diff.

Categories:
- Features: completely new capability. If the concept already existed in the before-state, it's not a Feature.
- Enhancements: existing capability improved — faster, smoother, prettier.
- Bug Fixes: incorrect behavior corrected. Null checks, condition fixes, missing state wiring = Bug Fix.

Rules:
- One bullet per distinct change. Never merge unrelated changes.
- Max 100 chars per bullet. Punchy, user-first language.
- Skip migration shims, backward-compat glue, internal refactors.
- Skip changes that only handle old data formats or legacy fallbacks.

Return ONLY the raw markdown below. No commentary, no summaries.

### Features
- bullet

### Enhancements
- bullet

### Bug Fixes
- bullet
```

**Note:** The sub-agent produces a first draft. Expect to adjust categories, merge/split bullets, and trim noise during the validation step — that's normal.

### 3. Write the changelog entry

Take the sub-agent's output and wrap it in a version heading with the tag's date. Get the date from `git log -1 --format=%as <tag_name>`:

```markdown
## 2.0.77 - 2026-07-20

### Features

- PDFs with embedded images are now fully understood by the AI...
```

### 4. Validate formatting consistency

Before presenting to the user, cross-check your entry against the previous release's entry in CHANGELOG.md:

1. **Bullet format** — every bullet must use **bold lead-in** followed by `—` (space, em dash, space). Plain-text bullets are wrong.
2. **Blank lines** — one blank line between version heading and first category, one between category heading and first bullet.
3. **Section omission** — drop empty categories entirely.
4. **Character limit** — max ~100 chars per bullet, punchy and user-first.

Fix any mismatches before moving on.

### 5. Present to the user for validation

Show the proposed changelog entry to the user before committing. Say something like:

> Here's the proposed changelog for v2.0.77 — take a look and let me know if you want any changes before I commit it.

Wait for the user to approve (or request edits). Only proceed once they sign off.

### 6. Prepend to CHANGELOG.md

Once approved, insert the entry at the top of `CHANGELOG.md` (right after `# Changelog`):

```markdown
## 2.0.77 - 2026-07-20

### Features

- PDFs with embedded images are now fully understood by the AI...
- Configure a timeout for slow MCP tools...
- View and manage session metadata in a full-screen modal...

### Enhancements

- Workflow button styling polished...

### Bug Fixes

- Agent no longer stalls after a failed tool call on LM Studio / Qwen...
- MCP servers with broken outputSchema references now connect successfully...
- Edit & Resend text area now uses full width...
```

**Style guidelines:**

- Use sentence case for descriptions.
- Lead with the user-visible outcome, not the implementation detail.
- If a section is empty, omit it entirely (don't write "Features" with nothing under it).
- Every bullet must use **bold lead-in** followed by `—` (space, em dash, space) then the description. Match the existing formatting exactly — scan the previous entries to confirm consistency before proceeding.

### 7. Commit the changelog

```bash
git add CHANGELOG.md
git commit -m "docs: update changelog for upcoming release"
```

### 8. Bump version and tag

```bash
npm run patch
```

This runs `npm version patch` which creates a commit (`2.0.88`) and a tag (`v2.0.88`).

### 8b. Sync the web lockfile version

`npm version patch` bumps the root package but not `web/package-lock.json`, which embeds the root version in its `".."` reference — the next `npm install` in `web/` then rewrites it, producing a spurious diff. Sync it now (produces a minimal, dependency-free diff):

```bash
cd web && npm install --package-lock-only --no-audit --no-fund && cd ..
git add web/package-lock.json
git commit -m "chore: sync web lockfile to the released version"
```

**Do NOT "fix" the `".."` entry's name.** npm intentionally omits `"name": "openfox"` from the `".."` entry when the checkout folder is named `openfox` (to prevent churn based on the project's directory name), and adds it back when the folder has any other name. So the committed lockfile is folder-dependent: a workspace or clone named anything other than `openfox` will always show a `+ "name": "openfox"` diff after `npm install` — that is expected npm behavior, not a regression. Never commit that diff.

### 9. Publish

```bash
npm publish 2>&1 | tail -10
```

This triggers `prepublishOnly` which builds and runs e2e tests.

**Local model server unavailable?** The prepublish full-stack test normally drives onboarding against the hardcoded local model server. Set `OPENFOX_PUBLISH_E2E_LLM=prod` to instead use the provider configured in your production config (`~/.config/openfox/config.json`):

```bash
OPENFOX_PUBLISH_E2E_LLM=prod npm publish 2>&1 | tail -10
# or run the test alone:
npm run test:publish:e2e:prod
```

Defaults to `local` (off). Pick a specific provider with `OPENFOX_PUBLISH_E2E_PROVIDER="DeepSeek API"` and override the config path with `OPENFOX_PUBLISH_E2E_PROD_CONFIG`.

### 10. Push and create GitHub Release

```bash
git push --follow-tags
gh release create "$(git describe --tags --abbrev=0)" --generate-notes
```

### 11. Merge the successful release to main

All previous steps happen on `develop`. `main` only ever receives a fully tested, published release — never an in-progress one.

```bash
git checkout main && git merge develop --ff-only && git push origin main && git checkout develop
```

`--ff-only` keeps the release train linear: the merge only succeeds when `main` is strictly behind `develop`, so the two can never diverge.

## Example

### Before (CHANGELOG.md ends with):

```markdown
## [2.0.0] - 2026-06-21

...
```

### After releasing v2.0.77:

```markdown
## 2.0.77 - 2026-07-20

### Features

- **PDFs with embedded images are now fully understood** — diagrams, screenshots, and figures inside PDFs are extracted and sent to vision-capable models as images, or described via a fallback vision model for non-vision models. Previously, embedded images were silently lost.
- **Configure a timeout for slow MCP tools** — set a per-server timeout (in seconds) from the Tools settings tab or via the mcp_config tool. Hanging or slow tool calls now abort gracefully instead of blocking indefinitely.
- **View and manage session metadata in a full-screen modal** — click any metadata section in the sidebar (acceptance criteria, review findings, todos, etc.) to open a spacious modal where you can add, edit, delete, and cycle status on entries without truncation.

### Enhancements

- **Workflow button styling polished** — the "more options" (⋮) button now has comfortable padding, and the main workflow button shows clean rounded corners when no subgroup menu exists.

### Bug Fixes

- **Agent no longer stalls after a failed tool call on LM Studio / Qwen** — fixed a critical bug where the agent loop would silently stop responding when a tool call failed. The agent now recovers and continues generating normally.
- **MCP servers with broken outputSchema references now connect successfully** — servers like Stitch that include malformed $ref values in their tool schemas no longer crash AJV validation, preventing all tools from loading.
- **Edit & Resend text area now uses full width** — when editing a message, the input area expands beyond the usual 75% bubble width, making long edits much easier to work with.

## [2.0.0] - 2026-06-21

...
```

## Tips

- **Squash-merges on develop** mean each PR becomes one commit. The PR title is usually a good description for the changelog.
- **If the log is long** (>20 commits), focus on the ones a user would notice. Internal refactors can be summarized as "Various performance improvements and refactoring."
- **Breaking changes** are rare on the `2.0.x` track, but if one slips in, call it out prominently with a `**Breaking:**` prefix in the description.
- **First release on a new minor version** (e.g., `2.1.0`): start a fresh section above the existing ones.
