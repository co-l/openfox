# AGENTS.md - OpenFox Codebase Guide

> Guidelines for AI coding agents operating in this repository.

## Project Overview

OpenFox is a local-LLM-first agentic coding assistant. Single-package TypeScript project with:

- `src/server/` - Hono HTTP/WebSocket server, LLM client, tools, agent runner, LSP integration
- `src/shared/` - Shared types and WebSocket protocol definitions
- `src/cli/` - CLI entry points for openfox and openfox-dev
- `web/` - React 19 + Tailwind frontend with Zustand state management

## Build, Lint, Test Commands

### From Root

```bash
npm run build        # Build with tsup + vite
npm run dev          # Start dev servers (server + web)
npm run test         # Run all tests (vitest)
npm run typecheck    # TypeScript check
npm run clean        # Remove dist/
```

### Single Test File

```bash
npx vitest run src/tools/read.test.ts           # Run one test file
npx vitest run src/tools/read.test.ts -t "name" # Run specific test by name
npx vitest --watch src/tools/                   # Watch mode for directory
```

## Code Style

### TypeScript Configuration

Strict mode with: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noPropertyAccessFromIndexSignature`

### Import Order

1. Node.js builtins with `node:` prefix
2. External packages
3. Internal packages (`@openfox/shared`, `@openfox/shared/protocol`)
4. Local imports with `.js` extension (required for ESM)

```typescript
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { ToolResult } from '@openfox/shared'
import { logger } from '../utils/logger.js'
```

### Type Imports

Use `import type` for type-only imports (enforced by `verbatimModuleSyntax`):

```typescript
import type { Config } from '../config.js'
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Functions/variables | camelCase | `createLLMClient`, `sessionManager` |
| Types/Interfaces | PascalCase | `SessionState`, `ToolContext` |
| React components | PascalCase | `PlanPanel`, `ChatMessage` |
| Constants | UPPER_SNAKE_CASE | `OUTPUT_LIMITS`, `MAX_FORMAT_RETRIES` |
| Files | kebab-case or camelCase | `session.ts`, `useWebSocket.ts` |

### Error Handling

Custom error classes extend `OpenFoxError`. In tools, return result objects instead of throwing:

```typescript
return { success: false, error: error.message, durationMs, truncated: false }
```

### Functional Patterns

Prefer pure functions, immutability, and composition. Use Zod for runtime validation of config/external input.

## Architecture Patterns

### Tool Implementation (`src/server/tools/`)

```typescript
export const myTool: Tool = {
  name: 'my_tool',
  definition: { type: 'function', function: { name, description, parameters } },
  async execute(args, context): Promise<ToolResult> {
    const startTime = Date.now()
    return { success: true, output, durationMs: Date.now() - startTime, truncated: false }
  },
}
```

### React Components

Functional components with hooks. Use Zustand selectors for performance:

```typescript
const session = useSessionStore(state => state.currentSession)
```

### WebSocket Protocol

Real-time communication via typed messages (`@openfox/shared/protocol`):
- Client: `session.create`, `chat.send`, `mode.switch`
- Server: `session.state`, `chat.delta`, `chat.tool_call`

## Design Principles

### Dumb Client, Smart Server

The web client must be as simple as possible - it renders what the server sends without complex data transformations, joins, or lookups. The server is the single source of truth and normalizes data before sending.

**Rationale:** Other UIs (CLI, mobile, VS Code extension) will be built around the server. Business logic and data shaping belong in the server, not duplicated across clients.

### Streaming/Fetch Parity

Data streamed during real-time operations must be identical in shape to data fetched later (e.g., on page reload). The frontend should use the same rendering code regardless of how data arrived.

**Rationale:** If streaming attaches `toolCall.result` inline, then `session.state` must also have `toolCall.result` attached. No conditional frontend logic to reconcile different data shapes.

## File Structure

```
src/
  cli/           # CLI entry points (openfox, openfox-dev)
  server/
    chat/        # Chat/planning logic
    context/     # Context compaction
    db/          # SQLite persistence
    llm/         # LLM client, streaming, profiles
    lsp/         # Language Server Protocol integration
    runner/      # Agent runner and decision logic
    session/     # Session state machine
    tools/       # Tool implementations (read, write, edit, glob, grep, shell, ask, todo)
    utils/       # Logger, errors, async helpers
    ws/          # WebSocket server and protocol handler
  shared/
    types.ts     # Core domain types
    protocol.ts  # WebSocket message types
    stats.ts     # Session statistics utilities
web/
  src/
    components/  # React components (layout/, plan/, settings/, shared/)
    hooks/       # Custom hooks
    stores/      # Zustand stores
    lib/         # Utilities (ws client, sound, formatting)
e2e/             # End-to-end tests
```

## Environment Variables

Copy `.env.example` to `.env`. Key variables:

```bash
OPENFOX_VLLM_URL=http://localhost:8000/v1
OPENFOX_MODEL_NAME=qwen3.5-122b-int4-autoround
OPENFOX_MAX_CONTEXT=200000
OPENFOX_PORT=10369
OPENFOX_HOST=0.0.0.0
OPENFOX_WORKDIR=/home/conrad/dev
OPENFOX_DB_PATH=./openfox.db
OPENFOX_LOG_LEVEL=info  # debug, info, warn, error
```

## TDD Workflow

When fixing or refactoring: write/update the failing test FIRST, then make it pass.

```bash
# 1. Write failing test
npx vitest run src/tools/myfeature.test.ts  # Should fail

# 2. Implement feature
# 3. Run test again - should pass
npx vitest run src/tools/myfeature.test.ts
```

## E2E Tests

E2E tests run against a local OpenFox server instance. The test setup auto-loads configuration from the root `.env` file.

```bash
cd e2e
npx vitest run                    # Run all e2e tests
npx vitest run protocol.test.ts   # Run specific test file
```

### Verbose Mode

Enable detailed logging of WebSocket messages, tool calls, agent thinking, and phase transitions:

```bash
cd e2e
OPENFOX_TEST_VERBOSE=true npx vitest run
```

The verbose mode shows:
- ▶ Tool calls with arguments
- ◀ Tool results with status
- Real-time agent thinking/output
- Criteria evaluations
- Phase transitions
- Mode switches
- Errors with full details

The setup automatically:
- Loads `.env` from repository root
- Kills any leftover process on the test port (3999)
- Starts the OpenFox server for testing
- Cleans up on ctrl+c or test completion
