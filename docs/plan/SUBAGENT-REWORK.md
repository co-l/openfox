# Plan: Sub-Agent Rework

## Context

The sub-agent system was built as a quick static implementation for the verifier use case. It has hardcoded system prompts, hardcoded context builders, and hardcoded tool selections — all in code (`src/server/sub-agents/registry.ts`). This makes it impossible to define new sub-agent types or customize existing ones from the workflow editor.

The workflow/pipeline system needs sub-agents to be data-driven: each sub-agent step in a pipeline should fully define its own behavior through configuration, not code.

## Current Architecture (Problems)

### 1. System prompts are separate from the primary prompt
- `buildVerifierPrompt()` in `src/server/chat/prompts.ts` is a standalone prompt, completely different from the builder's `buildPrimaryPrompt()`.
- Every sub-agent type has its own bespoke system prompt hardcoded in `registry.ts`.
- **Should be**: Sub-agent prompts append to the PrimaryPrompt (same base capabilities), with a role/task-specific section added on top.

### 2. Context builders are code functions
- `createVerifierContext()` in `registry.ts` is a TypeScript function that assembles context from session state (summary, criteria, modified files).
- Each sub-agent type has its own context builder function.
- **Should be**: Context is assembled from composable, declarative "context blocks" that can be selected per step in the workflow config.

### 3. Tool selection is hardcoded per sub-agent type
- `verifierDefinition.tools = ['read_file', 'run_command', 'pass_criterion', 'fail_criterion', 'web_fetch']`
- `getToolRegistryForMode('verifier')` in `src/server/tools/index.ts` returns a static tool set.
- **Should be**: Each workflow step declares which tools it needs. The tool registry builds dynamically from that list.

### 4. Result extraction is bespoke
- The verifier has special `pass_criterion`/`fail_criterion` tools and nudge logic to force calling `return_value`.
- **Should be**: Result extraction is part of the context/tool configuration — the step declares what tools produce its "output" and how to interpret completion.

## Target Architecture

### Sub-agent definitions become data, not code

A sub-agent step in a pipeline should carry:
```
{
  "type": "sub_agent",
  "name": "Verifier",
  "prompt": "Verify each criterion marked [NEEDS VERIFICATION]...",
  "contextBlocks": ["task_summary", "criteria", "modified_files"],
  "tools": ["read_file", "run_command", "pass_criterion", "fail_criterion"],
  "options": {
    "freshContext": true,
    "disableThinking": true
  }
}
```

### System prompt = PrimaryPrompt + step role section
- All agents (builder, verifier, custom) share the same `buildPrimaryPrompt()` base.
- Each step appends its own `prompt` field as a role-specific section.
- This means sub-agents get the same core capabilities (workdir awareness, tool usage patterns, etc.) with a specialized task on top.

### Context blocks are composable
Instead of code functions, context is built from named blocks:
- `task_summary` — session summary
- `criteria` — criteria list with status markers
- `modified_files` — list of files the builder touched
- `git_diff` — diff of current changes
- `instructions` — project instructions/AGENTS.md
- `custom` — arbitrary text from the step config

Each block is a simple function: `(session) => string`. The step config lists which blocks to include. The executor assembles them into the context message.

### Tool selection is dynamic
The step declares tool names as strings. The executor filters the full tool registry to only include those tools. No more `getToolRegistryForMode()` with hardcoded modes — just `getToolsForNames(['read_file', 'run_command', ...])`.

## Implementation Steps

### Phase 1: Unify system prompts
- Make `buildVerifierPrompt()` use `buildPrimaryPrompt()` as base, append verifier-specific instructions.
- Update all sub-agent definitions to use `buildPrimaryPrompt() + role section` pattern.
- **Files**: `src/server/chat/prompts.ts`, `src/server/sub-agents/registry.ts`

### Phase 2: Implement context blocks
- Create `src/server/pipelines/context-blocks.ts` with named block functions.
- Each block: `(session: Session) => string`
- Registry of available blocks with IDs and descriptions (for the UI dropdown).
- **Files**: New `src/server/pipelines/context-blocks.ts`

### Phase 3: Dynamic tool selection
- Add `getToolsForNames(names: string[])` to `src/server/tools/index.ts`.
- Pipeline executor uses this instead of `getToolRegistryForMode()`.
- Expose available tool names via API for the pipeline editor UI.
- **Files**: `src/server/tools/index.ts`, `src/server/pipelines/executor.ts`

### Phase 4: Refactor sub-agent manager
- `executeSubAgent()` stops looking up definitions from the code registry.
- Instead, it receives prompt, context blocks, tools, and options from the pipeline step config.
- The hardcoded `SubAgentRegistry` becomes a set of **default templates** (for backwards compat and as starting points), not the source of truth.
- **Files**: `src/server/sub-agents/manager.ts`, `src/server/sub-agents/registry.ts`, `src/server/sub-agents/types.ts`

### Phase 5: Update pipeline types and executor
- `SubAgentStep` type gains `contextBlocks`, `tools`, and `options` fields.
- Executor assembles context from blocks, builds tool registry from names, passes to sub-agent manager.
- **Files**: `src/server/pipelines/types.ts`, `src/server/pipelines/executor.ts`

### Phase 6: Update default pipeline
- Default pipeline's verifier step now carries its full config inline.
- **Files**: `src/server/pipelines/defaults/default.pipeline.json`

## Key Files

| File | Role |
|------|------|
| `src/server/sub-agents/registry.ts` | Current hardcoded definitions — refactor to templates |
| `src/server/sub-agents/manager.ts` | Execution engine — decouple from registry |
| `src/server/sub-agents/types.ts` | Type definitions — simplify |
| `src/server/chat/prompts.ts` | System prompts — unify around PrimaryPrompt |
| `src/server/tools/index.ts` | Tool registry — add dynamic selection |
| `src/server/pipelines/types.ts` | Pipeline step types — enrich SubAgentStep |
| `src/server/pipelines/executor.ts` | Pipeline executor — wire up new context/tool assembly |
| `src/server/chat/orchestrator.ts` | `runVerifierTurn()` — update to use pipeline config |

## Verification

1. Default pipeline with verifier step produces identical behavior to current hardcoded verifier.
2. Existing orchestrator + decision tests pass.
3. A custom sub-agent step (e.g., code_reviewer) can be defined entirely in pipeline JSON.
4. Sub-agent gets PrimaryPrompt base + role section (not a separate prompt).
5. Context blocks are composable — adding/removing blocks changes what the sub-agent sees.
6. Tool list in pipeline step config correctly constrains available tools.
