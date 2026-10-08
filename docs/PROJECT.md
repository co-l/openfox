# OpenFox — Detailed Description

## 1. Overview and Functional Goals

OpenFox is a "Local-LLM-first" agentic coding assistant (v2.0.160). It is an autonomous agent designed to work with local LLM backends (vLLM, sglang, ollama, llamacpp) via an OpenAI-compatible API.

Key features:

- Multi-turn workflows with planning and execution
- Contractual execution (acceptance criteria)
- Multi-step declarative workflows
- Iterative verification
- LSP (Language Server Protocol) integration
- Plugin support
- React Web UI + CLI
- Internationalization EN/FR

## 2. Internal Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        OpenFox                              │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ CLI      │  │ Server   │  │ Web UI   │  │ Plugins  │     │
│  │ (src/cli)│  │ (Express │  │ (React   │  │ (src/    │     │
│  │          │  │  + WS)   │  │  + Vite) │  │  plugin) │     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    Server (src/server/)              │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │   │
│  │  │ agents │ │ chat   │ │ config │ │ context│         │   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘         │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │   │
│  │  │ db     │ │ git    │ │ llm    │ │ lsp    │         │   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘         │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │   │
│  │  │ mcp    │ │ routes │ │ runner │ │ session│         │   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘         │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │   │
│  │  │ skills │ │ tasks  │ │terminal│ │tools   │         │   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘         │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐                   │   │
│  │  │workflows│ │ events │ │ queue  │                   │   │
│  │  └────────┘ └────────┘ └────────┘                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    Shared (src/shared/)              │   │
│  │  Shared code between client and server               │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 3. Main Flows

### Flow 1: User sends a message

```
1. web/src/App.tsx → Chat component
2. openfox/src/server/routes/ → POST /api/chat route
3. openfox/src/server/llm/ → provider-manager selects provider
4. openfox/src/server/providers/ → LLM provider
5. Response → WebSocket → web/src/stores/ → UI
```

### Flow 2: Agent executes a task

```
1. openfox/src/server/runner/ → agent loop
2. openfox/src/server/tools/ → tool execution
3. openfox/src/server/llm/ → LLM call
4. openfox/src/server/session/ → session update
5. openfox/src/server/events/ → events → WebSocket → UI
```

### Flow 3: Declarative workflow

```
1. openfox/src/server/workflows/ → workflow engine
2. openfox/src/server/agents/ → sub-agents
3. openfox/src/server/tasks/ → tasks
4. openfox/src/server/runner/ → execution
```

### Flow 4: LLM Plugin

```
1. openfox/src/server/llm/ → provider-manager
2. provider-manager → plugin (e.g. openfox-cheaperinference)
3. plugin → HTTP transport → provider API
4. Response → provider-manager → runner → UI
```

## 4. Data Model and Public API

### Main Entities (SQLite)

- **Session**: working session with an agent
- **Message**: message within a session
- **Project**: project opened in OpenFox
- **Task**: task on the task board
- **Event**: event (event sourcing)

### HTTP API (routes)

- `POST /api/chat` — send a message
- `GET /api/sessions` — list sessions
- `GET /api/projects` — list projects
- `GET /api/tasks` — list tasks
- `GET /api/mcp/servers` — list MCP servers
- `GET /api/board` — get task board

### WebSocket API

- Agent message streaming
- Tool calls and results streaming
- Real-time session updates

## 5. Modules: Role, Key Files, Dependencies

| Module    | Role                        | Key Files                                        |
| --------- | --------------------------- | ------------------------------------------------ |
| CLI       | Command line interface      | `src/cli/index.ts`, `src/cli/main.ts`            |
| Server    | Express + WebSocket backend | `src/server/index.ts`, `src/server/routes/`      |
| Web UI    | React frontend              | `web/src/App.tsx`, `web/src/components/`         |
| Plugins   | Plugin system               | `src/plugin/index.ts`                            |
| Providers | LLM providers               | `src/provider/index.ts`, `src/server/providers/` |
| Agents    | Sub-agents                  | `src/server/agents/`, `src/server/sub-agents/`   |
| Workflows | Workflow engine             | `src/server/workflows/`                          |
| Tasks     | Task management             | `src/server/tasks/`                              |
| Terminal  | Terminal (node-pty + xterm) | `src/server/terminal/`                           |
| Tools     | Agent tools                 | `src/server/tools/`                              |
| MCP       | Model Context Protocol      | `src/server/mcp/`                                |
| LSP       | Language Server Protocol    | `src/server/lsp/`                                |
| DB        | SQLite database             | `src/server/db/`                                 |
| Git       | Git integration             | `src/server/git/`                                |
| Skills    | Skills system               | `src/server/skills/`                             |
| Events    | Event system                | `src/server/events/`                             |
| Queue     | Task queue                  | `src/server/queue/`                              |
| Session   | Session management          | `src/server/session/`                            |
| Context   | Context management          | `src/server/context/`                            |
| Config    | Configuration               | `src/server/config.ts`                           |
| Auth      | Authentication              | `src/server/auth.ts`                             |
| I18n      | Internationalization        | `src/server/i18n.ts`                             |

## 6. Environment Variables

| Variable             | Role             | Default Value                        |
| -------------------- | ---------------- | ------------------------------------ |
| `OPENFOX_DEV`        | Development mode | `false`                              |
| `OPENFOX_PORT`       | Server port      | `10369` (prod), `10370+` (dev)       |
| `OPENFOX_PASSWORD`   | Password         | `password`                           |
| `OPENFOX_CONFIG_DIR` | Config directory | `~/.config/openfox/`                 |
| `OPENFOX_DB_PATH`    | DB path          | `~/.local/share/openfox/sessions.db` |

## 7. Tests and Deployment

### Tests

- **Unit**: Vitest (`npx vitest run`)
- **E2E**: Playwright (`cd e2e-playwright && npx playwright test`)
- **Web**: Testing Library + happy-dom/jsdom

### Deployment

- **Build**: `npm run build` (tsup for server, Vite for web)
- **Production**: `npm start` (port 10369)
- **Development**: `npm run dev` (port 10370+)
