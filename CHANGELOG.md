# Changelog

## 2.0.118 - 2026-08-12

### Features

- **LLM failures retry automatically** — chat, workflow steps, and sub-agents back off and retry, with a live countdown and "Retry now" to skip the wait
- **Searchable new-session modal in split view** — live case-insensitive project search with autofocus, arrow-key navigation, Enter to select, Esc to dismiss

### Enhancements

- **LLM retries recover smoothly** — partial replies continue where they left off, provider switches apply on the next attempt, and failed calls leave no ghost messages

### Bug Fixes

- **Paused workflow steps no longer vanish** — the choose-workspace pause survives late session refreshes
- **Composer no longer jumps while typing** — the input stays put on every keystroke

## 2.0.117 - 2026-08-12

### Features

- **New-session picker in split view** — pick any project, create a session, and open it as a pane
- **Project dropdown in split panes** — open the folder, manage tasks, or edit settings straight from a pane header

### Enhancements

- **Live session list in split view** — the control panel refreshes automatically and on tab focus
- **Breadcrumb modal titles** — Tasks and Project Settings now read "project › action"

### Bug Fixes

- **Tail smartness off for chained commands** — `&&`/`||` chains are no longer misread as piped output
- **Queued messages survive sub-agent runs** — no longer drained into a sub-agent context mid-run
- **Composer stays compact on narrow layouts** — and re-sizes when the pane width changes
- **Split-view actions target the owning pane** — launch, resume, retry, compact, and exit stay in their pane
- **Path confirmations land in the right pane** — allow/deny prompts appear instantly where they were asked
- **Each split pane shows its own workspace** — branch, git diff, and context no longer bleed between panes
- **Adding a split pane mid-stream no longer crashes** — the "maximum update depth" blank-screen error is gone
- **Project-scoped agents in the default agent list** — grouped by Project, User, and Built-in
- **Saving a new agent no longer hangs** — the settings modal no longer sticks on "saving"

## 2.0.116 - 2026-08-11

### Features

- **Split view for multiple sessions** — run independent sessions side-by-side in one window, each with its own feed, sidebar, and responsive layout
- **Workflow steps retry automatically** — LLM-failed steps retry with escalating backoff and a clean history
- **Changelog trimmed to your upgrade path** — release notes only show what changed since the version you last ran

### Enhancements

- **Bigger default response limit** — max response tokens raised from 4096 to 16384
- **Header task badge tracks running work** — only actively running tasks count toward the green badge

### Bug Fixes

- **False path confirmations eliminated** — sed/awk/perl/ruby regex expressions no longer trip the file-access guard
- **Sandbox escapes now flagged** — bare-root paths and dot-dot traversal outside the workdir are caught
- **Context size survives failed calls** — a failed LLM query keeps the last known context size
- **System-prompt warning scoped per pane** — the "prompt changed" banner only shows in the session that changed
- **Setup workspace step stays scoped** — the workflow's first step only creates the workspace, no premature implementation
- **Dependency vulnerabilities patched** — npm audit reports zero known issues

## 2.0.115 - 2026-08-11

### Features

- **Built-in Mark Task as Done command** — a bundled command that guides agents through completing a task
- **Per-project default agent for new sessions** — choose the agent fresh chats start with in Project Settings

### Enhancements

- **Task board output renders as a kanban board** — project_tasks tool results show in the chat feed with columns, running/queued badges, and gate chips
- **New custom agents default to top-level type** — instead of being created as sub-agents

### Bug Fixes

- **Partial thinking resumes cleanly on strict APIs** — content-less assistant messages now carry a space instead of null, clearing the "content or tool_calls must be set" 400
- **Workspace edits honor reads from the original clone** — the write/edit guard no longer rejects after browsing files in the base workspace
- **.openfox/ content resolves from the project root** — skills, commands, agents, and workflows scope to the session's project wherever it lives
- **Custom agents save beside their project** — not the server directory
- **session_metadata reads render real output** — the feed shows actual entries instead of a placeholder
- **Task sessions get auto-generated names** — and Open session links to a real session

## 2.0.114 - 2026-08-10

### Features

- **Project-scoped task board**
  - Every idea, bug, or chore gets a home — a clean To Do / In Progress / Done board right inside your project, with search and drag-and-drop
  - Run tasks in parallel or leave them queued — the next one starts automatically when a slot frees, and you get a nudge linking to its session
  - One click turns a card into a focused working session — the agent already knows the task and what's expected
  - Define your own "definition of done" — a task needs the required evidence before it can move to Done
  - Agents work the board just like you — picking up, working on, and completing tasks, with every move visible and reversible
  - A fresh chat offers your next open task — start it with one click from the empty feed
  - Creating a task feels like chatting — same composer, slash commands, attachments, and agent/model selection

### Enhancements

- **Workflow sub-group slices can escape** — tagged transitions let a slice loop across groups (verify → build → verify → done) while untagged edges stay clamped

### Bug Fixes

- **Wheel-up scrolling reliably stops auto-scroll** — scrolling up while streaming detaches the feed; deliberate scrolls down still re-attach
- **Dev-server inspect proxy survives high ports** — the port scan is clamped below 65536 so proxies above port 64535 start cleanly

## 2.0.113 - 2026-08-07

### Features

- **⚠️ Heads-up: Build & Verify now asks where to work** — the workflow prompts for a workspace before running and can auto-create one, replacing the previous silent default
- **Pin favorite sessions to the top** — star any session to keep it at the top of the sidebar and session picker
- **Sidebars are resizable** — drag to resize the session and project rails; widths reset on page refresh
- **Built-in workflow authoring skill** — agents can load the canonical spec to write compliant workflows

### Enhancements

- **Editable attachments when editing a message** — attachments show with remove buttons and persist on resend
- **Launch command pinned in the log viewer** — background processes show their start command and cwd at the top

### Bug Fixes

- **Same-name workflows can coexist** — built-in, global, and project workflows share IDs without colliding, each tagged and separately editable
- **Native context menu over links** — right-clicking a link opens the browser menu instead of the custom one
- **Auto-scroll rearmed after replay** — replaying or edit-resending a message resumes live scrolling on streamed output
- **No stray empty workspace.json** — unrelated settings saves no longer drop an empty config file into `.openfox/`
- **Inputs behave on touch devices** — fields no longer steal focus and pop the soft keyboard on phones and tablets
- **OpenCode Go model catalog fixed** — models now load from the correct `/zen/go/v1` endpoint
- **Windows paths and root checks fixed** — backslash workspace paths are detected again, bare drive roots are rejected, casing changes no longer warn falsely, and the root save flag can't get stuck
- **Token budget counts output accurately** — context-size tracking includes prompt plus completion, preventing spurious context-length errors
- **Unknown slash commands sent as text** — a `/`-input that isn't a command sends as a normal message instead of vanishing
- **Slash commands honor their agent mode** — launching a command now applies the agent mode configured for it

## 2.0.112 - 2026-08-03

### Bug Fixes

- **Updates install again** — the postinstall script is now bundled with the release, so `openfox update` no longer fails halfway with a missing file

## 2.0.111 - 2026-08-03

### Enhancements

- **OAuth login for MCP servers** — servers that require OAuth authorization now connect through a browser-based login flow instead of failing
- **Manual model entry in the provider setup** — if a provider exposes no model list, type the model name directly instead of hitting a dead-end "No models found"
- **You choose when to restart after an update** — updates download first and restart on your OK; service installs can opt into automatic restart
- **Homepage loads faster** — the session list shows the five most recent per project up front and fills in the rest lazily
- **Leaner session storage** — finished tool-call streaming buffers are dropped from snapshots and stale backups auto-prune after 10 days

### Bug Fixes

- **Tool calls no longer misread as interrupted** — an output that merely contains the interrupt marker text now shows as successful
- **Multi-statement shell commands keep their tails** — output is no longer cut at the first line for compound commands
- **Windows paths shorten to names again** — workspace and file names show their basename instead of the full path
- **Auto-compaction honors configured thresholds** — the internal cap is raised from 85%, so thresholds up to 95% work as set
- **Windows path-safety gaps closed** — dangerous commands outside the workdir are confirmed again in edge cases, including under Git Bash
- **Choice options survive reloads** — structured choices stay stable across page refreshes

## 2.0.110 - 2026-08-02

### Bug Fixes

- **No more phantom gaps below streamed messages** — content-visibility containment only applies when feed virtualization is on, so messages render at their natural height
- **"View full history" button restored on trimmed sessions** — the chat now trusts the server-reported hidden message count instead of guessing
- **Fresh sessions pin to the bottom again** — a stray early scroll event no longer disables auto-scroll and strands the feed at the top

## 2.0.109 - 2026-08-02

### Enhancements

- **Feed virtualization is opt-in** — a "Virtualize long feeds" display setting mounts only recent messages on very long sessions

### Bug Fixes

- **No more stranded history when scrolling up** — the experimental virtualized feed is off by default, so older messages render as before
- **Git `-n` respected for non-commit subcommands** — only commit/amend treat `-n` as no-verify

## 2.0.108 - 2026-08-02

### Features

- **New performance settings for long sessions** — use native scrollbars in tool calls and code blocks, auto-collapse large tool call outputs, and defer code highlighting while streaming, all off by default

### Enhancements

- **Long chats virtualize** — only recent messages render; older ones load in batches as you scroll up
- **Sessions load faster** — data is prefetched at boot and served from a server-side snapshot cache
- **Streaming renders once per frame** — incoming deltas coalesce into a single render for smoother output
- **Rendered markdown is cached** — repeat renders skip re-parsing, and plain or oversized code blocks skip syntax highlighting
- **Finished tool call outputs trimmed to the last 1MB** — keeps session snapshots lean so long sessions load faster

### Bug Fixes

- **Feed no longer snaps back to bottom** — scrolling up during streaming now disables auto-scroll instantly for good
- **Workflows no longer blocked by a mismatched branch** — the execution-context gate is gone
- **New workspaces inherit the session's branch** — no longer forking from the clone's default branch
- **Aborted mid-thinking content is preserved** — carried into the next LLM call when reasoning echo is enabled

## 2.0.107 - 2026-08-02

### Bug Fixes

- **npm install works again** — installing openfox no longer fails because the postinstall tried to build web deps inside the published package; that only happens in source checkouts now.

## 2.0.106 - 2026-08-02

### Features

- **Workflow choice steps** — user picks a fork and the run diverges down its own independent branch.
- **Wrong-branch write protection** — Build & Verify won't run when session and actual git branches diverge.

### Enhancements

- **Vision fallback API key** — hosted OpenAI-compatible vision backends now accept an API key.
- **RTK pairing warning** — settings warn when RTK auto-rewrite is paired with cmd/PowerShell on Windows.
- **'What to test' tutorial** — the built-in Build & Verify workflow's last step summarizes it.
- **Planner stops asking to switch to build** — it waits for the mode reminder instead of a moot yes/no.
- **Clear-all confirmation stays visible** — no longer hidden below the fold in the criteria editor.

### Bug Fixes

- **run_command output auto-scroll restored** — streaming output follows the tail while the command runs.
- **Per-project workflows** — follow the active project and show up in the launcher per project.
- **Workspace switch keeps the prompt cache** — new workspace arrives via system reminder instead.
- **Project skills load from the session dir** — no longer read from the server's working directory.
- **Windows reliability fixes** — folder opening, workspace deletion, file search, and permission checks.
- **Custom command deletion fixed** — overriding commands can be deleted again.
- **sshpass/nix-wrapped commands detected** — remote execution is recognized and confirmed properly.

## 2.0.105 - 2026-08-01

### Features

- **Keyboard scroll control** — arrow and page keys now steer auto-scroll: scrolling up detaches instantly, scrolling down snaps back on near the bottom.

### Enhancements

- **Magnetic scrollbar handle** — dragging the scrollbar disables auto-scroll instantly and snaps it back on when you release near the end of the track.
- **Sharper vision-fallback descriptions** — image descriptions now arrive in a clear delimited block, prompted to capture verbatim text and tables.

### Bug Fixes

- **Auto-scroll no longer detaches mid-stream** — following now holds steady through slow or bursty output, with no more random let-go.
- **Provider/model switch now rebinds the LLM client** — switching no longer reuses the previous provider's connection.

## 2.0.104 - 2026-07-31

### Features

- **Terminal font is now configurable** — pick any installed monospace font from a live-updating dropdown in Display settings. The preview updates instantly as you browse.

### Enhancements

- **Scrollbars!** — we've tamed this mystical beast by implementing a consistent scrollbar across all platforms. Upside: they're now themed accordingly, look good, and scrolling up (by dragging the scrollbar itself or with the mouse wheel) now escapes auto-scroll naturally — no more pull-backs! Downside: you might occasionally see an out-of-sync scrollbar for a brief moment, but hey, it's hard to get that perfect.

### Bug Fixes

- **Model name now appears in agent system prompts** — the `Model:` line in the Environment section was silently dropped when the caching layer was introduced. Agents once again know what model they're running on.
- **Settings modal no longer overflows on short viewports** — removed a hard-coded minHeight that pushed content past the bottom edge on constrained screens.
- **Auto-scroll no longer fights itself** — programmatic scrolls from the auto-scroll feature are RAF-guarded so they don't trigger the scroll event listener and deactivate themselves.

## 2.0.103 - 2026-07-30

### Bug Fixes

- **LSP server crashes no longer freeze write_file/edit_file** — rapid process deaths during startup (e.g., rust-analyzer missing on macOS) are now caught early, letting the tool complete normally.
- **Hung LSP servers time out after 5 seconds** — the initialize handshake now has a timeout, preventing a non-responsive server from blocking the agent loop.

## 2.0.102 - 2026-07-29

### Features

- **Assign any agent a specific model override** — each agent can now be assigned a provider+model that kicks in when that agent is selected, overriding the session or global model.
- **Control MCP tool access per agent** — choose All, None, or pick individual MCP tools for each agent with a three-state permission selector.

### Enhancements

- **Browser skill updated to @playwright/cli v1.1.0** — the browser-control skill now references the official Playwright CLI package.

### Bug Fixes

- **Workflow step_done nudge fires on every iteration after resume** — when a resumed workflow loops back, the step_done reminder is now injected on every subsequent turn, not just the first.
- **Systemd service works in headless/SSH environments** — dropped the dependency on `graphical-session.target` so the service installs and runs without a desktop session. Auto-detects headless mode, with `--headless`/`--desktop` flags for explicit control.
- **Project agents appear in the mode switcher dropdown** — project-scoped custom agents are now listed alongside built-in and global agents.
- **Project-scoped items save to the correct directory** — fixes items being written to the wrong project root when saving to `.openfox/`.

## 2.0.101 - 2026-07-28

### Features

- **Editable step names in workflow editor** — each workflow step now has a customizable Name field instead of being locked to the agent or sub-agent name.

### Enhancements

- **First workflow step renamed to "Implement"** — the build step now clearly communicates its purpose instead of the generic "Builder" label.

### Bug Fixes

- **Add-criteria command no longer forces planner mode** — launching the command keeps your current agent instead of switching to planner.
- **Workflow button shows regardless of current agent** — the Build & Verify button appears whenever pending criteria exist, not only in planner mode.
- **Workflow button only shows for pending criteria** — completed, passed, or failed criteria no longer keep the button visible.

## 2.0.100 - 2026-07-28

### Features

- **LSP servers notified on file save** — OpenFox now sends `textDocument/didSave` to language servers after write operations, enabling save-triggered linting and compilation.

### Enhancements

- **Rust users see setup hint for rust-analyzer** — if `rust-analyzer` is not installed, OpenFox now suggests `rustup component add rust-analyzer`.

### Bug Fixes

- **LSP diagnostics no longer miss late-arriving waves** — rust-analyzer sends clear → own analysis → rustc flycheck in rapid succession. A 400ms debounce now captures all waves instead of only the first.
- **Pyright LSP diagnostics work correctly** — removed `rootPath` and `workspaceFolders` from initialization parameters, which caused pyright to refuse diagnostics or switch to pull mode.
- **Stale LSP diagnostics cleared on file reopen** — reopening a file now fetches fresh diagnostics instead of returning cached stale ones.

## 2.0.99 - 2026-07-27

### Bug Fixes

- **Workflow progress no longer shows another session's state** — execution events from background sessions no longer corrupt the active workflow display.

## 2.0.98 - 2026-07-27

### Enhancements

- **Per-provider toggle to strip reasoning from messages** — a new "Send reasoning in messages" checkbox in the provider defaults panel (gear icon on step 2) lets you disable sending reasoning/thinking content to providers like Mistral that reject the field.

## 2.0.97 - 2026-07-27

### Enhancements

- **"esc to interrupt" hint hidden on mobile** — the keyboard shortcut hint no longer clutters the UI on small screens where keyboard shortcuts don't apply.

### Bug Fixes

- **Mistral structured content blocks now render correctly** — models with `reasoning_effort` (like `mistral-small-2603`) previously showed `[object Object]` for every streaming chunk. Text and thinking content are now properly extracted and displayed.

## 2.0.96 - 2026-07-26

### Features

- **Remote SSH/SCP/SFTP/MOSH commands are visually distinguished** — tool calls running remote commands show a purple frame and a "REMOTE · SSH" badge, making it easy to spot remote execution at a glance.
- **Open project folder in OS file explorer from header** — a new folder button opens the project directory in your system's file manager.
- **Pick a vision fallback model from your configured providers** — choose which model handles vision tasks when the primary model doesn't support images.

### Bug Fixes

- **Project workflow saves no longer silently fall back to user config** — saving a workflow item now correctly updates the file on disk instead of appearing to succeed while leaving the old file intact.
- **Shell injection prevented when deleting workspaces** — workspace names are no longer interpolated into shell commands, fixing a potential injection vector.

## 2.0.95 - 2026-07-26

### Features

- **All network requests route through configured HTTP proxy** — OpenFox now respects proxy settings for all outbound connections, with `HTTP_PROXY`/`HTTPS_PROXY` inherited by shell processes and a connectivity test button in Advanced settings.

### Bug Fixes

- **Aborting a workflow no longer cancels it** — hitting Escape during a workflow step stops the agent but preserves the execution; typing a message auto-resumes the workflow in the same step without re-injecting the prompt.
- **Workflows can resume from any step type** — the previous restriction limiting resume to `user` steps has been removed, enabling recovery from aborted agent and shell steps.
- **Proxy connections accept self-signed certificates** — the proxy agent now sets `rejectUnauthorized: false` for HTTPS targets behind TLS-intercepting proxies.

## 2.0.94 - 2026-07-26

### Features

- **WorkflowBar shows persistent workflow status** — a new bar above the chat input displays the current workflow name, active step, and an Exit button. Survives page refresh and server restarts thanks to DB-backed workflow state.

### Bug Fixes

- **Workflow template parameters survive pause/resume** — params like `{{featureName}}` are now persisted across user-step pauses and correctly restored on continue.
- **Continue button reappears after page refresh** — the workflow waiting state is loaded from the server on session reload, so the button is always visible when a workflow is paused.
- **Launching a new workflow cancels the previous one** — if a workflow is already waiting, starting another automatically exits the old one first.
- **MCP server changes no longer bump session timestamps** — modifying MCP overrides in settings no longer pushes the session to the top of the list.

## 2.0.93 - 2026-07-26

### Features

- **Multi-step workflows with user pause points** — new `user` step type lets workflow authors insert natural hand-off points where execution pauses and waits for manual action before continuing; state survives page refreshes.
- **Workflow parameterization with named params** — define parameters with labels, descriptions, and positions on any workflow; values are collected via a modal or slash command and resolved in step prompts via `{{param_name}}`.
- **Slash autocomplete with inline parameter hints** — type `/` to fuzzy-match workflows and commands; select with Tab/Enter and fill in `param=?` hints that advance as you type values.
- **Command template parameters** — commands support `{{param_name}}` placeholders in their prompt; launching from the UI shows a parameter collection modal.
- **Clear logs button and visual markers in LogViewer** — clear dev server output with one click and insert divider markers to annotate log sections.

### Enhancements

- **Automatic session naming on first workflow launch** — session titles are now generated from the workflow name and parameter values, producing contextual names like "PR #157: Fix bug".
- **Runner errors surfaced as visible chat messages** — workflow launch failures now show as error messages in the feed instead of silent logs.
- **OpenFox repo URL included in system prompt** — the agent can self-reference the repository when working on OpenFox itself.

### Bug Fixes

- **Changelog no longer shown on first install** — the "What's New" modal now only appears on version upgrades, not when running the app for the first time.
- **Saving workflows and agents to project `.openfox/` directory now works** — the "Project" destination option in creation modals correctly saves to the repository-scoped location.
- **Double-submit guard prevents duplicate sends** — rapid clicks on Send no longer trigger multiple message deliveries.

## 2.0.92 - 2026-07-25

### Bug Fixes

- **Changelog modal now appears after npm updates** — previously the "What's New" modal only showed after in-app auto-updates; now it also triggers when updating via npm by tracking the last seen version.

## 2.0.91 - 2026-07-25

### Features

- **System prompt diff preview** — see what changed before applying a system prompt update, with mid-turn queueing support for running sessions.
- **Per-session and per-project MCP server toggles** — enable or disable MCP servers at the session or project level, with global → project → session resolution.

### Bug Fixes

- **MCP override cache properly invalidated** — changes to disabled MCP servers now take effect immediately without requiring a restart.
- **Sidebar popover modals no longer close on interaction** — clicking "Configure dev server", "Update system prompt", or workspace/branch "Edit" from the compact sidebar header now opens the modal without the popover interfering.

## 2.0.90 - 2026-07-24

### Features

- **Compact sidebar summary header** — when the right sidebar is hidden, a compact bar shows workspace/branch, metadata status, token context, and dev server controls with clickable popovers for full details.
- **Scroll-to-top button in chat feed** — hover to reveal at the top of the message list; click to scroll up and disable auto-scroll.
- **Scrollbar preset picker with Custom CSS editor** — choose from built-in scrollbar styles or write your own CSS in the Display settings.

### Enhancements

- **Native browser scrollbars by default** — replaced custom scrollbar CSS with native scrollbars for better platform consistency; power users can customize via the new CSS editor.
- **Long session names truncated at 50 characters** — header dropdown, session list, and mobile nav now cap overly long names.

## 2.0.89 - 2026-07-23

### Features

- **Fork a session from any message** — right-click any user or assistant message and choose "Fork session from here" to create a new session preserving all history up to that point. The forked session inherits provider, model, workspace, cached system prompt, and read-files cache for instant warm-up.

### Enhancements

- **Copy now available on assistant messages via right-click** — previously only user messages had a copy button; now right-click any assistant message to copy its content.

### Bug Fixes

- **Creating a new workspace branch no longer crashes** — the system now creates branches from HEAD instead of fetching the default branch from the remote, which caused crashes on offline or slow connections.

## 2.0.88 - 2026-07-23

### Features

- **Changelog modal shows "What's New" on update** — toggleable in settings, auto-shown after an upgrade.
- **Ctrl+D toggles the criteria sidebar** — right sidebar now has a dedicated keyboard shortcut.
- **Ctrl+S closes the left sidebar** — when search is already focused, Ctrl+S dismisses the sidebar.
- **10 new customizable theme tokens for LLM response colors** — fine-tune the look of assistant messages, system messages, thinking labels, and more.

### Enhancements

- **8 new built-in theme presets** — Catppuccin, Night Owl, Rose Pine, and more added to the theme picker.
- **Syntax highlighting adapts to your selected theme preset** — code blocks now match your chosen color scheme.
- **System theme mode with separate dark/light presets** — choose different presets for dark and light modes independently.
- **Theme editor groups presets by dark/light mode** — easier to browse and select when you have many presets.
- **Header tooltips show live keyboard shortcut hints** — hover over header buttons to see the current keybinding.
- **Keybindings settings includes "Toggle Criteria Sidebar" binding** — configurable shortcut for showing/hiding the right sidebar.

### Bug Fixes

- **Error banner persists until dismissed or new message sent** — no longer disappears prematurely when session state updates.
- **Selecting a user preset while in system theme mode works correctly** — legacy mode fallback no longer breaks preset selection.
- **Active user preset is properly highlighted in theme picker** — the currently applied preset shows a clear visual indicator.
- **CHANGELOG.md ships with the npm package** — production builds no longer fail to find the changelog at runtime.

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

_No user-facing changes._ Internal test infrastructure improvements.

## 2.0.21 - 2026-06-29

### Bug Fixes

- **LSP code intelligence restored in installed builds** — language server features (go-to-definition, hover, diagnostics, autocomplete) were completely broken when running from an installed package. The `languages.json` config file is now included in the distribution.

## 2.0.20 - 2026-06-29

_No user-facing changes._ Pure internal refactor — large files split, static data extracted to JSON, deprecated APIs removed.

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

_No user-facing changes._ Developer documentation update only.

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
