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

## Build, Lint, Test Commands

### From Root

```bash
npm run build        # Build server (tsup) + web (vite)
npm run dev          # Start dev servers (server + web with HMR) on port 10469
npm run test         # Run all tests (unit + e2e)
npm run test:unit    # Run unit tests only
npm run test:e2e     # Run e2e tests only
npm run typecheck    # TypeScript type checking
npm run duplicate    # Check for duplicate code (server + web)
```

### Dev server

The dev server can already be running. Do not kill it.

It runs on port 10469. The password is `password`.

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


## TDD Workflow

When fixing or refactoring: write/update the failing test FIRST, then make it pass.


## Debugging

Need to trace through a session, understand why the agent did something, or find that pesky bug? Check out [docs/SESSION-DEBUGGING.md](SESSION-DEBUGGING.md) — it has everything you need to query the database directly, including DB locations, table schemas, event types, and ready-to-use queries.


## Production Config

NEVER modify production configuration files (e.g., `~/.config/openfox/`). These are user-specific and should only be changed by the user.

