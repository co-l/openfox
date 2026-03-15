# AGENTS.md - OpenFox Codebase Guide

> Guidelines for AI coding agents operating in this repository.

## Project Overview

OpenFox is a local-LLM-first agentic coding assistant. Turborepo monorepo with three packages:

- `@openfox/server` - Hono HTTP/WebSocket server, LLM client, tools, agent runner
- `@openfox/shared` - Shared types and WebSocket protocol definitions
- `@openfox/web` - React 19 + Tailwind frontend with Zustand state management

## Build, Lint, Test Commands

### Monorepo (from root)

```bash
npm run build        # Build all packages (tsup/vite)
npm run dev          # Start dev servers (server + web)
npm run test         # Run all tests
npm run lint         # Lint all packages
npm run typecheck    # TypeScript check all packages
npm run clean        # Remove dist/ and node_modules/
```

### Single Package

```bash
npm run build --filter=@openfox/server
npm run test --filter=@openfox/server
```

### Single Test File (server package)

```bash
cd packages/server
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

### Tool Implementation (`packages/server/src/tools/`)

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
packages/
  server/src/
    agent/       # Agent runner and prompts
    chat/        # Chat/planning logic
    context/     # Context compaction
    db/          # SQLite persistence
    llm/         # LLM client, streaming, profiles
    session/     # Session state machine
    tools/       # Tool implementations (read, write, edit, glob, grep, shell)
    utils/       # Logger, errors, async helpers
    ws/          # WebSocket server and protocol handler
  shared/src/
    types.ts     # Core domain types
    protocol.ts  # WebSocket message types
  web/src/
    components/  # React components (layout/, plan/, shared/)
    hooks/       # Custom hooks
    stores/      # Zustand stores
    lib/         # Utilities (ws client, sound, formatting)
```

## Environment Variables

Copy `.env.example` to `.env`. Key variables:

```bash
OPENFOX_VLLM_URL=http://localhost:8000/v1
OPENFOX_MODEL_NAME=qwen3.5-122b-int4-autoround
OPENFOX_MAX_CONTEXT=200000
OPENFOX_PORT=3000
OPENFOX_LOG_LEVEL=info  # debug, info, warn, error
```

## TDD Workflow

When fixing or refactoring: write/update the failing test FIRST, then make it pass.

```bash
# 1. Write failing test
cd packages/server
npx vitest run src/tools/myfeature.test.ts  # Should fail

# 2. Implement feature
# 3. Run test again - should pass
npx vitest run src/tools/myfeature.test.ts
```
