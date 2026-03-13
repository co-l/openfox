# OpenFox Specification

> A local-LLM-first agentic coding assistant designed for reliability, transparency, and iterative refinement.

**Version**: 0.1.0  
**Author**: Conrad  
**Date**: 2026-03-13

---

## Table of Contents

1. [Vision & Goals](#1-vision--goals)
2. [Architecture Overview](#2-architecture-overview)
3. [Core Components](#3-core-components)
4. [Data Models](#4-data-models)
5. [API Design](#5-api-design)
6. [Tool System](#6-tool-system)
7. [Phase System](#7-phase-system)
8. [Context Management](#8-context-management)
9. [Error Handling & Recovery](#9-error-handling--recovery)
10. [LSP Integration](#10-lsp-integration)
11. [Metrics & Observability](#11-metrics--observability)
12. [UI/UX Design](#12-uiux-design)
13. [Configuration](#13-configuration)
14. [Security Considerations](#14-security-considerations)
15. [Implementation Roadmap](#15-implementation-roadmap)
16. [Future Considerations](#16-future-considerations)

---

## 1. Vision & Goals

### 1.1 Problem Statement

Current agentic coding tools have fundamental issues when used with local LLMs:

1. **Tool calling brittleness**: Malformed tool calls cause the agent to halt entirely
2. **Context drift**: Over long sessions, the model forgets initial requirements
3. **No contract enforcement**: The model decides when it's "done" with no verification
4. **Opaque performance**: No visibility into LLM performance characteristics
5. **No recovery mechanism**: Single failures are terminal

### 1.2 Solution

OpenFox addresses these through:

1. **Plan Phase**: Interactive requirement refinement producing explicit acceptance criteria
2. **Contract-Driven Execution**: Acceptance criteria serve as an immutable contract
3. **Iterative Runner**: Agent loops until all criteria pass, with automatic retry on failures
4. **Fresh-Context Validation**: Independent LLM verification with clean context
5. **Real-Time Metrics**: Visibility into prefill time, generation speed, context usage
6. **LSP Integration**: Immediate feedback on code validity

### 1.3 Design Principles

| Principle | Description |
|-----------|-------------|
| **Local-First** | Optimized for local vLLM deployments, not cloud APIs |
| **Transparency** | Every LLM call, tool execution, and decision is visible |
| **Reliability Over Speed** | Prefer correctness and recovery over raw throughput |
| **Separation of Concerns** | Server handles all logic; frontend is pure presentation |
| **Functional Core** | Pure functions, immutable state, explicit side effects |

### 1.4 Target Environment

- **Hardware**: NVIDIA DGX Spark (or similar) with 128GB+ unified memory
- **Model**: Qwen 3.5 122B int4-autoround (or comparable)
- **Backend**: vLLM with OpenAI-compatible API
- **Context Window**: 200,000 tokens
- **Runtime**: Node.js 24 LTS

---

## 2. Architecture Overview

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Browser (React 19 + Tailwind)                    │
│  ┌────────────────┐  ┌─────────────────────┐  ┌──────────────────────┐  │
│  │  Plan Panel    │  │  Execution Panel    │  │  Metrics Panel       │  │
│  │                │  │                     │  │                      │  │
│  │  Chat UI       │  │  Agent Stream       │  │  Prefill: 2.3s       │  │
│  │  Criteria Edit │  │  Tool Calls         │  │  Speed: 45 t/s       │  │
│  │  [Accept]      │  │  LSP Diagnostics    │  │  Context: 32K/200K   │  │
│  └────────────────┘  └─────────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ WebSocket (bidirectional)
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                           OpenFox Server                                │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        Session Manager                           │   │
│  │  • Phase state machine (planning → executing → validating)       │   │
│  │  • Conversation history                                          │   │
│  │  • Persistence coordination                                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│         ┌──────────────────────────┼──────────────────────────┐        │
│         │                          │                          │        │
│         ▼                          ▼                          ▼        │
│  ┌─────────────┐           ┌─────────────┐           ┌─────────────┐   │
│  │   Planner   │           │   Agent     │           │  Validator  │   │
│  │             │           │   Runner    │           │             │   │
│  │ • Chat loop │           │ • Tool loop │           │ • Fresh ctx │   │
│  │ • Extract   │           │ • Retry     │           │ • Verify    │   │
│  │   criteria  │           │ • Recovery  │           │   criteria  │   │
│  └─────────────┘           └─────────────┘           └─────────────┘   │
│         │                          │                          │        │
│         └──────────────────────────┼──────────────────────────┘        │
│                                    │                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        Shared Services                           │   │
│  ├─────────────┬─────────────┬─────────────┬─────────────┬─────────┤   │
│  │ vLLM Client │ Tool Exec   │ LSP Bridge  │ Compactor   │ DB      │   │
│  └─────────────┴─────────────┴─────────────┴─────────────┴─────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                    │                   │                   │
                    ▼                   ▼                   ▼
             ┌──────────┐        ┌──────────┐        ┌──────────┐
             │  vLLM    │        │  LSP     │        │  File    │
             │  Server  │        │  Servers │        │  System  │
             └──────────┘        └──────────┘        └──────────┘
```

### 2.2 Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Runtime** | Node.js 24 LTS | Latest LTS, native fetch, better perf |
| **Language** | TypeScript 5.7+ | Type safety, better tooling |
| **Server Framework** | Hono | Lightweight, fast, good WS support |
| **WebSocket** | ws + Hono adapter | Proven, full-featured |
| **Database** | SQLite (better-sqlite3) | Single file, fast, ACID |
| **Frontend** | React 19 | Latest concurrent features |
| **Styling** | Tailwind CSS 4 | Utility-first, fast iteration |
| **State** | Zustand | Simple, minimal boilerplate |
| **Build** | Vite + tsup | Fast dev, optimized prod |
| **Monorepo** | Turborepo | Incremental builds, caching |

### 2.3 Directory Structure

```
openfox/
├── package.json                    # Workspace root
├── turbo.json                      # Turborepo config
├── tsconfig.base.json              # Shared TS config
├── .env.example                    # Environment template
├── SPEC.md                         # This document
│
├── packages/
│   ├── server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts            # Entry: HTTP + WS server
│   │   │   ├── config.ts           # Configuration loading
│   │   │   │
│   │   │   ├── session/
│   │   │   │   ├── manager.ts      # Session lifecycle
│   │   │   │   ├── state.ts        # State machine
│   │   │   │   └── types.ts        # Session types
│   │   │   │
│   │   │   ├── planner/
│   │   │   │   ├── index.ts        # Plan phase orchestration
│   │   │   │   ├── extractor.ts    # Criteria extraction
│   │   │   │   └── prompts.ts      # System prompts
│   │   │   │
│   │   │   ├── agent/
│   │   │   │   ├── runner.ts       # Main agent loop
│   │   │   │   ├── executor.ts     # Tool execution
│   │   │   │   └── prompts.ts      # Agent prompts
│   │   │   │
│   │   │   ├── validator/
│   │   │   │   ├── index.ts        # Validation phase
│   │   │   │   └── prompts.ts      # Validation prompts
│   │   │   │
│   │   │   ├── tools/
│   │   │   │   ├── index.ts        # Tool registry
│   │   │   │   ├── types.ts        # Tool type definitions
│   │   │   │   ├── schema.ts       # JSON schemas for tools
│   │   │   │   ├── read.ts         # read_file tool
│   │   │   │   ├── write.ts        # write_file tool
│   │   │   │   ├── edit.ts         # edit_file tool
│   │   │   │   ├── shell.ts        # run_command tool
│   │   │   │   ├── glob.ts         # glob tool
│   │   │   │   ├── grep.ts         # grep tool
│   │   │   │   └── ask.ts          # ask_user tool
│   │   │   │
│   │   │   ├── llm/
│   │   │   │   ├── client.ts       # vLLM OpenAI client
│   │   │   │   ├── streaming.ts    # Stream handling
│   │   │   │   ├── metrics.ts      # vLLM metrics collector
│   │   │   │   └── types.ts        # LLM types
│   │   │   │
│   │   │   ├── context/
│   │   │   │   ├── manager.ts      # Context window management
│   │   │   │   ├── compactor.ts    # Context compaction
│   │   │   │   ├── tokenizer.ts    # Token counting
│   │   │   │   └── types.ts        # Context types
│   │   │   │
│   │   │   ├── lsp/
│   │   │   │   ├── bridge.ts       # LSP client manager
│   │   │   │   ├── detector.ts     # Language detection
│   │   │   │   ├── diagnostics.ts  # Diagnostic collection
│   │   │   │   └── types.ts        # LSP types
│   │   │   │
│   │   │   ├── db/
│   │   │   │   ├── index.ts        # Database setup
│   │   │   │   ├── migrations.ts   # Schema migrations
│   │   │   │   ├── sessions.ts     # Session persistence
│   │   │   │   └── types.ts        # DB types
│   │   │   │
│   │   │   ├── ws/
│   │   │   │   ├── server.ts       # WebSocket server
│   │   │   │   ├── protocol.ts     # Message protocol
│   │   │   │   └── types.ts        # WS types
│   │   │   │
│   │   │   └── utils/
│   │   │       ├── logger.ts       # Structured logging
│   │   │       ├── errors.ts       # Error types
│   │   │       └── async.ts        # Async utilities
│   │   │
│   │   └── test/
│   │       ├── setup.ts
│   │       ├── session.test.ts
│   │       ├── agent.test.ts
│   │       ├── tools.test.ts
│   │       └── fixtures/
│   │
│   ├── web/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── main.tsx            # Entry point
│   │   │   ├── App.tsx             # Root component
│   │   │   │
│   │   │   ├── components/
│   │   │   │   ├── layout/
│   │   │   │   │   ├── AppShell.tsx
│   │   │   │   │   ├── Header.tsx
│   │   │   │   │   └── Panels.tsx
│   │   │   │   │
│   │   │   │   ├── plan/
│   │   │   │   │   ├── PlanPanel.tsx
│   │   │   │   │   ├── ChatInput.tsx
│   │   │   │   │   ├── ChatMessage.tsx
│   │   │   │   │   └── CriteriaEditor.tsx
│   │   │   │   │
│   │   │   │   ├── execution/
│   │   │   │   │   ├── ExecutionPanel.tsx
│   │   │   │   │   ├── AgentStream.tsx
│   │   │   │   │   ├── ToolCall.tsx
│   │   │   │   │   └── CriteriaProgress.tsx
│   │   │   │   │
│   │   │   │   ├── metrics/
│   │   │   │   │   ├── MetricsPanel.tsx
│   │   │   │   │   ├── SpeedGauge.tsx
│   │   │   │   │   ├── ContextUsage.tsx
│   │   │   │   │   └── DiagnosticsView.tsx
│   │   │   │   │
│   │   │   │   └── shared/
│   │   │   │       ├── Button.tsx
│   │   │   │       ├── Input.tsx
│   │   │   │       ├── Modal.tsx
│   │   │   │       └── Spinner.tsx
│   │   │   │
│   │   │   ├── hooks/
│   │   │   │   ├── useWebSocket.ts
│   │   │   │   ├── useSession.ts
│   │   │   │   └── useMetrics.ts
│   │   │   │
│   │   │   ├── stores/
│   │   │   │   ├── session.ts      # Session state
│   │   │   │   ├── metrics.ts      # Metrics state
│   │   │   │   └── ui.ts           # UI state
│   │   │   │
│   │   │   ├── lib/
│   │   │   │   ├── ws.ts           # WebSocket client
│   │   │   │   └── protocol.ts     # Shared protocol types
│   │   │   │
│   │   │   └── styles/
│   │   │       └── globals.css     # Tailwind imports
│   │   │
│   │   └── test/
│   │       └── components/
│   │
│   └── shared/
│       ├── package.json
│       ├── src/
│       │   ├── protocol.ts         # WS message types
│       │   ├── criteria.ts         # Criteria types
│       │   ├── tools.ts            # Tool definitions
│       │   └── utils.ts            # Shared utilities
│       └── tsconfig.json
│
└── scripts/
    ├── dev.sh                      # Start dev environment
    ├── build.sh                    # Production build
    └── migrate.ts                  # Run DB migrations
```

---

## 3. Core Components

### 3.1 Session Manager

The Session Manager is the central coordinator for all session state.

#### Responsibilities

- Maintain session lifecycle (create, load, save, archive)
- Coordinate phase transitions
- Persist state to SQLite
- Broadcast state changes to connected clients

#### State Machine

```
                    ┌─────────────┐
                    │   IDLE      │
                    │  (no task)  │
                    └──────┬──────┘
                           │ user sends message
                           ▼
                    ┌─────────────┐
              ┌────▶│  PLANNING   │◀────┐
              │     │             │     │
              │     └──────┬──────┘     │
              │            │            │
              │            │ user accepts criteria
              │            ▼            │
              │     ┌─────────────┐     │
              │     │  EXECUTING  │     │
              │     │             │     │
              │     └──────┬──────┘     │
              │            │            │
              │            │ agent reports done
              │            ▼            │
              │     ┌─────────────┐     │
              │     │ VALIDATING  │     │
              │     │             │     │
              │     └──────┬──────┘     │
              │            │            │
              │            ├─── validation fails ───┘
              │            │
              │            │ validation passes
              │            ▼
              │     ┌─────────────┐
              │     │  COMPLETED  │
              │     │             │
              │     └──────┬──────┘
              │            │
              └── user starts new task ─┘
```

#### Interface

```typescript
interface SessionManager {
  // Lifecycle
  createSession(workdir: string): Promise<Session>
  loadSession(id: string): Promise<Session | null>
  listSessions(): Promise<SessionSummary[]>
  archiveSession(id: string): Promise<void>
  
  // State
  getState(sessionId: string): SessionState
  transition(sessionId: string, event: SessionEvent): Promise<SessionState>
  
  // Messaging
  addMessage(sessionId: string, message: Message): Promise<void>
  getMessages(sessionId: string): Message[]
  
  // Criteria
  setCriteria(sessionId: string, criteria: Criterion[]): Promise<void>
  updateCriterion(sessionId: string, criterionId: string, status: CriterionStatus): Promise<void>
  
  // Subscriptions
  subscribe(sessionId: string, callback: (event: SessionEvent) => void): Unsubscribe
}
```

### 3.2 Planner

Handles the planning phase: chat interaction and criteria extraction.

#### Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         PLANNING PHASE                          │
│                                                                 │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐      │
│  │  User   │───▶│   LLM   │───▶│ Extract │───▶│ Display │      │
│  │ Message │    │  Chat   │    │Criteria │    │Criteria │      │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘      │
│       ▲                                            │            │
│       │                                            │            │
│       └────────────── Refine ──────────────────────┘            │
│                                                                 │
│                         ┌─────────┐                             │
│                         │ Accept  │──────▶ EXECUTING            │
│                         └─────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

#### Criteria Extraction

After each user message, the planner prompts the LLM to extract/update acceptance criteria:

```typescript
const CRITERIA_EXTRACTION_PROMPT = `
Based on the conversation so far, extract a list of acceptance criteria.
Each criterion should be:
- Specific and verifiable
- Self-contained (understandable without context)
- Actionable

Output as JSON:
{
  "criteria": [
    {
      "id": "unique-id",
      "description": "Clear description of what must be true",
      "verification": "auto" | "model" | "human",
      "command": "optional shell command for auto verification"
    }
  ],
  "questions": ["Any clarifying questions for the user"]
}
`
```

#### Interface

```typescript
interface Planner {
  // Chat
  chat(sessionId: string, userMessage: string): AsyncIterable<PlannerEvent>
  
  // Criteria
  extractCriteria(sessionId: string): Promise<Criterion[]>
  
  // Transition
  acceptCriteria(sessionId: string): Promise<void>
}

type PlannerEvent = 
  | { type: 'text_delta', content: string }
  | { type: 'criteria_update', criteria: Criterion[] }
  | { type: 'question', questions: string[] }
  | { type: 'done' }
```

### 3.3 Agent Runner

The core execution engine that drives the agent toward completing acceptance criteria.

#### Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EXECUTION PHASE                             │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                      Agent Loop                               │  │
│  │                                                               │  │
│  │  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐   │  │
│  │  │ Build   │───▶│  LLM    │───▶│  Parse  │───▶│ Execute │   │  │
│  │  │ Prompt  │    │  Call   │    │Response │    │  Tools  │   │  │
│  │  └─────────┘    └─────────┘    └─────────┘    └─────────┘   │  │
│  │       ▲                                            │         │  │
│  │       │                                            │         │  │
│  │       │         ┌─────────┐    ┌─────────┐        │         │  │
│  │       └─────────│ Update  │◀───│  Check  │◀───────┘         │  │
│  │                 │ Context │    │Criteria │                   │  │
│  │                 └─────────┘    └─────────┘                   │  │
│  │                                     │                        │  │
│  │                                     │ All criteria pass      │  │
│  │                                     ▼                        │  │
│  └──────────────────────────────▶ VALIDATING                    │  │
│                                                                     │
│  Recovery Paths:                                                    │
│  • Tool error → Retry with error context                           │
│  • Stuck (3 failures) → Pause, surface to user                     │
│  • Context full → Compact and continue                             │
└─────────────────────────────────────────────────────────────────────┘
```

#### Prompt Structure

```typescript
const AGENT_SYSTEM_PROMPT = `
You are an expert software engineer. Your task is to satisfy the acceptance criteria below.

## ACCEPTANCE CRITERIA (CONTRACT)
{criteria_list}

## RULES
1. Work through criteria systematically
2. After each action, assess which criteria you can mark as complete
3. Use tools to read, write, and test code
4. If a tool fails, analyze the error and retry with corrections
5. When you believe all criteria are satisfied, report completion

## TOOLS
{tool_definitions}

## CURRENT STATE
Files modified: {modified_files}
Criteria status: {criteria_status}
`
```

#### Interface

```typescript
interface AgentRunner {
  // Execution
  run(sessionId: string): AsyncIterable<AgentEvent>
  pause(sessionId: string): Promise<void>
  resume(sessionId: string): AsyncIterable<AgentEvent>
  
  // Intervention
  userIntervention(sessionId: string, message: string): Promise<void>
}

type AgentEvent =
  | { type: 'thinking', content: string }
  | { type: 'tool_call', tool: string, args: unknown }
  | { type: 'tool_result', tool: string, result: ToolResult }
  | { type: 'tool_error', tool: string, error: string, willRetry: boolean }
  | { type: 'criterion_update', criterionId: string, status: CriterionStatus }
  | { type: 'context_compaction', beforeTokens: number, afterTokens: number }
  | { type: 'stuck', reason: string, failedAttempts: number }
  | { type: 'done', allCriteriaPassed: boolean }
  | { type: 'error', error: string }
```

### 3.4 Validator

Performs independent verification of acceptance criteria using a fresh context.

#### Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                       VALIDATION PHASE                          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Fresh LLM Context                           │   │
│  │                                                          │   │
│  │  Input:                                                  │   │
│  │  • Acceptance criteria list                              │   │
│  │  • All modified files (full content)                     │   │
│  │  • Test results (if applicable)                          │   │
│  │  • LSP diagnostics                                       │   │
│  │                                                          │   │
│  │  Task:                                                   │   │
│  │  For each criterion, independently verify:               │   │
│  │  "Does the code satisfy this requirement?"               │   │
│  │                                                          │   │
│  │  Output:                                                 │   │
│  │  • Pass/fail for each criterion                          │   │
│  │  • Reasoning for each decision                           │   │
│  │  • Specific issues found                                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│              ┌───────────────┴───────────────┐                 │
│              ▼                               ▼                 │
│       ┌─────────────┐                 ┌─────────────┐          │
│       │  All Pass   │                 │  Some Fail  │          │
│       │             │                 │             │          │
│       │ → COMPLETED │                 │ → EXECUTING │          │
│       └─────────────┘                 │   (retry)   │          │
│                                       └─────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

#### Validation Prompt

```typescript
const VALIDATION_PROMPT = `
You are a code reviewer performing independent verification.

## ACCEPTANCE CRITERIA
{criteria_list}

## MODIFIED FILES
{file_contents}

## TEST RESULTS
{test_output}

## LSP DIAGNOSTICS
{diagnostics}

## TASK
For each criterion, determine if the code satisfies it.
Be strict - only mark as PASS if the requirement is fully met.

Output JSON:
{
  "results": [
    {
      "criterionId": "...",
      "status": "pass" | "fail",
      "reasoning": "Why this passes or fails",
      "issues": ["Specific issues if fail"]
    }
  ]
}
`
```

#### Interface

```typescript
interface Validator {
  validate(sessionId: string): Promise<ValidationResult>
}

interface ValidationResult {
  allPassed: boolean
  results: CriterionValidation[]
}

interface CriterionValidation {
  criterionId: string
  status: 'pass' | 'fail'
  reasoning: string
  issues: string[]
}
```

---

## 4. Data Models

### 4.1 Session

```typescript
interface Session {
  id: string                      // UUID
  workdir: string                 // Absolute path to working directory
  phase: SessionPhase             // Current phase
  createdAt: Date
  updatedAt: Date
  
  // Conversation
  messages: Message[]
  
  // Criteria
  criteria: Criterion[]
  
  // Execution state
  executionState: ExecutionState | null
  
  // Metadata
  metadata: {
    title?: string                // Auto-generated or user-set
    totalTokensUsed: number
    totalToolCalls: number
    iterationCount: number        // How many execution→validation cycles
  }
}

type SessionPhase = 'idle' | 'planning' | 'executing' | 'validating' | 'completed'
```

### 4.2 Message

```typescript
interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  
  // For assistant messages
  toolCalls?: ToolCall[]
  thinkingContent?: string        // Extracted <think> blocks
  
  // For tool messages
  toolCallId?: string
  toolName?: string
  toolResult?: ToolResult
  
  // Metadata
  timestamp: Date
  tokenCount: number
  
  // For compacted messages
  isCompacted?: boolean
  originalMessageIds?: string[]
}
```

### 4.3 Criterion

```typescript
interface Criterion {
  id: string
  description: string
  
  // Verification method
  verification: CriterionVerification
  
  // Current status
  status: CriterionStatus
  
  // History
  attempts: CriterionAttempt[]
}

type CriterionVerification = 
  | { type: 'auto', command: string }     // Run command, check exit code
  | { type: 'model' }                      // LLM verifies in validation phase
  | { type: 'human' }                      // User confirms manually

type CriterionStatus = 
  | { type: 'pending' }
  | { type: 'in_progress' }
  | { type: 'passed', verifiedAt: Date, verifiedBy: 'auto' | 'model' | 'human' }
  | { type: 'failed', reason: string, failedAt: Date }

interface CriterionAttempt {
  attemptNumber: number
  status: 'passed' | 'failed'
  timestamp: Date
  details?: string
}
```

### 4.4 Tool Call

```typescript
interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

interface ToolResult {
  success: boolean
  output?: string
  error?: string
  
  // Metadata
  durationMs: number
  truncated: boolean
}
```

### 4.5 Execution State

```typescript
interface ExecutionState {
  // Current iteration
  iteration: number
  
  // Files modified this session
  modifiedFiles: Set<string>
  
  // Retry tracking
  consecutiveFailures: number
  lastFailedTool?: string
  lastFailureReason?: string
  
  // Context tracking
  currentTokenCount: number
  compactionCount: number
  
  // Timing
  startedAt: Date
  lastActivityAt: Date
}
```

---

## 5. API Design

### 5.1 WebSocket Protocol

All client-server communication uses WebSocket with JSON messages.

#### Message Format

```typescript
// Client → Server
interface ClientMessage {
  id: string                      // Request ID for correlation
  type: ClientMessageType
  payload: unknown
}

type ClientMessageType =
  | 'session.create'
  | 'session.load'
  | 'session.list'
  | 'plan.message'
  | 'plan.accept'
  | 'plan.edit_criteria'
  | 'agent.start'
  | 'agent.pause'
  | 'agent.resume'
  | 'agent.intervene'
  | 'validate.start'
  | 'criterion.human_verify'

// Server → Client
interface ServerMessage {
  id?: string                     // Correlation ID if response
  type: ServerMessageType
  payload: unknown
}

type ServerMessageType =
  | 'session.state'               // Full session state
  | 'session.list'                // List of sessions
  | 'plan.delta'                  // Streaming text delta
  | 'plan.criteria'               // Updated criteria list
  | 'agent.event'                 // Agent execution event
  | 'validation.result'           // Validation results
  | 'metrics.update'              // vLLM metrics update
  | 'lsp.diagnostics'             // LSP diagnostics update
  | 'error'                       // Error message
```

#### Example Flows

**Planning Flow:**
```
Client                              Server
  │                                    │
  ├─ session.create ──────────────────▶│
  │◀────────────────── session.state ──┤
  │                                    │
  ├─ plan.message ────────────────────▶│
  │◀────────────────── plan.delta ─────┤ (streaming)
  │◀────────────────── plan.delta ─────┤
  │◀────────────────── plan.criteria ──┤
  │                                    │
  ├─ plan.accept ─────────────────────▶│
  │◀────────────────── session.state ──┤ (phase: executing)
```

**Execution Flow:**
```
Client                              Server
  │                                    │
  ├─ agent.start ─────────────────────▶│
  │◀────────────────── agent.event ────┤ (thinking)
  │◀────────────────── agent.event ────┤ (tool_call)
  │◀────────────────── agent.event ────┤ (tool_result)
  │◀────────────────── lsp.diagnostics─┤
  │◀────────────────── agent.event ────┤ (criterion_update)
  │◀────────────────── metrics.update ─┤
  │                                    │
  │◀────────────────── agent.event ────┤ (done)
  │◀────────────────── session.state ──┤ (phase: validating)
```

### 5.2 REST Endpoints (Secondary)

For non-realtime operations:

```
GET  /api/sessions              # List all sessions
GET  /api/sessions/:id          # Get session details
POST /api/sessions              # Create session (alternative to WS)
DEL  /api/sessions/:id          # Archive session

GET  /api/health                # Health check
GET  /api/metrics               # Prometheus metrics export
```

---

## 6. Tool System

### 6.1 Tool Definitions

Each tool is defined with a JSON schema for arguments and typed result.

```typescript
interface ToolDefinition {
  name: string
  description: string
  parameters: JSONSchema
  execute: (args: unknown, context: ToolContext) => Promise<ToolResult>
}

interface ToolContext {
  workdir: string
  sessionId: string
  onProgress?: (progress: string) => void
}
```

### 6.2 Built-in Tools

#### read_file
```typescript
const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file (relative to workdir or absolute)'
      },
      offset: {
        type: 'number',
        description: 'Line number to start from (1-indexed)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read'
      }
    },
    required: ['path']
  },
  execute: async (args, ctx) => {
    // Implementation
  }
}
```

#### write_file
```typescript
const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: 'Write content to a file (creates or overwrites)',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file'
      },
      content: {
        type: 'string',
        description: 'Content to write'
      }
    },
    required: ['path', 'content']
  },
  execute: async (args, ctx) => {
    // Implementation
    // Triggers LSP diagnostics update
  }
}
```

#### edit_file
```typescript
const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description: 'Replace specific text in a file',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file'
      },
      old_string: {
        type: 'string',
        description: 'Exact text to find and replace'
      },
      new_string: {
        type: 'string',
        description: 'Replacement text'
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurrences (default: false)'
      }
    },
    required: ['path', 'old_string', 'new_string']
  },
  execute: async (args, ctx) => {
    // Implementation
    // Fail if old_string not found
    // Fail if multiple matches and replace_all not set
  }
}
```

#### run_command
```typescript
const runCommandTool: ToolDefinition = {
  name: 'run_command',
  description: 'Execute a shell command',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute'
      },
      cwd: {
        type: 'string',
        description: 'Working directory (default: session workdir)'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 120000)'
      }
    },
    required: ['command']
  },
  execute: async (args, ctx) => {
    // Implementation
    // Capture stdout/stderr
    // Return exit code
  }
}
```

#### glob
```typescript
const globTool: ToolDefinition = {
  name: 'glob',
  description: 'Find files matching a pattern',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern (e.g., "**/*.ts")'
      },
      cwd: {
        type: 'string',
        description: 'Base directory for the search'
      }
    },
    required: ['pattern']
  },
  execute: async (args, ctx) => {
    // Implementation
    // Return list of matching paths
  }
}
```

#### grep
```typescript
const grepTool: ToolDefinition = {
  name: 'grep',
  description: 'Search for pattern in files',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for'
      },
      include: {
        type: 'string',
        description: 'File pattern to include (e.g., "*.ts")'
      },
      cwd: {
        type: 'string',
        description: 'Base directory for the search'
      }
    },
    required: ['pattern']
  },
  execute: async (args, ctx) => {
    // Implementation
    // Return matches with file:line:content
  }
}
```

#### ask_user
```typescript
const askUserTool: ToolDefinition = {
  name: 'ask_user',
  description: 'Pause and ask the user a question',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask'
      }
    },
    required: ['question']
  },
  execute: async (args, ctx) => {
    // Implementation
    // Pauses agent execution
    // Waits for user response via WebSocket
    // Returns user's answer
  }
}
```

### 6.3 Tool Output Limits

To prevent context overflow:

```typescript
const TOOL_OUTPUT_LIMITS = {
  read_file: {
    maxLines: 2000,
    maxBytes: 100_000
  },
  run_command: {
    maxLines: 2000,
    maxBytes: 50_000
  },
  glob: {
    maxResults: 500
  },
  grep: {
    maxMatches: 200
  }
}
```

When limits are exceeded, output is truncated with a message:
```
[Output truncated. Showing first 2000 lines of 5432 total. Use offset/limit to read more.]
```

---

## 7. Phase System

### 7.1 Phase Transitions

```typescript
const PHASE_TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  idle: ['planning'],
  planning: ['executing', 'idle'],        // Accept criteria or cancel
  executing: ['validating', 'planning'],  // Done or user intervention
  validating: ['completed', 'executing'], // Pass or retry
  completed: ['planning', 'idle']         // New task or close
}

function canTransition(from: SessionPhase, to: SessionPhase): boolean {
  return PHASE_TRANSITIONS[from].includes(to)
}
```

### 7.2 Phase Entry Conditions

| Phase | Entry Condition |
|-------|-----------------|
| `planning` | User sends first message or starts new task |
| `executing` | User accepts criteria (at least 1 criterion) |
| `validating` | Agent reports all criteria complete |
| `completed` | Validator confirms all criteria pass |

### 7.3 Phase Exit Conditions

| Phase | Exit Condition | Next Phase |
|-------|----------------|------------|
| `planning` | User accepts criteria | `executing` |
| `planning` | User cancels | `idle` |
| `executing` | Agent reports done | `validating` |
| `executing` | User pauses + requests planning | `planning` |
| `validating` | All criteria pass | `completed` |
| `validating` | Any criterion fails | `executing` |
| `completed` | User starts new task | `planning` |

---

## 8. Context Management

### 8.1 Token Counting

Use tiktoken or approximate counting:

```typescript
interface TokenCounter {
  count(text: string): number
  countMessages(messages: Message[]): number
}

// Approximate: 1 token ≈ 4 characters for English
const APPROX_CHARS_PER_TOKEN = 4

function approximateTokenCount(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN)
}
```

### 8.2 Context Budget

```typescript
const CONTEXT_CONFIG = {
  maxTokens: 200_000,             // Model's context window
  
  // Reserved space
  systemPromptReserve: 4_000,     // System prompt + tools
  criteriaReserve: 2_000,         // Always keep criteria
  responseReserve: 8_000,         // Space for model response
  
  // Compaction triggers
  compactionThreshold: 0.85,      // Compact at 85% full
  compactionTarget: 0.60,         // Compact down to 60%
}

function availableTokens(config: typeof CONTEXT_CONFIG): number {
  return config.maxTokens 
    - config.systemPromptReserve 
    - config.criteriaReserve 
    - config.responseReserve
}
```

### 8.3 Context Compaction

When context exceeds threshold:

```typescript
interface Compactor {
  compact(messages: Message[], targetTokens: number): Promise<Message[]>
}

const COMPACTION_PROMPT = `
Summarize the following conversation history, preserving:
1. All file modifications made (what files, what changes)
2. All errors encountered and how they were resolved
3. Current status of each acceptance criterion
4. Any important decisions or learnings

Be concise but complete. Output as a structured summary.

CONVERSATION:
{messages}
`
```

#### Compaction Strategy

1. **Identify compactable regions**: Old messages, resolved tool call chains
2. **Preserve recent context**: Last N messages always kept intact
3. **Preserve criteria updates**: All criterion status changes
4. **Generate summary**: LLM summarizes compactable region
5. **Replace with summary**: Single `[COMPACTED]` message with summary

```typescript
async function compactContext(
  messages: Message[],
  targetTokens: number,
  llmClient: LLMClient
): Promise<Message[]> {
  const totalTokens = countTokens(messages)
  if (totalTokens <= targetTokens) return messages
  
  // Keep last 10 messages intact
  const recentMessages = messages.slice(-10)
  const oldMessages = messages.slice(0, -10)
  
  // Generate summary of old messages
  const summary = await llmClient.complete({
    messages: [
      { role: 'system', content: COMPACTION_PROMPT },
      { role: 'user', content: formatMessages(oldMessages) }
    ]
  })
  
  // Create compacted message
  const compactedMessage: Message = {
    id: generateId(),
    role: 'system',
    content: `[COMPACTED HISTORY]\n${summary}`,
    isCompacted: true,
    originalMessageIds: oldMessages.map(m => m.id),
    timestamp: new Date(),
    tokenCount: countTokens(summary)
  }
  
  return [compactedMessage, ...recentMessages]
}
```

---

## 9. Error Handling & Recovery

### 9.1 Error Classification

```typescript
type ToolError =
  | { type: 'not_found', path: string }
  | { type: 'permission_denied', path: string }
  | { type: 'invalid_args', details: string }
  | { type: 'timeout', command: string, timeoutMs: number }
  | { type: 'execution_failed', exitCode: number, stderr: string }
  | { type: 'multiple_matches', count: number }
  | { type: 'no_match', searchedFor: string }

type LLMError =
  | { type: 'rate_limit', retryAfter: number }
  | { type: 'context_overflow', tokens: number, max: number }
  | { type: 'invalid_response', raw: string }
  | { type: 'connection_failed', details: string }
```

### 9.2 Retry Strategy

```typescript
const RETRY_CONFIG = {
  maxRetries: 3,
  backoffMs: [1000, 2000, 4000],  // Exponential backoff
  
  // Retryable errors
  retryable: [
    'rate_limit',
    'connection_failed',
    'timeout'
  ],
  
  // Non-retryable (need user intervention)
  terminal: [
    'context_overflow',
    'permission_denied'
  ]
}

async function withRetry<T>(
  operation: () => Promise<T>,
  config: typeof RETRY_CONFIG
): Promise<T> {
  let lastError: Error
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      
      if (!isRetryable(error, config)) {
        throw error
      }
      
      if (attempt < config.maxRetries) {
        await sleep(config.backoffMs[attempt])
      }
    }
  }
  
  throw lastError
}
```

### 9.3 Agent Recovery Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Tool Execution Error                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
                  ┌───────────────────┐
                  │ Classify Error    │
                  └─────────┬─────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
     ┌──────────┐    ┌──────────┐    ┌──────────┐
     │ Transient│    │ Semantic │    │ Terminal │
     │ (retry)  │    │ (inform) │    │ (stop)   │
     └────┬─────┘    └────┬─────┘    └────┬─────┘
          │               │               │
          ▼               ▼               ▼
     ┌──────────┐    ┌──────────┐    ┌──────────┐
     │ Backoff  │    │ Add error│    │ Pause    │
     │ & Retry  │    │ to context    │ execution│
     └──────────┘    │ continue │    │ notify   │
                     └──────────┘    │ user     │
                                     └──────────┘
```

### 9.4 Stuck Detection

```typescript
interface StuckDetector {
  recordAttempt(criterionId: string, success: boolean): void
  isStuck(criterionId: string): boolean
  getStuckReason(criterionId: string): string
}

const STUCK_THRESHOLDS = {
  sameErrorCount: 3,      // Same error 3 times in a row
  noProgressTurns: 5,     // 5 turns with no criterion progress
  toolFailureStreak: 3,   // 3 consecutive tool failures
}
```

When stuck:
1. Pause execution
2. Notify user via WebSocket
3. Present options: retry, intervene, or abort

---

## 10. LSP Integration

### 10.1 Language Detection

```typescript
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  // ... more
}

const LSP_SERVERS: Record<string, LspServerConfig> = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    rootPatterns: ['tsconfig.json', 'package.json']
  },
  python: {
    command: 'pyright-langserver',
    args: ['--stdio'],
    rootPatterns: ['pyproject.toml', 'setup.py', 'requirements.txt']
  },
  // ... more
}
```

### 10.2 LSP Bridge

```typescript
interface LspBridge {
  // Lifecycle
  start(workdir: string): Promise<void>
  stop(): Promise<void>
  
  // Events
  onDiagnostics(callback: (diagnostics: Diagnostic[]) => void): Unsubscribe
  
  // Queries
  getDiagnostics(path: string): Diagnostic[]
  getAllDiagnostics(): Map<string, Diagnostic[]>
}

interface Diagnostic {
  path: string
  range: {
    start: { line: number, character: number }
    end: { line: number, character: number }
  }
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  source: string  // e.g., 'typescript', 'eslint'
  code?: string | number
}
```

### 10.3 Diagnostic Flow

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  Tool   │────▶│  File   │────▶│   LSP   │────▶│ Collect │
│ writes  │     │ changed │     │ notified│     │ diags   │
└─────────┘     └─────────┘     └─────────┘     └────┬────┘
                                                     │
                                                     ▼
                                              ┌─────────────┐
                                              │  Broadcast  │
                                              │  to clients │
                                              └─────────────┘
```

### 10.4 Validation Phase LSP Check

Before validation, check for critical LSP errors:

```typescript
async function preValidationCheck(
  lspBridge: LspBridge,
  modifiedFiles: Set<string>
): Promise<{ canProceed: boolean, blockers: Diagnostic[] }> {
  const allDiags = lspBridge.getAllDiagnostics()
  const blockers: Diagnostic[] = []
  
  for (const file of modifiedFiles) {
    const diags = allDiags.get(file) ?? []
    const errors = diags.filter(d => d.severity === 'error')
    blockers.push(...errors)
  }
  
  return {
    canProceed: blockers.length === 0,
    blockers
  }
}
```

---

## 11. Metrics & Observability

### 11.1 vLLM Metrics Collection

vLLM exposes Prometheus metrics at `/metrics`:

```typescript
interface VllmMetrics {
  // Request metrics
  numRequestsRunning: number
  numRequestsWaiting: number
  
  // Latency metrics
  timeToFirstTokenSeconds: number      // Prefill latency
  timePerOutputTokenSeconds: number    // TG latency
  e2eRequestLatencySeconds: number
  
  // Throughput
  promptTokensTotal: number
  generationTokensTotal: number
  
  // Cache
  gpuCacheUsagePercent: number
  cpuCacheUsagePercent: number
  
  // Errors
  numPreemptionsTotal: number
  numRequestsFinishedTotal: number
}

async function fetchVllmMetrics(baseUrl: string): Promise<VllmMetrics> {
  const response = await fetch(`${baseUrl}/metrics`)
  const text = await response.text()
  return parsePrometheusMetrics(text)
}
```

### 11.2 Derived Metrics

```typescript
interface DerivedMetrics {
  prefillSpeed: number        // tokens/second (prompt_tokens / TTFT)
  generationSpeed: number     // tokens/second (1 / time_per_output_token)
  contextUsage: {
    current: number
    max: number
    percent: number
  }
  cacheHealth: 'good' | 'pressure' | 'critical'
}

function deriveMetrics(
  raw: VllmMetrics,
  sessionContext: { currentTokens: number, maxTokens: number }
): DerivedMetrics {
  return {
    prefillSpeed: /* calculate from raw */,
    generationSpeed: 1 / raw.timePerOutputTokenSeconds,
    contextUsage: {
      current: sessionContext.currentTokens,
      max: sessionContext.maxTokens,
      percent: (sessionContext.currentTokens / sessionContext.maxTokens) * 100
    },
    cacheHealth: raw.gpuCacheUsagePercent > 95 ? 'critical' 
               : raw.gpuCacheUsagePercent > 80 ? 'pressure' 
               : 'good'
  }
}
```

### 11.3 Metrics Streaming

Push metrics to frontend every 2 seconds:

```typescript
const METRICS_INTERVAL_MS = 2000

function startMetricsStream(
  vllmUrl: string,
  broadcast: (event: ServerMessage) => void
): () => void {
  const interval = setInterval(async () => {
    try {
      const metrics = await fetchVllmMetrics(vllmUrl)
      broadcast({
        type: 'metrics.update',
        payload: metrics
      })
    } catch (error) {
      // Log but don't crash
    }
  }, METRICS_INTERVAL_MS)
  
  return () => clearInterval(interval)
}
```

### 11.4 Session Metrics

Track per-session statistics:

```typescript
interface SessionMetrics {
  // Token usage
  totalPromptTokens: number
  totalCompletionTokens: number
  
  // Tool usage
  toolCallsByType: Record<string, number>
  toolSuccessRate: number
  
  // Timing
  totalDurationMs: number
  timeInPhase: Record<SessionPhase, number>
  
  // Iterations
  executionIterations: number
  validationAttempts: number
  compactionCount: number
}
```

---

## 12. UI/UX Design

### 12.1 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  OpenFox                                          Session: my-feature   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────┐ ┌───────────────────────────┐ ┌─────────────┐ │
│  │                     │ │                           │ │  Metrics    │ │
│  │    Plan / Chat      │ │      Execution View       │ │             │ │
│  │                     │ │                           │ │ Prefill     │ │
│  │  [User message]     │ │  ▶ Reading src/index.ts   │ │ 2.3s        │ │
│  │                     │ │    ┌──────────────────┐   │ │ 850 t/s     │ │
│  │  [Assistant reply]  │ │    │ File contents... │   │ │             │ │
│  │                     │ │    └──────────────────┘   │ │ Generation  │ │
│  │  ─────────────────  │ │                           │ │ 45 t/s      │ │
│  │                     │ │  ▶ Editing src/utils.ts   │ │             │ │
│  │  Acceptance Criteria│ │    - old_string: "foo"    │ │ Context     │ │
│  │  ☑ Add login page   │ │    + new_string: "bar"    │ │ ████░░ 67%  │ │
│  │  ☐ Add validation   │ │                           │ │             │ │
│  │  ☐ Write tests      │ │  ▶ Running npm test       │ │ ─────────── │ │
│  │                     │ │    ✓ 12 tests passed      │ │             │ │
│  │  [Accept Criteria]  │ │                           │ │ Diagnostics │ │
│  │                     │ │                           │ │ ⚠ 2 warnings│ │
│  ├─────────────────────┤ │                           │ │ ✗ 0 errors  │ │
│  │ > Type a message... │ │                           │ │             │ │
│  └─────────────────────┘ └───────────────────────────┘ └─────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 12.2 Panel Behavior by Phase

| Phase | Left Panel | Center Panel | Right Panel |
|-------|------------|--------------|-------------|
| Planning | Chat + Criteria Editor | Preview / Empty | Metrics |
| Executing | Criteria Progress | Agent Stream | Metrics + Diagnostics |
| Validating | Criteria Results | Validation Details | Metrics |
| Completed | Summary | Final State | Session Stats |

### 12.3 Component Specifications

#### ChatMessage
```typescript
interface ChatMessageProps {
  message: Message
  isStreaming?: boolean
}

// Display variants:
// - User: Right-aligned, blue background
// - Assistant: Left-aligned, gray background
// - Tool: Collapsible, shows tool name + truncated result
// - System: Centered, subtle styling
```

#### CriteriaEditor
```typescript
interface CriteriaEditorProps {
  criteria: Criterion[]
  editable: boolean
  onUpdate: (criteria: Criterion[]) => void
  onAccept: () => void
}

// Features:
// - Drag to reorder
// - Inline edit description
// - Toggle verification type
// - Add/remove criteria
// - Accept button (disabled if empty)
```

#### AgentStream
```typescript
interface AgentStreamProps {
  events: AgentEvent[]
  isRunning: boolean
}

// Features:
// - Auto-scroll to bottom
// - Collapsible tool calls
// - Syntax highlighting for code
// - Error highlighting
// - Thinking blocks in muted style
```

#### MetricsPanel
```typescript
interface MetricsPanelProps {
  metrics: DerivedMetrics
  diagnostics: Diagnostic[]
}

// Features:
// - Real-time updating gauges
// - Context usage bar with threshold markers
// - Diagnostic list grouped by severity
// - Click diagnostic to show in context
```

### 12.4 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Send message / Accept criteria |
| `Ctrl+P` | Pause agent |
| `Ctrl+R` | Resume agent |
| `Ctrl+.` | Open command palette |
| `Escape` | Cancel current action |

### 12.5 Dark Theme (Default)

```css
:root {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --bg-tertiary: #21262d;
  
  --text-primary: #c9d1d9;
  --text-secondary: #8b949e;
  --text-muted: #484f58;
  
  --accent-primary: #58a6ff;
  --accent-success: #3fb950;
  --accent-warning: #d29922;
  --accent-error: #f85149;
  
  --border: #30363d;
}
```

---

## 13. Configuration

### 13.1 Environment Variables

```bash
# Required
OPENFOX_VLLM_URL=http://localhost:8000/v1
OPENFOX_WORKDIR=/path/to/default/workspace

# Optional
OPENFOX_PORT=3000
OPENFOX_HOST=0.0.0.0
OPENFOX_DB_PATH=./openfox.db
OPENFOX_LOG_LEVEL=info
OPENFOX_MODEL_NAME=qwen3.5-122b-int4-autoround
OPENFOX_MAX_CONTEXT=200000
```

### 13.2 Configuration File

`openfox.config.ts`:

```typescript
import { defineConfig } from 'openfox'

export default defineConfig({
  // vLLM connection
  vllm: {
    baseUrl: process.env.OPENFOX_VLLM_URL,
    model: 'qwen3.5-122b-int4-autoround',
    timeout: 300_000,  // 5 minutes
  },
  
  // Context management
  context: {
    maxTokens: 200_000,
    compactionThreshold: 0.85,
    compactionTarget: 0.60,
  },
  
  // Agent behavior
  agent: {
    maxIterations: 10,
    maxConsecutiveFailures: 3,
    toolTimeout: 120_000,
  },
  
  // LSP
  lsp: {
    enabled: true,
    servers: {
      typescript: {
        command: 'typescript-language-server',
        args: ['--stdio'],
      },
      // Custom servers...
    },
  },
  
  // UI
  ui: {
    theme: 'dark',
    metricsRefreshMs: 2000,
  },
  
  // Persistence
  database: {
    path: './openfox.db',
    sessionRetentionDays: 30,
  },
})
```

### 13.3 Per-Session Configuration

Sessions can override global config:

```typescript
interface SessionConfig {
  // Override model
  model?: string
  
  // Override context
  maxTokens?: number
  
  // Custom tools
  additionalTools?: ToolDefinition[]
  disabledTools?: string[]
  
  // Custom prompts
  systemPromptAdditions?: string
}
```

---

## 14. Security Considerations

### 14.1 File System Access

- **Sandboxing**: Tools operate within session workdir by default
- **Path validation**: Reject paths that escape workdir (unless absolute and allowed)
- **Sensitive files**: Warn on access to `.env`, credentials, keys

```typescript
const SENSITIVE_PATTERNS = [
  /\.env/,
  /credentials/i,
  /secret/i,
  /\.pem$/,
  /\.key$/,
  /password/i,
]

function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATTERNS.some(p => p.test(path))
}
```

### 14.2 Command Execution

- **No shell expansion**: Use `execFile` not `exec` where possible
- **Timeout enforcement**: All commands have hard timeout
- **Output limits**: Prevent memory exhaustion from large outputs
- **Dangerous commands**: Warn on `rm -rf`, `sudo`, etc.

```typescript
const DANGEROUS_COMMANDS = [
  /rm\s+(-rf?|--recursive)/,
  /sudo/,
  /chmod\s+777/,
  />\s*\/dev\/sd/,
  /mkfs/,
  /dd\s+if=/,
]

function isDangerousCommand(cmd: string): boolean {
  return DANGEROUS_COMMANDS.some(p => p.test(cmd))
}
```

### 14.3 Network Access

- **No arbitrary network access**: Tools don't make network requests
- **vLLM only**: Only connection is to configured vLLM endpoint
- **No secrets in prompts**: Strip environment variables from error messages

### 14.4 WebSocket Security

- **Origin validation**: Check Origin header
- **Rate limiting**: Prevent DoS
- **Message size limits**: Reject oversized messages

---

## 15. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

**Goal**: Basic server + client communication with a single tool

| Task | Priority | Estimate |
|------|----------|----------|
| Initialize monorepo structure | High | 2h |
| Set up TypeScript configs | High | 1h |
| Implement WebSocket server (Hono) | High | 4h |
| Implement WebSocket client hook | High | 3h |
| Create basic React shell with Tailwind | High | 3h |
| Implement SQLite persistence layer | High | 4h |
| Create session state machine | High | 4h |
| Implement `read_file` tool | High | 2h |
| End-to-end test: create session, send message | High | 2h |

**Milestone**: Can create a session and exchange messages over WebSocket.

### Phase 2: Planning Phase (Week 2-3)

**Goal**: Full planning phase with criteria extraction

| Task | Priority | Estimate |
|------|----------|----------|
| Implement vLLM client with streaming | High | 4h |
| Create planner module with chat loop | High | 4h |
| Implement criteria extraction prompt | High | 3h |
| Build ChatMessage component | High | 3h |
| Build CriteriaEditor component | High | 4h |
| Build PlanPanel with accept flow | High | 4h |
| Add criteria persistence | Medium | 2h |
| Add session list/load UI | Medium | 3h |

**Milestone**: Can chat with LLM, see extracted criteria, accept and transition to executing.

### Phase 3: Execution Phase (Week 3-4)

**Goal**: Agent can execute tools and track criteria

| Task | Priority | Estimate |
|------|----------|----------|
| Implement agent runner loop | High | 6h |
| Implement all tools (write, edit, shell, glob, grep) | High | 8h |
| Implement tool error handling + retry | High | 4h |
| Build AgentStream component | High | 4h |
| Build ToolCall component | High | 3h |
| Implement stuck detection | Medium | 3h |
| Add pause/resume functionality | Medium | 2h |
| Add `ask_user` tool | Medium | 3h |

**Milestone**: Agent can modify files, run commands, and report progress.

### Phase 4: Context Management (Week 4-5)

**Goal**: Handle long sessions without context overflow

| Task | Priority | Estimate |
|------|----------|----------|
| Implement token counting | High | 3h |
| Implement context manager | High | 4h |
| Implement compaction prompt + flow | High | 4h |
| Build ContextUsage component | Medium | 2h |
| Add compaction notification to UI | Medium | 2h |
| Test with long sessions | High | 4h |

**Milestone**: Sessions can run indefinitely with automatic compaction.

### Phase 5: Validation Phase (Week 5-6)

**Goal**: Independent validation of completed work

| Task | Priority | Estimate |
|------|----------|----------|
| Implement validator module | High | 4h |
| Create validation prompt | High | 3h |
| Implement auto-verification (command-based) | High | 4h |
| Add validation results UI | High | 3h |
| Implement retry flow (validation → execution) | High | 3h |
| Add human verification flow | Medium | 3h |

**Milestone**: Work is independently verified before marking complete.

### Phase 6: LSP Integration (Week 6-7)

**Goal**: Real-time code validation

| Task | Priority | Estimate |
|------|----------|----------|
| Implement LSP bridge | High | 6h |
| Implement language detection | Medium | 2h |
| Add TypeScript LSP support | High | 3h |
| Build DiagnosticsView component | High | 3h |
| Integrate diagnostics with validation | Medium | 3h |
| Add Python LSP support | Low | 2h |

**Milestone**: LSP errors shown in UI, block validation if errors exist.

### Phase 7: Metrics & Polish (Week 7-8)

**Goal**: Full observability and production readiness

| Task | Priority | Estimate |
|------|----------|----------|
| Implement vLLM metrics collector | High | 4h |
| Build MetricsPanel with gauges | High | 4h |
| Add session metrics tracking | Medium | 3h |
| Implement keyboard shortcuts | Medium | 3h |
| Add error boundaries | Medium | 2h |
| Performance optimization | Medium | 4h |
| Documentation | Medium | 4h |
| End-to-end testing | High | 6h |

**Milestone**: Production-ready with full observability.

---

## 16. Future Considerations

### 16.1 Potential Enhancements

| Feature | Description | Complexity |
|---------|-------------|------------|
| **CLI Client** | Terminal UI using Ink or blessed | Medium |
| **Multi-model** | Support multiple LLMs, route by task | High |
| **Git Integration** | Auto-commit, branch management | Medium |
| **Collaborative** | Multiple users on same session | High |
| **Plugins** | Custom tools via plugin system | Medium |
| **Voice Input** | Speech-to-text for planning | Medium |
| **Code Search** | Vector embeddings for semantic search | High |
| **Replay** | Replay sessions for debugging | Low |

### 16.2 Scaling Considerations

- **Multiple Sessions**: Current design supports multiple concurrent sessions
- **Clustering**: Stateless server design allows horizontal scaling
- **Database**: SQLite works for single-node; PostgreSQL for distributed

### 16.3 Model-Specific Optimizations

- **Qwen 3**: Use `--reasoning-parser qwen3` for thinking extraction
- **Tool calling**: Leverage native tool calling when available
- **Prefix caching**: Structure prompts to maximize cache hits

---

## Appendix A: Message Protocol Reference

### Client Messages

```typescript
// Create a new session
{ type: 'session.create', payload: { workdir: string } }

// Load existing session
{ type: 'session.load', payload: { sessionId: string } }

// Send chat message in planning phase
{ type: 'plan.message', payload: { content: string } }

// Accept criteria and transition to executing
{ type: 'plan.accept', payload: {} }

// Edit criteria list
{ type: 'plan.edit_criteria', payload: { criteria: Criterion[] } }

// Start agent execution
{ type: 'agent.start', payload: {} }

// Pause agent
{ type: 'agent.pause', payload: {} }

// Resume agent
{ type: 'agent.resume', payload: {} }

// Respond to ask_user tool
{ type: 'agent.intervene', payload: { response: string } }

// Manually verify a criterion
{ type: 'criterion.human_verify', payload: { criterionId: string, passed: boolean } }
```

### Server Messages

```typescript
// Full session state update
{ type: 'session.state', payload: Session }

// Streaming text from LLM
{ type: 'plan.delta', payload: { content: string } }

// Updated criteria list
{ type: 'plan.criteria', payload: { criteria: Criterion[] } }

// Agent execution event
{ type: 'agent.event', payload: AgentEvent }

// Validation results
{ type: 'validation.result', payload: ValidationResult }

// vLLM metrics update
{ type: 'metrics.update', payload: VllmMetrics }

// LSP diagnostics update
{ type: 'lsp.diagnostics', payload: { path: string, diagnostics: Diagnostic[] } }

// Error
{ type: 'error', payload: { code: string, message: string } }
```

---

## Appendix B: Tool JSON Schemas

```json
{
  "read_file": {
    "type": "object",
    "properties": {
      "path": { "type": "string" },
      "offset": { "type": "integer", "minimum": 1 },
      "limit": { "type": "integer", "minimum": 1, "maximum": 5000 }
    },
    "required": ["path"]
  },
  
  "write_file": {
    "type": "object",
    "properties": {
      "path": { "type": "string" },
      "content": { "type": "string" }
    },
    "required": ["path", "content"]
  },
  
  "edit_file": {
    "type": "object",
    "properties": {
      "path": { "type": "string" },
      "old_string": { "type": "string" },
      "new_string": { "type": "string" },
      "replace_all": { "type": "boolean" }
    },
    "required": ["path", "old_string", "new_string"]
  },
  
  "run_command": {
    "type": "object",
    "properties": {
      "command": { "type": "string" },
      "cwd": { "type": "string" },
      "timeout": { "type": "integer", "minimum": 1000, "maximum": 600000 }
    },
    "required": ["command"]
  },
  
  "glob": {
    "type": "object",
    "properties": {
      "pattern": { "type": "string" },
      "cwd": { "type": "string" }
    },
    "required": ["pattern"]
  },
  
  "grep": {
    "type": "object",
    "properties": {
      "pattern": { "type": "string" },
      "include": { "type": "string" },
      "cwd": { "type": "string" }
    },
    "required": ["pattern"]
  },
  
  "ask_user": {
    "type": "object",
    "properties": {
      "question": { "type": "string" }
    },
    "required": ["question"]
  }
}
```

---

## Appendix C: System Prompts

### Planning System Prompt

```
You are an expert software architect helping to plan a coding task.

Your role in this phase:
1. Understand the user's requirements through conversation
2. Ask clarifying questions when needed
3. Extract specific, verifiable acceptance criteria

After each exchange, output a JSON block with extracted criteria:

```json
{
  "criteria": [
    {
      "id": "criterion-1",
      "description": "Clear, specific requirement",
      "verification": "auto|model|human",
      "command": "optional command for auto verification"
    }
  ],
  "questions": ["Any clarifying questions"]
}
```

Guidelines for good criteria:
- Each criterion should be independently verifiable
- Prefer "auto" verification with shell commands when possible
- Use "model" for subjective quality checks
- Use "human" only when user confirmation is truly needed
- Be specific: "Function handles empty input" not "Function works correctly"
```

### Agent System Prompt

```
You are an expert software engineer executing a coding task.

## ACCEPTANCE CRITERIA (YOUR CONTRACT)
{criteria_formatted}

## RULES
1. Work systematically through the criteria
2. Read files before modifying them
3. Make minimal, focused changes
4. Test your changes when possible
5. If a tool fails, analyze the error and adjust your approach
6. Report which criteria you believe are satisfied after each action

## AVAILABLE TOOLS
{tools_formatted}

## CURRENT STATUS
Modified files: {modified_files}
Criteria status: {criteria_status}
LSP diagnostics: {diagnostics_summary}

Work until all criteria are satisfied, then report completion.
```

### Validation System Prompt

```
You are a code reviewer performing independent verification.

Your task: Determine if the code satisfies each acceptance criterion.

## ACCEPTANCE CRITERIA
{criteria_formatted}

## MODIFIED FILES
{files_content}

## TEST OUTPUT
{test_output}

## LSP DIAGNOSTICS
{diagnostics}

For each criterion, carefully analyze the code and determine:
1. Does the implementation satisfy the requirement?
2. Are there any edge cases not handled?
3. Are there any bugs or issues?

Be strict. Only mark PASS if the criterion is fully satisfied.

Output JSON:
{
  "results": [
    {
      "criterionId": "...",
      "status": "pass|fail",
      "reasoning": "Detailed explanation",
      "issues": ["List of specific issues if fail"]
    }
  ]
}
```

---

*End of Specification*
