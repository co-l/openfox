# OpenFox Codebase Guide

> Guidelines for AI coding agents operating in this repository.

## Project Overview

OpenFox is a local-LLM-first agentic coding assistant. It provides:

- **Core Functionality**: Autonomous coding agent that plans, implements, and verifies tasks using local LLMs
- **Dual Modes**: Planner (task breakdown) → Builder (implementation with verification loop)
- **Real-time Communication**: WebSocket-based protocol for streaming agent thoughts, tool calls, and results
- **Persistence**: SQLite database for sessions, projects, and message history
- **LSP Integration**: Language Server Protocol support for diagnostics across multiple languages

### Tech Stack

- **Backend**: TypeScript, Node.js 24+, Hono/Express, WebSocket, SQLite (better-sqlite3)
- **Frontend**: React 19, TailwindCSS, Zustand, Vite
- **LLM Integration**: OpenAI-compatible API (vLLM, sglang, ollama, llamacpp)
- **Testing**: Vitest (unit + e2e)

### Directory Structure

```
/                     # Root: server code lives here (NOT in ./server/)
  src/                # Server source (tools, agents, workflows, database, websocket)
  web/                # React frontend source
  e2e/                # Vitest e2e tests
  e2e-playwright/     # Playwright e2e tests
  dist/               # Build output
  docs/               # Documentation
```

## Build, Lint, Test Commands

### From Root

```bash
npm run build        # Build server (tsup) + web (vite)
npm run dev          # Start CLI dev server (tsx watch) on port 10469
npm run start        # Start production server
npm run test         # Run all tests (unit + e2e)
npm run test:unit    # Run unit tests only
npm run test:e2e     # Run e2e tests only
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint server code
npm run lint:fix     # ESLint with auto-fix
npm run format       # Prettier check
npm run format:fix   # Prettier write
npm run check        # typecheck + duplicate detection
npm run duplicate    # Check for duplicate code (server + web)
```

### Dev server

The dev server can already be running. Do not kill it.

Default ports: **10469** (dev), **10369** (prod). The password is `password`.

If it is not running, use the dev_server tool to start it

### Single Test File

```bash
# Server tests
npx vitest run src/tools/read.test.ts
npx vitest run src/tools/read.test.ts -t "test name"  # Specific test

# Web tests
npx vitest run web/src/hooks/usePromptHistory.test.ts
npx vitest run web/src/components/shared/PromptHistory.test.tsx

# Multiple related test files
npx vitest run web/src/hooks/usePromptHistory.test.ts web/src/components/shared/PromptHistory.test.tsx

# Watch mode
npx vitest --watch src/tools/        # Watch server tests
npx vitest --watch web/src/          # Watch web tests
```

### E2E Tests

```bash
cd e2e
npx vitest run                    # Run all e2e tests
npx vitest run protocol.test.ts   # Run specific test

# Verbose mode (shows tool calls, agent thinking, phase transitions)
OPENFOX_TEST_VERBOSE=true npx vitest run
```

### Testing Workflow

- During development: `npm run test:unit` for quick feedback
- Before considering work done: `npm run test` (full suite must pass)

**Important:** Run both commands without piping to `tail` or `grep` — they're already token-efficient and return errors properly. Grepping hides failure context and leads to wasteful re-runs.

### Git Commands

Precommit hooks take >40s, so always use a 120s timeout when committing:

```bash
git commit -m "message"   # timeout: 120000ms
```

### Release

**When asked to publish, read [docs/RELEASE.md](RELEASE.md) and follow the playbook.** It's the single source of truth: changelog generation, version bump, publish, and the merge to `main` (all release work happens on `develop`; `main` only ever receives a successful release).

## Code Conventions

### TypeScript Configuration

Strict mode enabled with:

- `noUncheckedIndexedAccess` - Index access returns `T | undefined`
- `exactOptionalPropertyTypes` - `undefined` not allowed for optional props
- `verbatimModuleSyntax` - Enforces proper import/export syntax
- `noPropertyAccessFromIndexSignature` - Use bracket notation for index signatures

### SVG Icons

All SVG icons must be extracted into `web/src/components/shared/icons/` as reusable components. Each icon gets its own file named `{IconName}Icon.tsx`.

**Forbidden:** Inline `<svg>` elements in component files.

**Allowed exceptions:**

- Complex interactive canvases (e.g., workflow editor diagram)
- Generic pattern components that accept SVG paths as props (e.g., `IconButton`, `ToolIcon`)
- Data visualizations with dynamic content (e.g., `Sparkline`)

**Usage:**

```typescript
import { FolderIcon, CheckIcon, ChevronDownIcon } from './shared/icons'

<FolderIcon className="w-5 h-5 text-accent-primary" />
<CheckIcon />
<ChevronDownIcon rotate={isOpen ? 180 : 0} />
```

### Error Handling

- Custom error classes extend `OpenFoxError`
- In tools, return result objects instead of throwing:

```typescript
return { success: false, error: error.message, durationMs, truncated: false }
```

### Functional Patterns

- Prefer pure functions, immutability, and composition
- Use Zod for runtime validation of config/external input
- Event sourcing pattern for session state (EventStore)

### Internationalization (en + fr)

All user-facing strings ship in English AND French — no fallback, a missing `fr` entry is a type error.

- Web UI strings go through `useT()`/`t({ en, fr })`; the `jsx-no-literals` lint gate enforces this — never bypass it with a disable.
- The gate flags JSX text, string literals (including `cond ? 'a' : 'b'` and `a && 'b'`) and `aria-label`/`placeholder`/`title`/`alt`. Language-neutral glyphs and acronyms (e.g. `MCP`, `99+`) go in the `allowedStrings` allowlist in `eslint.config.js`, not in `t()`.
- If the gate misses a string shape, extend `eslint/jsx-no-literals.mjs` and add a case to `eslint/jsx-no-literals.test.ts` first.
- Never call `useT()` after a conditional early return — keep hooks at the top of the component.
- Server/CLI use `serverT()`/`cliT()`; LLM-facing, external tool output, and dev-facing strings stay English. Full reference: `docs/I18N.md`.

## Design Principles

### Dumb Client, Smart Server

The web client must be as simple as possible - it renders what the server sends without complex data transformations, joins, or lookups. The server is the single source of truth and normalizes data before sending.

**Rationale:** Other UIs (CLI, mobile, VS Code extension) will be built around the server. Business logic and data shaping belong in the server, not duplicated across clients.

### Streaming/Fetch Parity

Data streamed during real-time operations must be identical in shape to data fetched later (e.g., on page reload). The frontend should use the same rendering code regardless of how data arrived.

**Rationale:** If streaming attaches `toolCall.result` inline, then `session.state` must also have `toolCall.result` attached. No conditional frontend logic to reconcile different data shapes.

### Event Sourcing

Session state is derived from EventStore, not persisted directly:

- All state changes go through events
- EventStore replays events to reconstruct state
- Enables time-travel debugging and audit trails

### `.openfox/` Directory Contract

Every file in `.openfox/` must be **committable** and **meaningful in the project context** — it describes how OpenFox interacts with _this repository_ for any contributor.

**Belongs in `.openfox/`:** `dev.json`, `workspace.json`, `commands/*`, `skills/*`, `workflows/*`, `agents/*` — anything that shapes the project's tooling, automation, or agent behavior.

**Does NOT belong:** Personal preferences (model, theme, keybindings, API keys). Those go in the **database** — globally or project-scoped per user.

**Rationale:** Clean repo, no leaked personal config, reliable source of truth for CI and collaborators.

**Command arguments:** a command's Message template takes `{{name}}` placeholders, filled positionally by order of appearance, and `{{ARGUMENTS}}`, which takes everything typed after the id. Quoted values (`/cmd "two words"`) fill one placeholder whole. Parsing lives in `src/shared/slash-args.ts` and is shared by the chat composer and the task board's server-side resolution — change it there, not in either caller. Full design: [docs/DESIGN-SLASH-ARGUMENTS.md](DESIGN-SLASH-ARGUMENTS.md).

**Workflows:** When asked to create or edit a workflow, load the built-in `workflows` skill via `load_skill("workflows")` — it is the authoritative reference for workflow file format, storage locations (project `.openfox/workflows/` vs global `{configDir}/workflows/`), the full JSON schema, step types, transition conditions, and template variables ([docs/WORKFLOWS.md](docs/WORKFLOWS.md) is a pointer to it). Project workflows belong in `.openfox/workflows/` and are committable.

## TDD Workflow

When fixing or refactoring: write/update the failing test FIRST, then make it pass.

## Debugging

Need to trace through a session, understand why the agent did something, or find that pesky bug? Check out [docs/SESSION-DEBUGGING.md](SESSION-DEBUGGING.md) — it has everything you need to query the database directly, including DB locations, table schemas, event types, and ready-to-use queries.

**Event handling in nested components:** When a child button is inside a parent with `onClick`, both fire even with `stopPropagation`. Use `e.nativeEvent.stopImmediatePropagation()` to prevent parent handlers.

## Database & Config Locations

|                | Production                           | Development                              |
| -------------- | ------------------------------------ | ---------------------------------------- |
| **Config dir** | `~/.config/openfox/`                 | `~/.config/openfox-dev/`                 |
| **Database**   | `~/.local/share/openfox/sessions.db` | `~/.local/share/openfox-dev/sessions.db` |

**Port-based distinction:** Port **10369** is always production. Dev servers start at **10370** and increment (10371, 10372, ...) depending on project startup order (prod proxifies the dev server on its own port + N).

## Production Config

NEVER modify production configuration files (e.g., `~/.config/openfox/`). These are user-specific and should only be changed by the user.
