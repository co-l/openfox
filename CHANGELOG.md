# Changelog

## 2.0.87 - 2026-07-22

### Bug Fixes
- **AskUserCard no longer crashes when the LLM returns options as a string** — if the model produces a malformed `options` field (a string instead of an array), the card gracefully falls back to a free-text input instead of throwing `options.map is not a function`.

## 2.0.86 - 2026-07-22

### Enhancements
- **Unified time formatting across the UI** — consistent human-readable durations (decimals for <10s, integer seconds for 10-59s, m/s for <1h, h/m/s for ≥1h).

### Bug Fixes
- **Dev server "Open" button works after workspace switch** — resolved URL and inspect proxy port now propagate correctly through WebSocket state updates.
- **Mode-switch race condition fixed** — commands sent with an agent mode switch now await the mode change before dispatching, preventing execution in the wrong mode.

## 2.0.85 - 2026-07-22

### Features
- **Clickable session links** — error messages and tool outputs that reference a session now include a clickable link to open it directly.
- **Force-delete workspaces** — delete a workspace even when another session is using it. Conflicting sessions are shown as clickable links.
- **Configurable default agent** — choose which agent type (builder, planner, etc.) new sessions default to, from Settings, config file, or env var.

### Enhancements
- **Agent display names shown instead of internal IDs** — the agent selector now shows human-readable names.
- **Delete confirmation for custom agents** — prevents accidental deletion of custom agent definitions.
- **Slug validation for custom agents** — built-in agent IDs cannot be reused as custom agent slugs.

### Bug Fixes
- **Snapshot metadata no longer silently lost** — metadata entries (criteria, test cases, review findings) are now merged instead of replaced when post-snapshot events exist.
- **Advanced model params preserved when reopening provider modal** — temperature, topP, topK, maxTokens, compactionThreshold no longer silently reset to defaults when editing a model.

## 2.0.84 - 2026-07-22

### Features
- **Search sessions in the sidebar** — type to instantly filter your session list by title or recent prompts. Matching text is highlighted, a match counter shows results, and you can navigate with Arrow Up/Down and press Enter to open one. Press Ctrl+S from anywhere to jump straight to the search box.

### Enhancements
- **Graceful handling of non-git projects** — when a project isn't a git repository, workspace and branch management options are hidden from the sidebar with a clear explanation.

### Bug Fixes
- **Path confirmation buttons now below tool output** — the Deny/Allow/Allow Everything buttons appear after the tool's rendered content, so you see what you're approving before deciding.
- **Message search no longer scrolls the timeline to the bottom** — navigating between search results keeps the matched message centered in view.
- **New workspace branches use the right starting point** — creating a workspace branch without specifying a source branch now forks from your currently active branch rather than the remote's default.

## 2.0.83 - 2026-07-22

### Bug Fixes
- **Windows reliability fix** — `FileNotReadError` on newly created files resolved by fixing cache key normalization for Windows paths.
- **Git operations fully isolated from hook environment** — all inherited `GIT_*` environment variables are now stripped from spawned git processes, preventing husky/pre-commit interference.
- **step_done UI consistency** — border and spacing added to match the visual treatment of regular tool call displays.

## 2.0.82 - 2026-07-21

### Features
- **HTTP proxy support for LLM providers** — route LLM traffic through an HTTP proxy, configured per provider or globally.
- **Provider name display and autocomplete search** — the provider selector now shows the provider name next to the model and supports autocomplete-style search.
- **Keyboard navigation and configurable Ctrl+M shortcut** — navigate the provider selector with arrow keys; Ctrl+M shortcut is now configurable in Settings → Keybindings.

### Enhancements
- **Removed redundant branch consistency check** — the check that compared local vs remote branch state on every action was removed, speeding up common operations.

### Bug Fixes
- **Parallel sub-agent calls no longer fragment display groups** — multiple sub-agent results appearing at the same time now stay grouped correctly in the chat feed.

## 2.0.81 - 2026-07-21

### Enhancements
- **Workspace and git confirmations are now opt-in** — the agent moves faster without unnecessary interruption. Enable "Confirm on workspace & git actions" in Settings → Tools if you want an extra layer of approval.
- **Removed redundant escape-detection logic** — the path sandbox already prevents any file access outside the project directory, so noisy checks for `cd ..`, `git -C`, etc. served no purpose and are removed.

### Bug Fixes
- **File-read previews consistently cap at max height** — code, text, and image previews in the chat now respect their height limit even when a tool call is expanded, fixing a layout issue where previews could grow without bounds.

## 2.0.80 - 2026-07-21

### Features
- **Per-model auto-compaction threshold** — configure when context compaction kicks off independently for each model in the provider settings UI. A built-in safety ceiling guarantees at least 5K tokens of headroom regardless of your setting.

### Enhancements
- **Fewer false-positive security prompts** — running `cd` to an absolute path inside your project directory no longer triggers an unnecessary confirmation dialog. The escape detector is now workdir-aware.
- **Softer tool descriptions** — the `run_command` tool no longer threatens users with warnings about prepending `cd`, reducing confusion for newcomers.

### Bug Fixes
- **Agent mode no longer silently reverts to Planner** — switching to Builder or Chat mode now sticks. Previously, navigating away from a session and coming back could reset the mode.
- **Content no longer jumps when scrollbars appear** — the chat feed, sidebars, log viewer, and readonly session view now reserve space for the scrollbar gutter, eliminating jarring layout shifts.
- **Sequential security confirmations no longer collide** — when a single tool action triggers multiple confirmation prompts, each now gets its own unique ID.
- **Path confirmation errors are now surfaced** — if the server fails to process a path confirmation, the error is logged to the console instead of being silently swallowed.

## 2.0.79 - 2026-07-21

### Bug Fixes
- **F5 refresh restored on deep SPA routes** — pressing F5 on a page like `/p/my-project/s/some-session` no longer breaks. The Vite base was reverted to `'/'` with `OPENFOX_BASE_PATH` env override for subpath deployments.

### Enhancements
- **`OPENFOX_BASE_PATH` documented in README** — enabling subpath deployments behind a reverse proxy is now discoverable.

## 2.0.78 - 2026-07-21

### Features
- **Custom workspace root directory per project** — instead of always storing workspaces under the global directory, you can now configure any path as the workspace root. The UI validates the path and warns if existing workspaces would become orphaned.
- **Git mutation safety with user confirmation** — dangerous git commands (checkout, push, reset, rebase, etc.) and attempts to escape the workspace now pop a confirmation dialog instead of being silently blocked.
- **Branch persistence across reloads** — the currently checked-out branch survives page refreshes and session restarts.
- **Source branch selection when branching** — when creating a new branch, you can now specify which branch to fork from.

### Enhancements
- **Massively faster session loading** — sessions with thousands of messages load 13x faster for message processing and 29% faster HTTP responses. Large conversations are truncated server-side before reaching the UI.
- **Terminal opens in your workspace directory** — the integrated terminal now defaults to the active workspace path instead of the project root.

### Bug Fixes
- **Reverse proxy subpath deployments now work** — all API calls, WebSocket connections, and asset paths are automatically prefixed when hosted at a subpath.
- **No more "vv2.0.77" version display** — the auto-update panel no longer doubles the "v" prefix.
- **`npm install -g openfox` succeeds on Debian 13 / npm v12+** — systems that require explicit `allowScripts` declarations for native modules no longer fail during installation.

## 2.0.77 - 2026-07-20

### Features
- **PDFs with embedded images are now fully understood** — diagrams, screenshots, and figures inside PDFs are extracted and sent to vision-capable models as images, or described via a fallback vision model for non-vision models. Previously, embedded images were silently lost.
- **Configure a timeout for slow MCP tools** — set a per-server timeout (in seconds) from the Tools settings tab or via the `mcp_config` tool. Hanging or slow tool calls now abort gracefully instead of blocking indefinitely.
- **View and manage session metadata in a full-screen modal** — click any metadata section in the sidebar (acceptance criteria, review findings, todos, etc.) to open a spacious modal where you can add, edit, delete, and cycle status on entries without truncation.

### Enhancements
- **Message bubble expands during Edit & Resend** — when editing a message, the input area now stretches to full width, giving you far more room to work with long prompts.

### Bug Fixes
- **Agent no longer stalls after a failed tool call on LM Studio / Qwen** — the agent loop now recovers and continues generating normally instead of silently stopping.
- **MCP servers with broken outputSchema references now connect successfully** — servers like Stitch that include malformed `$ref` values in their tool schemas no longer crash AJV validation.
- **Workflow button cosmetics fixed** — the three-dot menu button now has comfortable padding, and standalone workflow buttons show clean rounded corners.

## 2.0.76 - 2026-07-20

### Features
- **Google Antigravity plugin** — new plugin with browser-based auth flow for Google providers.

### Bug Fixes
- **Sub-agent alias tool calls transformed before event emission** — tool calls made through aliased names are now correctly mapped before reaching the event system.
- **@ file autocomplete shows files beyond depth 5** — the file autocomplete in the chat input now searches deeper than 5 directory levels.

## 2.0.75 - 2026-07-19

### Features
- **VSCode integration for workspace and git panel links** — click to open files in VSCode directly from the OpenFox UI, with WSL path translation support.
- **Cross-session confirmation broadcast** — confirmations (like path approvals) now broadcast across all sessions, so you approve once and it applies everywhere.
- **Native browser dialogs replaced with React Modal components** — all remaining `alert()`, `confirm()`, and `prompt()` calls are now rendered as proper modals within the app.

### Bug Fixes
- **Persistent launcher installation in CLI** — `openfox install-launcher` now correctly registers the desktop entry and survives system updates.

## 2.0.74 - 2026-07-18

### Features
- **Update check feedback and global availability badge** — the update checker now shows a badge in the header when a new version is available.
- **Keyboard shortcut removal in settings** — you can now remove (not just reassign) keyboard shortcuts in Settings → Keybindings.
- **Inline message editing with visible action buttons** — user messages now show Edit and Resend buttons on hover, making it obvious you can modify your prompts.
- **Improved dev mode version check and page title** — the page title now reflects the current version and dev mode status.

### Bug Fixes
- **Session-scoped branch operations** — branch operations are now correctly scoped to the session's workspace, preventing cross-session git conflicts.
- **Config directory created before auth.key write** — ensures the config directory exists before writing the authentication key during first-time setup.

## 2.0.73 - 2026-07-18

### Bug Fixes
- **Renamed worktree to workspace in builtin agent definitions** — all built-in agent configurations now use the term "workspace" consistently, fixing tool access issues after the worktree → workspace rename.

## 2.0.72 - 2026-07-18

### Features
- **Windows support** — OpenFox now runs natively on Windows. Fixed: visible console windows popping up per command, broken path handling on Windows-style paths, orphaned cmd.exe processes, and silent command failures from incorrect shell quoting. The full test suite (2200+ tests) passes on Windows 11.
- **Workspaces are now named clones, not git worktrees** — a workspace is a full `git clone --shared` copy of your project, independent of any branch name. You pick the name, you pick the branch. Switching is a single action.
- **Simplified workspace tool actions** — the workspace tool now has just three actions: `switch`, `list`, and `delete`. The old `status` and `list_branches` actions are removed.
- **Automatic staleness hints** — when you switch to a workspace that has fallen behind, the agent tells you how many commits behind you are and suggests pulling.

### Enhancements
- **Compact `step_done` display** — the `step_done` tool call now renders as a tiny inline pill instead of a bulky collapsible card.

### Bug Fixes
- **Stable message ordering** — messages no longer appear out of sequence when a tool result arrives at the exact same moment as a user message.
- **Correct sub-agent token display** — sub-agent context usage no longer overwrites the main agent's displayed counters.
- **Accurate staleness detection** — the behind-count comparison now fetches remote refs before checking, so the staleness hint reflects real divergence.

## 2.0.71 - 2026-07-18

### Enhancements
- **Windows is now fully supported** — `openfox update`, `openfox service`, and `openfox pwa install` all work on Windows. Previously they relied on bash scripts, systemd, and curl.

### Bug Fixes
- **File attachments no longer silently dropped** with transport-based LLM providers (e.g. GitHub Copilot proxy). Text files, PDFs, and images are now resolved into the message content before reaching the provider.
- **Cancelling or timing out a command with background processes no longer hangs** — the entire process tree is killed reliably and the tool returns promptly.
- **Workflow shell commands that time out now clean up all child processes** — previously only the top-level shell was killed, leaving orphans.
- **The chat no longer appears stuck when the agent asks a question** — the client now receives a proper `waiting_for_user` signal.
- **Long provider URLs no longer break the onboarding card layout** — URLs are truncated with ellipsis instead of overflowing.

## 2.0.70 - 2026-07-17

### Bug Fixes
- **Plugin registry path resolution fixed** — the plugin registry now loads correctly in production builds (was looking in the wrong directory).
- **MCP form logic deduplicated** — internal refactoring of MCP form validation with no user-facing change.

## 2.0.69 - 2026-07-17

### Features
- **Plugin Management UI** — browse the built-in plugin registry (ChatGPT, GitHub Copilot), install, update, and remove plugins directly from Settings. Add custom plugins from any GitHub URL.
- **PDF, text, and SVG file attachments** — drag-and-drop or upload PDFs, text files, SVGs, JSON, XML, YAML, JS, shell scripts alongside images. Non-image files appear as compact file cards with extension icon, size, and inline text preview.
- **Windows shell picker** — choose between cmd, PowerShell, or Git Bash for the agent's shell in Settings → Tools. The system prompt tells the model which shell is active.
- **Edit existing MCP server configurations** — modify the command, arguments, environment variables, or transport type of any configured MCP server from the UI. No more delete-and-re-add.
- **Multiline acceptance criteria paste** — paste a block of text into the criteria editor; each non-empty line becomes a separate criterion.
- **Session metadata visible in sidebar** — custom metadata keys set by the agent or tools now appear in the session sidebar alongside built-in fields.
- **Workspace system overhaul** — workspaces are now named clones (`git clone --shared`) instead of git worktrees. A workspace name is independent of its branch. Configure per-workspace setup commands via `.openfox/workspace.json`.

### Enhancements
- **Long-session performance** — chat feeds with hundreds of messages now render faster and stay responsive during scrolling and hovering.
- **Sub-agent history always visible** — collapsed sub-agent panels show the full message history again.
- **Workspace staleness hints** — when switching to a workspace that's behind its source branch, the agent sees a hint and can suggest pulling.
- **Simplified workspace tool** — three actions: `list`, `switch`, `delete`. The old `status` and `list_branches` actions are gone.
- **Delete workspaces from the UI** — with inline confirmation. If you're in the deleted workspace, you're automatically switched back to the original project.

### Bug Fixes
- **Windows: folder selection, CLI commands, LSP servers, unit tests all fixed** — OpenFox now runs fully on Windows.
- **Provider: local toggle not saving, stale adapters on engine switch, file attachments lost with transport plugins** — all resolved.
- **Messages: scrambled order on fast replies, sub-agent token counts overwriting main agent, step_done renders as compact pill, empty tool arguments handled gracefully** — all fixed.
- **Commands: abort no longer hangs with backgrounded processes, timeouts kill full process tree** — clean teardown guaranteed.
- **Dev server: port collisions eliminated, lifecycle tied to workspace** — no more orphaned processes.
- **Git: wrong-repo corruption from inherited env vars fixed, accurate staleness info** — git operations are now safe.
- **Path security: paths containing "s/" no longer corrupted** — false confirmation prompts eliminated.

## 2.0.68 - 2026-07-17

### Features
- **Plugin Management UI** — browse the built-in plugin registry, install plugins from GitHub, manage installed plugins from Settings.
- **PDF, text, and SVG file attachments** — drag-and-drop or upload non-image files alongside images. Non-image files appear as compact file cards.
- **Windows shell picker** — choose between cmd, PowerShell, or Git Bash for the agent's shell.
- **Configurable worktree asset strategy** — control how `.gitignored` files are handled in git worktrees via `.openfox/worktree.json`.

### Enhancements
- **Multiline acceptance criteria paste** — paste multiple lines at once; each becomes a separate criterion.
- **Worktree strategy UI polished** — matches the app's danger-level pill-button pattern.

### Bug Fixes
- **Stale provider state when switching inference engines** — adapter settings from the previous engine are now cleared.
- **Local provider toggle not saved when unchecked** — now persists across restarts.
- **Crash on empty tool call arguments** — handled gracefully with a parse error logged.
- **False "outside workdir" prompts on Windows** — command switches like `dir /s` no longer trigger spurious confirmations.
- **Folder selection broken on Windows** — backslash paths now work correctly.
- **False path-confirmation prompts from "s/" in paths** — sed-substitution sanitizer no longer corrupts paths containing "s/".
- **Non-vision models lose image filename context** — image descriptions now include `[Image: filename]` wrapper.
- **Worktree asset default changed to `skip`** — nothing is symlinked or copied unless explicitly configured.
- **Symlink corruption during worktree asset copy** — symlink targets are now preserved verbatim.
- **Per-worktree dev server lifecycle** — closing a worktree session stops its dev server. Git status refreshes immediately on worktree change.
- **Inspect proxy port collisions** — port probing now uses actual bind attempts instead of stale tracking.
- **Git command interference from inherited environment** — `GIT_DIR`, `GIT_INDEX_FILE`, etc. are stripped from spawned git commands.

## 2.0.67 - 2026-07-17

### Features
- **Windows shell picker** — choose between cmd.exe, PowerShell, or Git Bash for agent commands and integrated terminals. Git Bash gives the agent a Unix-like toolset.
- **Configurable worktree asset strategy** — control how .gitignored files are handled when creating git worktrees: symlink, copy, or skip.

### Bug Fixes
- **Safer worktree default** — default strategy changed from symlink to skip. Nothing is linked or copied unless you explicitly configure it.
- **Fixed gitignored directory detection** — `git ls-files` now correctly identifies ignored directories.
- **Symlinks preserved during copy** — relative symlinks inside node_modules are now preserved as relative symlinks when copying into a worktree.
- **No more orphaned dev servers on worktree close** — closing a git worktree now stops its associated dev server process.
- **Reliable inspect proxy ports** — port allocation now uses real bind probes instead of stale tracking, eliminating race conditions.

## 2.0.66 - 2026-07-17

### Features
- **Git worktrees for parallel sessions** — run multiple sessions on the same project simultaneously using git worktrees. Each session gets its own isolated branch and working directory. The dev server automatically detects worktrees and assigns free ports.
- **Multiline acceptance criteria paste** — paste a list from your issue tracker; each line becomes a separate criterion.

### Bug Fixes
- **Switching inference engines no longer leaves stale adapters** — auth and transport adapters are properly cleared on engine switch.
- **Empty tool call arguments handled gracefully** — no more crashes when the LLM emits malformed JSON.
- **Windows folder selection works** — backslash-separated paths are now parsed correctly.
- **Windows command switches no longer trigger false security prompts** — `dir /s` and similar are correctly distinguished from absolute paths.
- **Local provider toggle saves correctly** — unchecked state is now persisted.
- **Running inside a git hook no longer corrupts the parent repo** — inherited `GIT_DIR` etc. are stripped.
- **Colored command output no longer prematurely truncated** — ANSI codes are stripped before measuring output limits.
- **Context token counts no longer stuck at 0** — compaction counters work correctly.
- **Workflow executor uses correct worktree directory** — operates on the worktree root instead of the project root.

## 2.0.65 - 2026-07-16

### Features
- **RTK auto-rewrite for shell commands** — enable in Settings → Tools → Token Optimization, and every `run_command` invocation is piped through `rtk rewrite` for leaner, token-efficient output.

### Enhancements
- **Model selector dropdown now flexes to fit content** — no more truncated provider or model labels.

## 2.0.64 - 2026-07-15

### Bug Fixes
- **Sub-agents no longer hang on out-of-project file reads** — path confirmation dialogs that scrolled out of view in the small sub-agent window are now skipped. Access is denied immediately with a clear error.

### Enhancements
- **Sub-agent tool alias resolution is now more reliable** — handled as an explicit dispatch stage rather than a fallback error handler.

## 2.0.63 - 2026-07-15

### Features
- **Connect your ChatGPT Plus/Pro account** — install the `openfox-chatgpt` plugin to authenticate with your OpenAI account via device authorization. Unlocks models like GPT-5.6 with WebSocket streaming.
- **Third-party provider plugin system** — anyone can write a plugin that adds custom authentication flows, API transports, and provider presets. Plugins appear as tiles in the "Add Provider" wizard.
- **Reasoning effort dropdown** — when a model supports reasoning effort levels, you get a dropdown selector instead of a free-text field.

### Enhancements
- **Rich tool output in the chat feed** — `call_sub_agent`, `web_search`, `web_fetch`, `load_skill`, `mcp_config`, `dev_server`, `background_process`, and `trace_code` results now render in human-readable formats instead of raw JSON.
- **Truncation warnings** — when a tool's output is cut off, a prominent "Output truncated" badge appears inline.
- **Auto-expand all tools in verbose mode** — every tool call expands automatically for full visibility.
- **Cleaner `step_done` display** — completed steps show as a simple header row.
- **More readable collapsed tool headers** — tool argument summaries now show meaningful labels.
- **Increased result viewport** — generic fallback results grew from `max-h-32` to `max-h-[60vh]`.
- **Onboarding navigates to home after setup** — instead of going back in history.
- **Closing "Add Provider" without saving cleans up** — no orphaned providers left behind.
- **Provider names from catalog** — model lists show human-readable names instead of raw model IDs.

### Bug Fixes
- **SSE errors no longer crash the orchestrator** — error messages are surfaced instead of crashing with a missing-choices exception.
- **Session-scoped provider clients preserve auth context** — each session creates its own LLM client, ensuring plugin-based transports apply correctly.
- **Auto model resolution persisted to sessions** — the resolved concrete model is written back to the session record.
- **Provider config changes rebuild the active client** — editing a provider takes effect immediately.
- **Memory leak fixed in provider modals** — timer intervals for device-code auth are properly cleaned up on unmount.
- **Custom global config paths respected** — auth flows now use the configured path instead of hard-coding the default.

## 2.0.62 - 2026-07-15

### Features
- **PDF text extraction** — `read_file` and `web_fetch` now detect PDF files and extract their text content page by page, including document metadata. Password-protected and scanned PDFs are handled with clear error messages.

### Enhancements
- **MCP config changes now ask you to confirm** — adding, removing, or toggling MCP tools no longer silently rebuilds the system prompt. You control when to apply changes.

### Bug Fixes
- **No more false path-confirmation popups from git commit messages** — path-like strings inside `-m`/`--message` arguments are now correctly ignored during path extraction.

## 2.0.61 - 2026-07-15

### Features
- **Web search tool** — the agent can now search the web using Tavily or SearXNG, configured in Settings → Tools.

### Enhancements
- **Web search test button** — test your search configuration with a success/failure indicator.
- **Web search config moved to Tools tab** — alongside other tool settings for discoverability.

### Bug Fixes
- **Portable skill packages now included in build** — skills created in the portable format are correctly copied to the distribution directory.

## 2.0.60 - 2026-07-15

### Features
- **Drag-and-drop skill installation** — drop a folder containing `SKILL.md` plus assets onto the Skills panel to install it as a portable skill package.
- **External skill libraries** — pick any directory on your filesystem as a shared skill library. Skills stored there appear alongside your built-in and user skills.
- **Enable/disable skills without deleting** — each skill has a toggle switch. Disabling keeps the skill file intact but removes it from the active set.
- **Portable skill format** — skills are now directories (`my-skill/SKILL.md`) instead of flat `.skill.md` files. Assets live alongside the instructions.

### Enhancements
- **Directory browser overhaul** — breadcrumbs and search bar stay pinned while the folder list scrolls. Each folder has its own "Select" button. Keyboard navigation reworked with Enter to select, Shift+Enter to navigate in.
- **Skill diagnostics** — warnings appear for naming convention violations, ID/directory mismatches, and duplicate skills.

### Bug Fixes
- **Accidental folder selection eliminated** — clicking a folder row only navigates; selection requires an explicit button press.

## 2.0.59 - 2026-07-15

### Enhancements
- **File search skips junk directories** — `node_modules`, `.git`, `dist`, `.next`, `build`, `coverage` are automatically excluded. Results respect your `.gitignore`.

### Bug Fixes
- **Heredoc comments no longer trigger false path-confirmation prompts** — lines like `// @vitest-environment` inside multi-line commands are correctly ignored.
- **Windows no longer flashes a console window for every child process** — shell commands, git operations, LSP servers, and auto-updates run silently.

## 2.0.58 - 2026-07-14

### Features
- **Search sessions on the homepage** — type any keyword to instantly filter your sessions. Matches are found in titles, recent prompts, and project names, with relevance ranking and character highlighting.

### Enhancements
- **LM Studio is now a first-class backend** — a dedicated LM Studio button (port 1234) in the provider setup modal. OpenFox queries LM Studio's native API for accurate context length detection.

## 2.0.57 - 2026-07-14

### Bug Fixes
- **Model settings no longer leak between concurrent sessions** — running two sessions in parallel with different providers no longer causes parameters to flip unpredictably.
- **Speculative cache warming now respects the session's provider and model** — warmup requests use the correct parameters, so the cache is actually primed for the right configuration.
- **Aborting a shell command now kills the process tree immediately** — SIGKILL is sent instantly instead of waiting 200ms between SIGTERM and SIGKILL.

## 2.0.56 - 2026-07-14

### Features
- **Syntax highlighting for any programming language** — Shiki dynamically loads language definitions on demand. PHP, Rust, Go, and dozens of other languages render correctly instead of throwing "Language not found" errors.
- **Timeline search shows image attachment badges** — messages with images are labeled "[Image attached]" in search results.
- **Image-only messages accepted** — you can share a screenshot without typing anything.

### Bug Fixes
- **Syntax highlighter no longer crashes under rapid concurrent UI updates** — during streaming responses with multiple code blocks.
- **Long unbroken text no longer overflows message bubbles** — URLs, file paths, and code now wrap properly.
- **Logout button navigates smoothly instead of hard-reloading** — no more full page refresh.
- **macOS symlinked system directories handled correctly** — `/tmp → /private/tmp`, `/etc → /private/etc` no longer cause incorrect file access decisions.

## 2.0.55 - 2026-07-13

### Bug Fixes
- **Sessions no longer leak across projects with nested workdirs** — sessions are matched to their project by a stable project ID instead of a string prefix check.
- **Provider configuration is no longer discarded when clicking outside the modal** — the dialog stays open until you explicitly close it.

## 2.0.54 - 2026-07-13

### Bug Fixes
- **No more orphaned processes left behind after aborting or timing out a command** — OpenFox now hunts down every descendant process via the process tree and kills them all, ensuring a clean teardown every time.

## 2.0.53 - 2026-07-13

### Bug Fixes
- **Syntax highlighting setting now works everywhere** — disabling it suppresses highlighting across all code display surfaces (diffs, file previews, edit contexts, read-file views).
- **Configured default model no longer overridden by auto-detection on startup** — your chosen model stays put.

## 2.0.52 - 2026-07-13

### Features
- **Pick which models to use from a provider** — search through the list and check only the ones you want. Unchecked models won't clutter the model selector.
- **Faster, simpler provider setup** — the provider modal went from 3 steps down to 2. The review step is gone; you save directly from the test-and-configure screen.

### Enhancements
- **Smarter auto-configuration** — runs only when you select a model, not for every model at once.
- **Your default model survives provider edits** — adding or editing a provider no longer resets your default model.
- **See sensible defaults immediately** — profile defaults (temperature, top_p, etc.) are filled in so the UI shows real values instead of empty fields.
- **Accidental provider deletion is harder** — removing a provider now requires a two-click confirmation.

### Bug Fixes
- **Replay now replays the right message** — uses the message's unique ID instead of a display index that could mismatch across context windows.
- **Cloud provider responses no longer come back garbled** — removed the global HTTP/2 dispatcher that was corrupting gzip-compressed responses.
- **OpenAI and Anthropic backends no longer crash** — proper capability definitions added for these backends.

## 2.0.51 - 2026-07-13

### Bug Fixes
- **Conversation history order preserved after parallel tool calls** — tool results are now always stored in the same order they were called, keeping the model's prefix cache intact and responses fast.

## 2.0.50 - 2026-07-10

### Features
- **Per-session model selection** — each session remembers its own model independently of the global default. A dot indicator tells you when the current session uses a non-default model.
- **Dedicated global default model control** — set your preferred default model via a star icon in the provider selector.

### Bug Fixes
- **Manual compaction is now abortable** — aborting a session cancels manual compaction immediately instead of letting it run to completion.

## 2.0.49 - 2026-07-09

### Features
- **New "Add criteria" builtin command** — ask the planner agent to define and record acceptance criteria for a task using the `session_metadata` tool.

### Enhancements
- **Faster commit-push flow** — the agent no longer runs `npm test` before every commit. Tests are still verified after rebasing if a push fails due to upstream changes.

## 2.0.48 - 2026-07-09

### Bug Fixes
- **Deleting a running session now stops the agent immediately** — no more orphaned LLM calls or tool executions after deleting a session.
- **`openfox update` no longer produces "Cannot find package" errors** — now does a clean install instead of relying on `npm update -g`.

## 2.0.47 - 2026-07-09

### Enhancements
- **Clean file content from `read_file`** — text files are returned without `N|` line-number prefixes. The line range is still available in metadata for those who need it.

## 2.0.46 - 2026-07-09

### Features
- **Speculative cache warming** — when enabled in Settings > Advanced, the LLM cache is pre-filled on your first keystroke in an empty session. The next response starts streaming faster.

### Enhancements
- **Opt out of automatic session naming** — set `OPENFOX_DISABLE_AUTO_SESSION_TITLE=true` or add `"disableAutoSessionTitle": true` to config.json.

## 2.0.45 - 2026-07-08

### Features
- **LLM timeout configuration in global config** — persist `llm.timeout` and `llm.idleTimeout` in your global config JSON instead of requiring environment variables.

### Bug Fixes
- **Migration no longer incorrectly strips the `llm` config key** — when the key contains valid timeout settings, it's preserved during migration.

## 2.0.44 - 2026-07-08

### Features
- **Configure LLM timeout via environment variables** — `OPENFOX_LLM_TIMEOUT` and `OPENFOX_LLM_IDLE_TIMEOUT` replace the previously hardcoded 5-minute defaults.

### Enhancements
- **All environment variables documented in README** — no more digging through source code to discover what you can configure.

### Bug Fixes
- **Models no longer confuse line-number separators with code indentation** — eliminating spurious edit failures when editing indented code.

## 2.0.43 - 2026-07-08

### Bug Fixes
- **Stop session is now fully reliable** — hitting stop/cancel during an agent response had a tiny timing window where a new LLM request could slip through. That window is now closed.

## 2.0.42 - 2026-07-08

### Bug Fixes
- **CLI no longer crashes on startup** — fixed a runtime dependency resolution failure that caused the CLI to crash when attempting interactive prompts.

## 2.0.41 - 2026-07-08

### Enhancements
- **More reliable code tracing** — the AI agent now understands that the `file` parameter for `trace_code` is just a seed for LSP. It can use any file that references a symbol, not just the definition file.

## 2.0.40 - 2026-07-08

### Features
- **Session picker inside the feedback popup** — when inspecting an element, choose which OpenFox session receives your feedback directly from the popup on the page.
- **Project-scoped session list** — only sessions belonging to your current project appear in the picker.
- **Auto-selects most recent session** — the latest session is pre-selected. Your choice is remembered across page refreshes.

### Enhancements
- **Self-sufficient inspect widget** — fetches sessions directly from the dev server proxy instead of relying on fragile postMessage communication. Works even if you close the OpenFox UI tab.

### Bug Fixes
- **Inspect widget now appears on gzip-compressed and chunked+gzip pages** — the proxy no longer corrupts binary data during chunk decoding.
- **Dev server proxy no longer hangs on unreachable targets** — returns a clear 502 Bad Gateway error.
- **Inspect widget injects into uncompressed HTML** — the modified HTML is now written to the response correctly.
- **Pages without `</body>` or `</head>` no longer fail silently** — the proxy passes through the original response.

## 2.0.39 - 2026-07-08

### Features
- **New `trace_code` tool** — ask the AI to trace any symbol (function, variable, class, interface) through your codebase. Finds definitions, references, and type definitions, returning results as an interactive graph with inline code snippets. Control depth (1–5 hops) and direction (definitions, references, or both).

## 2.0.38 - 2026-07-07

### Features
- **MCP tool definitions cached to disk** — if an MCP server becomes unreachable, its tools remain available from cache. No more disappearing tools mid-session.

### Enhancements
- **Live vs cache indicator** — the `/mcp-config list` view shows whether tools are served live or from cache.

### Bug Fixes
- **Transient MCP server outages no longer destabilize prompt assembly** — tools no longer flicker in and out of the context window.

## 2.0.37 - 2026-07-07

### Features
- **@-mention file autocomplete in chat input** — type `@` followed by a filename to fuzzy-search your project files. Navigate with arrow keys, press Enter or Tab to insert the path. The model treats @-prefixed paths as relative to the working directory.

### Bug Fixes
- **Image descriptions now survive page refresh** — when using a non-vision model, image descriptions are saved permanently alongside the attachment instead of being stuffed into message text.
- **Model settings no longer leak between providers** — each provider's settings are correctly scoped so the right config always applies.

## 2.0.36 - 2026-07-06

### Features
- **OpenAI-compatible backend for vision fallback** — switch the vision fallback backend from Ollama to OpenAI-compatible format, supporting standard `/v1/chat/completions` endpoints.

### Enhancements
- **Backend selector in onboarding UI** — choose between Ollama and OpenAI-compatible vision fallback during setup.

## 2.0.35 - 2026-07-06

### Enhancements
- **Acceptance criteria now appear as individual messages** — instead of being collapsed into a single opaque batch, you can see exactly what each agent is doing at a glance.

### Bug Fixes
- **Chat feed flickering and scroll disruption fixed** — the feed now keeps DOM nodes stable, preserving scroll position, animations, and input focus as the conversation grows.

## 2.0.34 - 2026-07-05

### Features
- **Clear all review findings** — new "Clear all" button with confirmation to bulk-remove review findings in one click.

### Enhancements
- **Auto-restart after update** — updates applied to a running service now trigger automatic restart + page reload. No more waiting to click a button.

## 2.0.33 - 2026-07-05

### Features
- **Browse history search** — filter results by category (User prompts / Thinking / Responses). Press Ctrl+F (or Cmd+F) to open search instantly. Navigate with keyboard arrows. Filter preferences persist across sessions.

### Bug Fixes
- **WebSocket reconnects automatically** — when the server restarts, the client now reconnects instead of treating connection drops as authentication failures.
- **Aborting a workflow mid-execution picks the correct agent mode** — no longer defaults to planner when it should be builder.
- **Notification overrides for sub-agents now apply correctly** — sub-agent completion events are properly tagged and respect per-agent notification settings.

## 2.0.32 - 2026-07-05

### Enhancements
- **Prompt cache survives server restarts** — the system prompt + tools cache is stored in SQLite instead of in-memory, persisting across restarts.

### Bug Fixes
- **`return_value` tool no longer leaks into top-level agent tool lists** — correctly filtered per agent's allowedTools.

## 2.0.31 - 2026-07-05

### Bug Fixes
- **PWA WebSocket recovery** — running OpenFox as a Progressive Web App no longer gets permanently stuck after repeated server restarts. Stale service workers are detected and unregistered.
- **Update banner no longer reappears after auto-dismiss** — the underlying state is cleaned up so the banner stays gone until the next real update.

## 2.0.30 - 2026-07-04

### Features
- **Feed truncation** — set a maximum number of visible items in Settings → Display (default: 300). Older messages are clipped automatically.
- **View full history** — when items are truncated, a "View full history" button opens a read-only popup with the complete session.
- **Dedicated read-only session page** — sessions can be opened at a standalone URL that loads via REST only. Print-friendly styling included.

### Bug Fixes
- **`run_command` outputs now visible after page refresh** — completed command outputs auto-expand immediately instead of staying collapsed.

## 2.0.29 - 2026-07-04

### Bug Fixes
- **Stopping a running generation no longer leaves tools stuck in "pending" state** — every tool call receives a clean "interrupted by user" result, and indicators clear as soon as the message completes.
- **Race conditions in tool call results eliminated** — the dual-copy architecture that caused desyncs has been eliminated. All message state lives in a single source of truth.

## 2.0.28 - 2026-07-03

### Enhancements
- **Update notification banner auto-dismisses in 8 seconds** instead of 30, getting out of your way faster.

### Bug Fixes
- **Tool calls no longer get stuck showing "pending..." indefinitely** — tool states stay in sync properly during streaming.
- **Pressing Escape or clicking abort no longer triggers a persistent red error banner** — aborting is now clean with just an "Aborted" badge.

## 2.0.27 - 2026-07-03

### Features
- **First model auto-selected after provider setup** — no more "detecting..." state. The first available model is selected by default.

### Enhancements
- **Full model name shown in stats bar** — you can see exactly which model is active at a glance.
- **Sidebar auto-opens on project pages** — the hamburger menu is hidden when the sidebar is pinned.

### Bug Fixes
- **LLM client now always recreated on provider switch** — fixes stale connections when no API key is set.

## 2.0.26 - 2026-07-02

### Enhancements
- **Increased LLM idle timeout** — from 30–60 seconds to 120 seconds for remote backends. Fewer timeouts with slow models or during peak API latency.

### Bug Fixes
- **Path-confirmation false positives with regex patterns fixed** — commands like `grep '/api/sessions.*message'` no longer trigger unnecessary confirmation dialogs.

## 2.0.25 - 2026-07-02

### Features
- **Provider auto-configuration** — when adding a new provider, OpenFox automatically probes the backend to detect working thinking and non-thinking parameters, context window size, and vision support.
- **Per-model "Test thinking" / "Test non-thinking" buttons** — test whether your configurations produce valid responses before saving, with the option to inspect the raw API response.

### Enhancements
- **Automatic output token clamping** — `max_tokens` is capped so the prompt plus completion always fits within the model's context window.
- **Simplified provider setup UI** — extra kwargs and query params merged into a single field per mode. Advanced settings collapsed into a details section.

### Bug Fixes
- **Session titles no longer trigger thinking output** — title generation no longer sends `reasoning_effort` that some backends reject.
- **Local providers keep their model selection when switching** — the model detected at startup is preserved.
- **Session titles work with custom provider configs** — title generation correctly resolves the provider configuration for non-default providers.

## 2.0.24 - 2026-07-01

### Bug Fixes
- **Speed sparkline charts no longer show a negative Y-axis** — the chart baseline is clamped to zero, so the visual always makes physical sense.

### Enhancements
- **Config file and database locations documented** — helps self-hosters and developers navigate the system.

## 2.0.23 - 2026-07-01

### Bug Fixes
- **Stream freeze on page reload fixed** — the streaming message is restored from the REST response when loading a session.
- **Auto-scroll re-enabled on send** — sending a message now scrolls to the bottom as expected.
- **Toolbar buttons readable with frosted-glass background** — when auto-scroll is paused, the toolbar has a visible background.

### Enhancements
- **Unified workflow launch** — no more forced mode-switch between planner and builder when launching workflows.

## 2.0.22 - 2026-06-29

*No user-facing changes.* Internal test infrastructure improvements.

## 2.0.21 - 2026-06-29

### Bug Fixes
- **LSP code intelligence restored in installed builds** — language server features (go-to-definition, hover, diagnostics, autocomplete) were completely broken when running from an installed package. The `languages.json` config file is now included in the distribution.

## 2.0.20 - 2026-06-29

*No user-facing changes.* Pure internal refactor — large files split, static data extracted to JSON, deprecated APIs removed.

## 2.0.19 - 2026-06-29

### Bug Fixes
- **`run_command` no longer discards output on timeout** — partial stdout/stderr is returned along with exit code 124 and a clear `[Process timed out after Xms]` marker. Agents can act on partial results instead of getting a blank failure.

## 2.0.18 - 2026-06-29

### Features
- **Per-agent tool policies enforced** — the Planner agent can no longer write or edit files. It's restricted to planning tools (read, search, ask questions, configure MCP, start dev servers). The Builder agent keeps full write access.

### Enhancements
- **Project selector visible on the homepage** — when no session is active, the project dropdown appears in the header.
- **Agent settings UI streamlined** — always-allowed tools are hidden from the tool picker. Switching an agent to sub-agent type automatically removes top-level-only tools.

### Bug Fixes
- **Project-level commands and workflows now appear in the More Menu** — custom commands and workflows stored in `.openfox/` directories are included with correct override priority.
- **"Open in VSCode" links use resolved absolute paths** — works reliably regardless of whether the original path was relative or absolute.
- **Agent tool selection actually saves** — the tool toggle in the agent editor now works correctly.

## 2.0.17 - 2026-06-27

### Bug Fixes
- **Selecting a folder that already belongs to an existing project no longer crashes the server** — returns the existing project and navigates to it seamlessly.

### Enhancements
- **Directory browser overhaul** — single-click selects a folder, hover-revealed arrow navigates into subdirectories. Breadcrumb header and footer are sticky.
- **Opening a project is now immediate** — navigating to the project workspace happens the moment you select a folder.

## 2.0.16 - 2026-06-26

### Features
- **Encoding-aware file tools** — `read_file` auto-detects file encoding (Windows-1252, ISO-8859-1, Shift-JIS, etc.). `write_file` accepts an optional `encoding` parameter.

### Enhancements
- **`edit_file` preserves original encoding** — through edit cycles.
- **`read_file` returns encoding metadata** — so you know what encoding was detected.

### Bug Fixes
- **BOM handling corrected** — BOM is stripped from display but preserved through edit cycles.

## 2.0.15 - 2026-06-26

### Features
- **Connect to MCP servers over HTTP** — add remote MCP servers (e.g., Context7) with a URL and optional custom headers.
- **Agent-managed MCP configuration** — the AI can add, remove, or configure MCP servers mid-conversation using the `mcp_config` tool.

### Enhancements
- **Smaller installation footprint** — `sql-language-server` is no longer bundled. Installed on-demand when you work with SQL files.

### Bug Fixes
- **Missing language server install hints** — editing or writing a file now shows a clear install hint instead of silently failing with no diagnostics.

## 2.0.14 - 2026-06-26

### Features
- **Connect to external MCP servers** — extend the LLM's capabilities with custom tools: web search, file operations, database queries, API integrations.
- **MCP management tab in Settings** — add, configure, test, and remove MCP servers visually.
- **Enable or disable individual tools per server** — with live token estimates so you control context consumption.

### Enhancements
- **MCP configurations persist across restarts** — saved to global settings.
- **"Update system prompt" banner** — adding or removing MCP tools shows a banner instead of silently invalidating the conversation cache.
- **Tool names scoped by server** — prevents naming collisions between different MCP servers.

## 2.0.13 - 2026-06-26

### Bug Fixes
- **Manual compaction no longer leaves the session stuck in "running" state** — the running state is properly cleared after compaction, allowing you to continue chatting normally.

## 2.0.12 - 2026-06-25

### Bug Fixes
- **Manual compaction no longer slows down subsequent responses** — now runs through the same unified path as auto-compaction, preserving the vLLM prefix cache.
- **Auto-scroll in dev server logs works reliably** — scrolling up pauses auto-scroll, scrolling near the bottom re-enables it. Toggle state stays in sync between inline panel and hover popup.

## 2.0.11 - 2026-06-24

### Features
- **Models can call sub-agents by name** — even when the model hallucinates the tool name, the system transparently redirects through `call_sub_agent`.

### Enhancements
- **`run_command` returns a clear error for backgrounded commands** — points the agent to the `background_process` tool instead of failing silently.

### Bug Fixes
- **Dev server logs: pause and resume auto-scroll** — a "live" toggle appears on hover, letting you freeze the viewport to inspect older output while new logs keep streaming.

## 2.0.10 - 2026-06-24

### Bug Fixes
- **Auto-update modal no longer shows a false warning about interrupted sessions** — the update process does not interrupt active sessions. That warning has been removed.
- **Button text corrected from "Restarting in 10s…" to "Reloading in 10s…"** — accurately describes what happens (a graceful reload), reducing confusion.

## 2.0.9 - 2026-06-24

*No user-facing changes.* Developer documentation update only.

## 2.0.8 - 2026-06-24

### Features
- **Restart service from the web UI** — after an update, service users can restart via a "Restart Service" button instead of SSH-ing in.
- **Synchronous update API with real feedback** — the UI now shows real success/failure instead of polling blindly.

### Enhancements
- **No more `--service` flag needed** — `openfox update` auto-detects service mode.

### Bug Fixes
- **`openfox service logs -f` now works** — the `-f`/`--follow` flag is properly registered in the CLI argument parser.

## 2.0.7 - 2026-06-23

### Bug Fixes
- **Provider onboarding now sends API key when fetching models** — adding a provider that requires authentication previously showed "No models found" because the API key was silently dropped.

## 2.0.6 - 2026-06-23

### Enhancements
- **Reduced duplicate output from sub-agents** — sub-agents now deliver results through a single channel instead of echoing summaries both as chat text and structured data.

## 2.0.5 - 2026-06-23

### Features
- **Questions from the AI now appear inline** — instead of blocking modal overlays. Three question types: free-text, confirm (Yes/No/Skip), and choice (pick from options or type custom). Pending questions survive page reloads.

### Bug Fixes
- **Session statistics now report accurate timing** — tool time reflects real wall-clock duration instead of summing parallel tool durations.
- **Fixed a rare infinite loop** — that could freeze a session when a chat turn failed during processing.

## 2.0.4 - 2026-06-23

### Features
- **`openfox service logs` now accepts `-f` / `--follow`** — tail service logs in real time, matching the familiar journalctl experience.

### Enhancements
- **Workflow steps calling `step_done` now terminate the agent turn immediately** — no more wasted LLM round-trips. Workflow transitions are snappier.

## 2.0.3 - 2026-06-22

### Features
- **Per-model custom query parameters** — send arbitrary JSON fields in the request body to your LLM provider (e.g., vLLM guided decoding params, custom sampling settings), configured separately for thinking and non-thinking modes.

### Enhancements
- **Provider setup modal streamlined** — renamed "API URL" → "Provider URL", added backend type placeholder, displays unknown backends as "Other", removed OpenAI/Anthropic/OpenCode Go from local-backend dropdown.
- **Browser autofill no longer interferes** with provider name and API key fields.
- **URL input auto-focuses** when adding a new provider.
- **"Edit URL" button appears** when a provider connection fails.
- **All model settings save correctly** — temperature, topP, topK, maxTokens were silently dropped on save; now they persist.

### Bug Fixes
- **Manual compaction uses the cached system prompt** — preserving vLLM prefix cache benefits so compaction is faster.
- **Fixed event ordering during manual compaction** — where `message.start` was emitted after streaming began, causing visual glitches.

## 2.0.2 - 2026-06-21

### Bug Fixes
- **Queued messages no longer lost on abort** — when you typed a message while the assistant was already responding and then hit Stop, your message was silently discarded. Now the queued text is restored into the chat input.

## [2.0.0] - 2026-06-21

### Multi-Turn Agent Engine (MTAE)

The agent loop has been completely rewritten around a simpler, composable architecture where the EventStore is the single source of truth.

- **Unified agent loop** — All modes (builder, planner, verifier, sub-agents, compaction) run through the same `runAgentTurn` loop. No more nested loops, no hardcoded planner.
- **EventStore as SSOT** — The loop never imports the EventStore directly. State is derived from events, not persisted directly.
- **Compaction in the same loop** — Compaction reuses the same agent loop with `mode: 'compaction'`. No separate compaction loop.
- **System prompt caching decoupled** — Moved out of the agent loop into its own concern.
- **Drain queue extracted** — `drainQueue` is now a standalone function.
- **Dead code removed** — `nudge-helpers.ts`, `verifier-helpers.ts`, `orchestrator-verifier.test.ts`, `runVerifierTurn`, `toolMode`, custom sub-agent loop all deleted.
- **Agent definition injection simplified** — Event-driven, no state tracking, `getAllEvents` API.

