# Claude Code Compatibility

## Goal

Let OpenFox pick up a project that was set up for Claude Code without asking the user to duplicate anything.

OpenFox already reads `CLAUDE.md` as one of its instruction filenames, which looks like support but stops well short of it. Claude Code keeps skills in `.claude/skills`, memory in `.claude/CLAUDE.md` and `~/.claude/CLAUDE.md`, and composes memory files with `@file` imports. None of that was visible to OpenFox, so a user arriving from Claude Code silently lost most of their setup.

Two concrete failures on a real machine:

- Of 14 skills in `~/.claude/skills`, only the 8 that happened to be symlinks into `~/.agents/skills` were discovered. The 6 real directories were invisible.
- `~/.claude/CLAUDE.md` was never read at all — and its entire content was `@RTK.md`, so even reading it would have contributed nothing without import expansion.

## User Experience

A single tri-state setting in **Settings → Advanced**, "Claude Code Compatibility":

| Value            | Behaviour                                                         |
| ---------------- | ----------------------------------------------------------------- |
| `auto` (default) | on when the project holds a `.claude/` directory or a `CLAUDE.md` |
| `true`           | always on                                                         |
| `false`          | always off                                                        |

`auto` is the interesting one: a project that came from Claude Code carries its own marker, so the user configures nothing. A project that uses `AGENTS.md` is untouched, and nothing new enters its prompt.

When compatibility applies:

- Skills from `~/.claude/skills` and `<project>/.claude/skills` appear in the Skills modal under **Shared**, alongside the existing `.agents/skills` entries.
- `~/.claude/CLAUDE.md` and `<dir>/.claude/CLAUDE.md` join the instruction block.
- `@file` references inside any instruction file are replaced by the file's content.

## Technical Design

### Resolution

`src/server/shared/claude-compat.ts` owns the decision, so instructions and skills cannot drift apart:

```ts
readClaudeCompatMode(): 'auto' | 'enabled' | 'disabled'   // reads compat.claudeCode
isClaudeCodeProject(dir): Promise<boolean>                // .claude/ or CLAUDE.md present
resolveClaudeCompat(dir?, override?): Promise<boolean>    // override > setting > detection
```

Detection looks at the directory itself, not its ancestors. Walking up would reach `~/.claude` for any project under the home directory and turn compatibility on everywhere, which is not what "this project came from Claude Code" means.

`override` exists so callers that already resolved the flag can pass it down, and so tests never touch the developer's real `~/.claude`.

### Setting

`compat.claudeCode`, stored in the settings table, default `'auto'`. Tri-state rather than a boolean because a plain toggle cannot express "decide per project", which is the behaviour that makes the feature invisible when it should be.

### Skills

`loadAllSkillsWithDiagnostics` gains two roots, in precedence order (later wins):

```
bundled defaults
~/.agents/skills                     global-shared
~/.claude/skills                     global-claude      ← new
<configDir>/skills                   global-openfox
<selected directories>               selected
<project>/.agents/skills             project-shared
<project>/.claude/skills             project-claude     ← new
<project>/.openfox/skills            project-openfox
```

Claude roots sit just after their `.agents` counterpart and before OpenFox's own, so an OpenFox skill always wins an id collision. No parser work was needed: `loadPortableSkills` already reads `<dir>/SKILL.md` with `name` / `description` frontmatter, which is exactly Claude Code's format.

`EXTERNAL_SKILL_SOURCES` in `skills/types.ts` collects the sources that live outside OpenFox's own config, replacing the three places that each listed them inline (`canModifySkill`, the route's `readOnly` computation, the modal's "Shared" group).

### Instruction files

`findInstructionFiles` keeps its root-to-workdir walk. Compatibility adds:

- `~/.claude/CLAUDE.md` prepended before the walk, so user-level memory has the lowest priority and any project file overrides it.
- `<dir>/.claude/CLAUDE.md` checked at each level, after `AGENTS.md` and `CLAUDE.md`.

Paths are deduplicated, which matters when the walk reaches the home directory and would otherwise pick up user memory twice.

### `@file` imports

Applied while reading each instruction file:

- Resolved against the importing file's directory; `~/` expands to the home directory.
- Depth capped at 5, matching Claude Code.
- Every imported path is canonicalised through `realpath` and recorded, so a file is inlined once and cycles terminate. A repeat import yields an empty string rather than recursing.
- Skipped inside fenced blocks and inline code spans, so documentation that shows an `@import` example is not expanded.
- A path that does not resolve to a readable file is left exactly as written. `@mention` and `user@example.com` therefore survive untouched — a token is only an import if it points at something real.
- Inlined content is prefixed with `Instructions from: <path>`, the same provenance marker the loader already uses for top-level files.

The match rule is `(^|[\s(])@<non-space>`: the `@` must open a word, which is what excludes e-mail addresses without needing to special-case them.

### Deduplication

Instruction files are hashed (SHA-256 over trimmed content) and a file whose content was already collected is dropped. Empty files are dropped too.

This is **not** gated by the setting. Repositories very commonly ship `AGENTS.md` and `CLAUDE.md` as copies or symlinks of each other, and both were being sent to the model — a correctness bug that predates this feature and is unrelated to Claude Code.

`loadInstructionFiles` now reads each file once and returns the content, so `getAllInstructions` no longer re-reads them to populate its file list, and that list reports only what was actually injected.

### Diagnostics

The "reached through multiple paths" skill diagnostic now fires only when a directory the user picked (`selected`) overlaps another root. Two automatic roots symlinked into each other — `.claude/skills` → `.agents/skills` is a common way to share one library between both tools — produced one line of noise per skill and nothing the user could act on.

## Edge Cases

- **Symlinked skill directories.** `loadPortableSkills` resolves `realpath`, so the same package reached from `.agents/skills` and `.claude/skills` collapses to one entry.
- **Import cycles.** `a.md` importing `b.md` importing `a.md` terminates: the visited set is seeded with the root file's canonical path.
- **Import inside a code block.** Fence state is tracked line by line; inline spans are handled by splitting on backticks and expanding only the even segments.
- **Unreadable or missing instruction file.** Skipped silently, as before. It no longer leaves a content-less entry in the injected file list.
- **Home directory inside the walk.** A workdir under `$HOME` walks through `$HOME` itself, which would match `~/.claude/CLAUDE.md` a second time; path deduplication prevents it.
- **Prompt cache.** Instruction content and skill ids already feed `computeDynamicContextHash`, so switching the setting or entering a Claude Code project invalidates the cached prompt through the existing mechanism.
- **Windows.** Discovery uses `path.join` throughout and adds no shell or separator assumptions.

## Out of Scope

Deliberately not covered, and still invisible to OpenFox:

- `.claude/agents/*.md` (sub-agent definitions) — a different frontmatter contract from OpenFox's `.agent.md`
- `.claude/commands/*.md` (slash commands)
- `.mcp.json` (project-scoped MCP servers) — OpenFox stores servers in its database
- `.claude/settings.json` (hooks, permissions, environment)
- Plugin skills under `~/.claude/plugins`, which use a marketplace layout rather than a plain skills directory
