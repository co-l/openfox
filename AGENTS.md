# AGENTS.md - OpenFox Codebase Guide

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

### High-Level Architecture

```
┌─────────────────┐     WebSocket      ┌─────────────────────┐
│   React Client  │ ←───────────────── →│  Hono/Express Server │
│   (Zustand)     │  (Typed Protocol)   │  - Tool Registry     │
└─────────────────┘                     │  - LLM Client        │
                                        │  - Session Manager   │
                                        │  - LSP Manager       │
                                        └─────────────────────┘
                                                   │
                                        ┌──────────▼──────────┐
                                        │   SQLite Database   │
                                        │   - Projects        │
                                        │   - Sessions        │
                                        │   - Messages        │
                                        └─────────────────────┘
```

## Directory Structure

```
/home/conrad/dev/openfox/
├── src/
│   ├── cli/              # CLI entry points (openfox, openfox-dev)
│   │   ├── index.ts      # Production CLI
│   │   ├── dev.ts        # Dev mode CLI
│   │   ├── config.ts     # Config management
│   │   └── init.ts       # Project initialization
│   ├── server/
│   │   ├── chat/         # Chat/planning logic
│   │   │   ├── builder.ts        # Builder sub-agent
│   │   │   ├── orchestrator.ts   # Build→verify→done loop
│   │   │   ├── stream-pure.ts    # Pure streaming logic
│   │   │   └── stats.ts          # Session statistics
│   │   ├── context/      # Context compaction
│   │   │   ├── compactor.ts      # Message compaction logic
│   │   │   ├── tokenizer.ts      # Token counting
│   │   │   └── instructions.ts   # AGENTS.md loading
│   │   ├── db/           # SQLite persistence
│   │   │   ├── projects.ts       # Project CRUD
│   │   │   ├── sessions.ts       # Session CRUD
│   │   │   └── settings.ts       # Settings storage
│   │   ├── events/       # Event sourcing
│   │   │   ├── store.ts          # EventStore implementation
│   │   │   └── session.ts        # Session event helpers
│   │   ├── history/      # File change history
│   │   ├── llm/          # LLM client & streaming
│   │   │   ├── client.ts         # OpenAI client wrapper
│   │   │   ├── client-pure.ts    # Pure function helpers
│   │   │   ├── streaming.ts      # SSE streaming
│   │   │   ├── profiles.ts       # Model profiles
│   │   │   └── mock.ts           # Mock LLM for testing
│   │   ├── lsp/          # Language Server Protocol
│   │   │   ├── manager.ts        # LSP manager
│   │   │   ├── server.ts         # LSP server wrappers
│   │   │   └── diagnostics.ts    # Diagnostic collection
│   │   ├── runner/       # Agent runner & decision logic
│   │   │   ├── orchestrator.ts   # Runner orchestrator
│   │   │   ├── decision.ts       # Next action decision
│   │   │   └── types.ts          # Runner types
│   │   ├── session/      # Session state management
│   │   │   ├── manager.ts        # SessionManager class
│   │   │   └── name-generator.ts # Auto-generated names
│   │   ├── sub-agents/   # Sub-agent registry & management
│   │   ├── tools/        # Tool implementations
│   │   │   ├── read.ts           # read_file
│   │   │   ├── write.ts          # write_file
│   │   │   ├── edit.ts           # edit_file
│   │   │   ├── glob.ts           # glob pattern matching
│   │   │   ├── grep.ts           # grep search
│   │   │   ├── shell.ts          # run_command
│   │   │   ├── ask.ts            # ask_user
│   │   │   ├── git.ts            # git operations
│   │   │   ├── web-fetch.ts      # web_fetch
│   │   │   ├── todo.ts           # todo_write
│   │   │   ├── criterion.ts      # criterion management
│   │   │   └── sub-agent.ts      # call_sub_agent
│   │   ├── utils/        # Utilities
│   │   │   ├── errors.ts         # Custom error classes
│   │   │   ├── logger.ts         # Logger
│   │   │   └── async.ts          # Async helpers
│   │   └── ws/           # WebSocket server
│   │       ├── server.ts         # WebSocket handler
│   │       └── protocol.ts       # Message protocol
│   └── shared/
│       ├── types.ts      # Core domain types
│       ├── protocol.ts   # WebSocket message types
│       ├── stats.ts      # Statistics utilities
│       └── sparkline.ts  # Sparkline rendering
├── web/
│   └── src/
│       ├── components/   # React components
│       │   ├── layout/         # Page layout
│       │   ├── plan/           # Planning UI
│       │   ├── settings/       # Settings UI
│       │   └── shared/         # Shared components
│       ├── hooks/        # Custom React hooks
│       ├── stores/       # Zustand stores
│       └── lib/          # Utilities
├── e2e/                  # End-to-end tests
├── dist/                 # Build output
└── openfox.db            # SQLite database
```

## Build, Lint, Test Commands

### From Root

```bash
npm run build        # Build server (tsup) + web (vite)
npm run dev          # Start dev servers (server + web with HMR)
npm run test         # Run all tests (unit + e2e)
npm run test:unit    # Run unit tests only
npm run test:e2e     # Run e2e tests only
npm run typecheck    # TypeScript type checking
npm run clean        # Remove dist/ directory
```

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
- `noPropertyAccessFromIndexSignature` - Use bracket notation for index access

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

Use `import type` for type-only imports:

```typescript
import type { Config } from '../config.js'
import { createLLMClient } from './llm.js'
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Functions/variables | camelCase | `createLLMClient`, `sessionManager` |
| Types/Interfaces | PascalCase | `SessionState`, `ToolContext` |
| React components | PascalCase | `PlanPanel`, `ChatMessage` |
| Constants | UPPER_SNAKE_CASE | `OUTPUT_LIMITS`, `RUNNER_CONFIG` |
| Files | kebab-case or camelCase | `session.ts`, `useWebSocket.ts` |

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

## Key Abstractions

### Tool Pattern

All tools follow this interface:

```typescript
export interface Tool {
  name: string
  definition: LLMToolDefinition  // Schema for LLM
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>
}
```

Tool implementation pattern:

```typescript
export const readFileTool: Tool = {
  name: 'read_file',
  definition: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read file contents',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' }
        },
        required: ['path']
      }
    }
  },
  async execute(args, context) {
    const startTime = Date.now()
    // ... implementation
    return { success: true, output, durationMs: Date.now() - startTime, truncated: false }
  }
}
```

### Session State Machine

Sessions have two modes and multiple phases:

```typescript
type SessionMode = 'planner' | 'builder'
type SessionPhase = 'plan' | 'build' | 'verification' | 'blocked' | 'done'
```

- **Planner mode**: Breaks down tasks into criteria
- **Builder mode**: Implements criteria with automatic verification loop
- **Verifier sub-agent**: Runs inline within builder to confirm criterion completion

### WebSocket Protocol

Real-time communication via typed messages:

**Client → Server:**
- `session.create` - Create new session
- `chat.send` - Send message (works in any mode)
- `chat.stop` - Stop current generation
- `mode.switch` - Switch to different mode
- `mode.accept` - Accept criteria and switch to builder
- `criteria.edit` - Edit criteria from UI
- `runner.launch` - Start auto-loop runner

**Server → Client:**
- `session.state` - Full session state
- `chat.delta` - Text streaming
- `chat.thinking` - Thinking block content
- `chat.tool_call` - Tool being called
- `chat.tool_result` - Tool result
- `phase.changed` - Workflow phase change
- `task.completed` - Task finished with stats

### Context Compaction

- Automatic when approaching context limit
- Summarizes old messages into condensed context windows
- Each window has optional summary of previous window
- Preserves token count at close for tracking

### Criteria System

```typescript
interface Criterion {
  id: string
  description: string  // Self-contained contract with verification steps
  status: CriterionStatus
  attempts: CriterionAttempt[]
}

type CriterionStatus =
  | { type: 'pending' }
  | { type: 'in_progress' }
  | { type: 'completed' }     // Builder marked done
  | { type: 'passed' }        // Verifier confirmed
  | { type: 'failed' }        // Verifier rejected
```

### Sub-Agents

Specialized agents for specific tasks:
- **verifier**: Independent verification of criteria
- **code_reviewer**: Code quality review
- **test_generator**: Test generation
- **debugger**: Error analysis and fix suggestions

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

## Common Pitfalls

1. **Don't import singleton state** - Use dependency injection. Tools receive `ToolContext` with required services (sessionManager, lspManager, etc.)

2. **Don't throw in tools** - Return `{ success: false, error: ... }` instead. The orchestrator handles retries.

3. **Don't mutate state** - All state updates go through event emission. Use immutable patterns.

4. **Don't forget `.js` extension** - ESM requires explicit `.js` in import paths (tsup handles compilation)

5. **Don't use index access without check** - `noUncheckedIndexedAccess` means `arr[i]` is `T | undefined`. Check before use.

6. **Don't ignore tool timeouts** - Long-running operations (shell commands) should respect `context.signal` for cancellation

7. **Don't hardcode paths** - Always use `context.workdir` as base for file operations

8. **Don't skip validation** - Use Zod schemas for any external input (CLI args, webhooks, file content)

9. **Don't assume LLM format** - Models may ignore tool response formats. Implement retry logic with `chat.format_retry` events

10. **Don't block the event loop** - Use async patterns for I/O. Heavy computation should be in worker threads

## Environment Variables

```bash
# LLM Configuration
OPENFOX_VLLM_URL=http://localhost:8000/v1
OPENFOX_MODEL_NAME=qwen3.5-122b-int4-autoround
OPENFOX_MAX_CONTEXT=200000

# Server
OPENFOX_PORT=10369
OPENFOX_HOST=0.0.0.0

# Workspace
OPENFOX_WORKDIR=/home/conrad/dev

# Database
OPENFOX_DB_PATH=./openfox.db

# Logging
OPENFOX_LOG_LEVEL=info  # debug, info, warn, error
```

## TDD Workflow

When fixing or refactoring: write/update the failing test FIRST, then make it pass.

```bash
# Run specific test file (should fail initially)
npx vitest run src/tools/myfeature.test.ts

# After fix, run again to verify
npx vitest run src/tools/myfeature.test.ts
```

## Sub-Agent Integration

Sub-agents are invoked via `call_sub_agent` tool:

```typescript
// In tool implementation
const result = await context.llmClient!.createCompletion({
  messages: [...],
  tools: subAgentTools,
  tool_choice: 'required'
})
```

Available sub-agents:
- `verifier` - Verify completed criteria
- `code_reviewer` - Review code quality
- `test_generator` - Generate tests
- `debugger` - Analyze errors

Each sub-agent runs in isolated context with specialized prompts.
