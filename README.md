# OpenFox

**Local-LLM-first agentic coding assistant**

Autonomous coding agent for local LLMs with contract-driven execution.

_Session — Criteria tracking, tool calls, and streaming responses_
![Session](docs/screenshots/session.png)

_Providers — Local LLM backend configuration_
![Providers](docs/screenshots/providers.png)

_Workflows — Contract-driven execution pipeline_
![Workflows](docs/screenshots/workflows.png)

## Quick Start

```bash
npm i -g openfox
openfox
```

On first run, OpenFox automatically detects your local LLM backend (vLLM, sglang, ollama, llamacpp) and configures itself.

## CLI Commands

```bash
# Start server for current project
openfox

# Start on custom port
openfox --port 8080

# Start without opening browser
openfox --no-browser

# Show current configuration
openfox config

# Manage LLM providers
openfox provider add      # Add new provider
openfox provider list     # List configured providers
openfox provider use      # Switch active provider
openfox provider remove   # Remove provider
```

## CLI Options

| Option                | Description                 | Default       |
| --------------------- | --------------------------- | ------------- |
| `-p, --port <number>` | Specify server port         | 10369         |
| `--no-browser`        | Don't open browser on start | Opens browser |
| `-h, --help`          | Show help message           | -             |
| `-v, --version`       | Show version number         | -             |

## Requirements

- Node.js >= 24.0.0
- Local LLM backend with OpenAI-compatible API:
  - vLLM
  - sglang
  - ollama
  - llamacpp

## Features

- **Plan → Builder Workflow**: Interactive task breakdown followed by autonomous implementation
- **Contract-Driven Execution**: Acceptance criteria serve as immutable contract
- **Iterative Verification**: Agent loops until all criteria pass
- **LSP Integration**: Immediate feedback on code validity
- **Real-Time Metrics**: Prefill time, generation speed, context usage

## Screenshots

_Homepage — Project overview and session history_
![Homepage](docs/screenshots/homepage.png)

_Project Selected — Active session with context stats_
![Project Selected](docs/screenshots/project-selected.png)

_Stats — Prefill time, generation speed, token usage_
![Stats](docs/screenshots/stats.png)

_Terminal — Integrated terminal for running commands_
![Terminal](docs/screenshots/terminal.png)

_Notifications — Event log and system messages_
![Notifications](docs/screenshots/notifications.png)

_Agents — Sub-agent management and execution_
![Agents](docs/screenshots/agents.png)

_General Instructions — Global custom instructions_
![General Instructions](docs/screenshots/general-instructions.png)

_Vision Fallback — Image processing configuration_
![Vision Fallback](docs/screenshots/vision-fallback.png)

## License

MIT
