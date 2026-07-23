# Release Process

> Playbook for AI agents publishing OpenFox releases.
> Read this before every release to ensure CHANGELOG.md stays accurate and useful.

## Overview

OpenFox ships frequently — 2–3 patch versions per day.
Each release gets its own section in CHANGELOG.md with three categories:

| Category       | What goes here                                      |
|----------------|-----------------------------------------------------|
| **Features**   | Brand-new capabilities, new commands, new UI panels |
| **Enhancements** | Improvements to existing features, refactors, perf, docs |
| **Bug Fixes**  | Defect resolutions, crash fixes, incorrect behavior |

## Workflow

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

### 4. Present to the user for validation

Show the proposed changelog entry to the user before committing. Say something like:

> Here's the proposed changelog for v2.0.77 — take a look and let me know if you want any changes before I commit it.

Wait for the user to approve (or request edits). Only proceed once they sign off.

### 5. Prepend to CHANGELOG.md

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

### 6. Commit the changelog

```bash
git add CHANGELOG.md
git commit -m "docs: update changelog for upcoming release"
```

### 7. Bump version and tag

```bash
npm run patch
```

This runs `npm version patch` which creates a commit (`2.0.88`) and a tag (`v2.0.88`).

### 8. Publish

```bash
npm publish 2>&1 | tail -10
```

This triggers `prepublishOnly` which builds and runs e2e tests.

### 9. Push and create GitHub Release

```bash
git push --follow-tags
gh release create "$(git describe --tags --abbrev=0)" --generate-notes
```

### 10. Sync develop

```bash
git checkout develop && git merge main --ff-only && git push origin develop
```

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
- PDFs with embedded images are now fully understood. Diagrams, screenshots, and figures inside PDFs are extracted and sent to vision-capable models as images, or described via a fallback vision model for non-vision models. Previously, embedded images were silently lost.
- Configure a timeout for slow MCP tools. Set a per-server timeout (in seconds) from the Tools settings tab or via the mcp_config tool. Hanging or slow tool calls now abort gracefully instead of blocking indefinitely.
- View and manage session metadata in a full-screen modal. Click any metadata section in the sidebar (acceptance criteria, review findings, todos, etc.) to open a spacious modal where you can add, edit, delete, and cycle status on entries without truncation.

### Enhancements
- Workflow button styling polished. The "more options" (⋮) button now has comfortable padding, and the main workflow button shows clean rounded corners when no subgroup menu exists.

### Bug Fixes
- Agent no longer stalls after a failed tool call on LM Studio / Qwen. Fixed a critical bug where the agent loop would silently stop responding when a tool call failed. The agent now recovers and continues generating normally.
- MCP servers with broken outputSchema references now connect successfully. Servers like Stitch that include malformed $ref values in their tool schemas no longer crash AJV validation, preventing all tools from loading.
- Edit & Resend text area now uses full width. When editing a message, the input area expands beyond the usual 75% bubble width, making long edits much easier to work with.

## [2.0.0] - 2026-06-21
...
```

## Tips

- **Squash-merges on develop** mean each PR becomes one commit. The PR title is usually a good description for the changelog.
- **If the log is long** (>20 commits), focus on the ones a user would notice. Internal refactors can be summarized as "Various performance improvements and refactoring."
- **Breaking changes** are rare on the `2.0.x` track, but if one slips in, call it out prominently with a `**Breaking:**` prefix in the description.
- **First release on a new minor version** (e.g., `2.1.0`): start a fresh section above the existing ones.
