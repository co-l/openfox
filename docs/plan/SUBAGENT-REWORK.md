# Plan: Agent System Rework

## Context

The sub-agent system was built as a quick static implementation for the verifier use case. It has hardcoded system prompts, hardcoded context builders, and hardcoded tool selections — all in code (`src/server/sub-agents/registry.ts`). This makes it impossible to define new agent types or customize existing ones.

The goal is to unify all agent types (planner, builder, verifier, code_reviewer, etc.) into a single data-driven format — `.agent.md` files — following the same pattern as commands (`.command.md`) and skills (`.skill.md`).

## Current state: duplicated execution logic

The orchestrator has three nearly-identical execution paths that should be one:

### `runPlannerTurn` vs `runBuilderTurn` — ~95% copy-paste

Both implement the same loop: load instructions → assemble request → stream LLM → consume generator → execute tools → handle abort/errors → check criteria → inject ASAP messages → recurse.

Differences (all parameterizable):
- Tool registry: `getToolRegistryForMode('planner')` vs `('builder')`
- Request assembly: `assemblePlannerRequest()` vs `assembleBuilderRequest()` (both call the same `buildPrimaryPrompt()`)
- Builder injects a kickoff prompt
- Builder tracks modified files via `addModifiedFile()`
- Stats label: `'planner'` vs `'builder'`

### `executeSubAgent` (manager.ts) — reimplements the tool execution loop

Duplicates: streaming, generator consumption, tool execution with error handling, abort handling, criteria change detection, event appending.

Adds sub-agent-specific concerns: fresh context setup, return value capture + nudge, verifier-specific nudge config, and a special-case branch where verifier uses `assembleVerifierRequest()` while others build the request inline differently.

### Target: one execution loop

All three paths collapse into a single `runAgentTurn(agentDef, executionContext)` that is parameterized by the agent definition. The differences become configuration, not code branches.

## Design

### Unified `.agent.md` format

All agents — top-level and sub-agents — are defined as `.agent.md` files with YAML frontmatter and a markdown body containing the agent-specific instructions.

```markdown
---
id: verifier
name: Verifier
description: Verifies completed criteria against actual code changes
subagent: true
tools:
  - read_file
  - run_command
  - pass_criterion
  - fail_criterion
  - web_fetch
---

For each criterion marked [NEEDS VERIFICATION]:
1. Read the relevant code changes
2. Call pass_criterion or fail_criterion with reasoning
...
```

**Key fields:**
- `id` — unique identifier, used by `call_sub_agent`
- `name` — display name
- `description` — shown in UI and in the "Available Sub-Agents" prompt section
- `subagent` — `true` = fresh context, callable by other agents; `false` = top-level agent with conversation context
- `tools` — list of tool IDs from the global tool registry to activate for this agent

**The markdown body** is the agent's role-specific instructions. Where it goes depends on `subagent`:
- Top-level agents: injected as a runtime reminder (user message), preserving KV cache
- Sub-agents: appended directly to the system prompt (no mode switching, so no cache concern)

### Storage

- **Built-in agents:** `src/server/agents/defaults/` — ship with the repo, same `.agent.md` format
- **User agents:** `~/.openfox/agents/` — CRUD via registry + UI
- **Conflict resolution:** user definitions override built-in by `id`

### Registry

`src/server/agents/registry.ts` — follows the same pattern as commands/skills registries:
- `loadAllAgents()` — discovers all `.agent.md` files (built-in + user)
- `findAgentById(id)` — lookup
- `getSubAgents()` — returns all agents where `subagent: true` (for prompt generation and UI)
- `getTopLevelAgents()` — returns all agents where `subagent: false`
- `saveAgent()` / `deleteAgent()` — CRUD for user-defined agents
- `ensureDefaultAgents()` — copies bundled defaults to user config dir

### Prompt architecture

#### Base prompt: `buildBasePrompt()`

Extracted from current `buildPrimaryPrompt()`. Contains everything shared by ALL agents:
- Environment info (workdir, platform, date)
- Core behavior guidelines
- Mode control (system-reminder handling)
- Tone and style
- Guardrails
- Skills section (dynamically generated from enabled skills)

Does NOT contain: agent-specific instructions, sub-agents list.

#### Top-level agents (`subagent: false`)

```
systemPrompt = buildTopLevelSystemPrompt(workdir, customInstructions, skills, subAgentDefs)
             = buildBasePrompt() + "Available Sub-Agents" section (dynamic from .agent.md files)

runtimeReminder = agent's .agent.md markdown body
```

The system prompt is **identical for all top-level agents**. Agent-specific behavior comes from the runtime reminder injected into the last user message. This preserves the KV cache when switching between planner/builder/custom agents mid-conversation.

The "Available Sub-Agents" section is dynamically generated from all loaded `.agent.md` files where `subagent: true`, replacing the current hardcoded list.

#### Sub-agents (`subagent: true`)

```
systemPrompt = buildSubAgentSystemPrompt(workdir, agentDef, skills)
             = buildBasePrompt() + agent's .agent.md markdown body

no runtime reminder
```

Since sub-agents always run with fresh context and never switch modes, their instructions go directly in the system prompt. This is simpler and still benefits from prompt caching on the `buildBasePrompt()` prefix.

Sub-agents can load skills but **cannot call other sub-agents** — only two levels (agent > sub-agent).

### Unified execution loop

Replace `runPlannerTurn()`, `runBuilderTurn()`, and `executeSubAgent()` with a single `runAgentTurn()`.

```typescript
interface AgentTurnContext {
  agentDef: AgentDefinition
  sessionManager: SessionManager
  sessionId: string
  llmClient: LLMClientWithModel
  turnMetrics: TurnMetrics
  statsIdentity: StatsIdentity
  signal?: AbortSignal
  onMessage?: (msg: ServerMessage) => void

  // Supplied by caller based on agent type
  messages: RequestContextMessage[]
  systemPrompt: string
  toolRegistry: ToolRegistry
  runtimeReminder?: string
  injectedFiles: InjectedFile[]

  // Optional behaviors (hooks, not branches)
  onToolResult?: (toolCall: ToolCall, result: ToolResult) => void  // e.g., track modified files
  nudgeConfig?: NudgeConfig                                         // e.g., verifier criterion nudging
  kickoffPrompt?: string                                            // e.g., builder kickoff
}

async function runAgentTurn(ctx: AgentTurnContext): Promise<AgentTurnResult>
```

The loop body is written once:
1. Assemble request (system prompt + messages + runtime reminder)
2. Stream LLM response
3. Consume generator, append events
4. Handle abort / format errors
5. Execute tool calls, append results
6. Call `onToolResult` hook if provided
7. Check criteria changes
8. If sub-agent: capture `return_value`, handle nudging
9. If top-level: inject ASAP messages, recurse

**Callers become thin wrappers:**
- `runPlannerTurn()` → loads planner agent def, gets context messages, calls `runAgentTurn()` with planner reminder
- `runBuilderTurn()` → same but with builder reminder + `onToolResult` for modified file tracking + kickoff prompt
- `executeSubAgent()` → builds fresh context, calls `runAgentTurn()` with agent body in system prompt + nudge config

### Tool selection

All tools live in one global registry. Each `.agent.md` declares which tools it needs via the `tools` field. The existing `getToolRegistryForSubAgent(toolNames: string[])` function handles this — it filters the global registry to only include the named tools.

`getToolRegistryForMode()` with hardcoded modes gets replaced by `getToolRegistryForAgent(agentDef)` which reads the `tools` array from the agent definition.

### Result extraction

Stays as-is. The current implementation is solid:
1. Sub-agent calls `return_value` tool → captured as result
2. If it doesn't, nudge it once to do so
3. If it still doesn't, use the last message as the result

This logic is agent-type-agnostic and lives in the unified loop as a sub-agent behavior (return value capture + nudge on empty stop).

### Request assembly

Replace the three separate functions:
- `assemblePlannerRequest()`
- `assembleBuilderRequest()`
- `assembleVerifierRequest()`

With a unified:
- `assembleAgentRequest(agentDef, input)` — builds system prompt and runtime reminder based on `agentDef.subagent`

## Implementation Steps

### Phase 1: Unify execution loop
- Extract the shared loop from `runPlannerTurn`/`runBuilderTurn`/`executeSubAgent` into `runAgentTurn()`
- Parameterize differences via `AgentTurnContext` (hooks for modified file tracking, nudge config, kickoff prompt)
- Make existing `runPlannerTurn`/`runBuilderTurn`/`runVerifierTurn` thin wrappers that call `runAgentTurn()`
- **Files**: `src/server/chat/orchestrator.ts`, `src/server/sub-agents/manager.ts`
- **Validation**: all existing behavior unchanged, tests pass

### Phase 2: Create the agent registry
- Define `AgentMetadata` and `AgentDefinition` types in `src/server/agents/types.ts`
- Implement `src/server/agents/registry.ts` (same pattern as commands/skills)
- Create default `.agent.md` files in `src/server/agents/defaults/`:
  - `planner.agent.md`
  - `builder.agent.md`
  - `verifier.agent.md`
  - `code-reviewer.agent.md`
  - `test-generator.agent.md`
  - `debugger.agent.md`

### Phase 3: Refactor prompts
- Extract `buildBasePrompt()` from current `buildPrimaryPrompt()`
- Implement `buildTopLevelSystemPrompt()` — base + dynamic sub-agents section
- Implement `buildSubAgentSystemPrompt()` — base + agent body
- Dynamic "Available Sub-Agents" section generated from loaded agent definitions

### Phase 4: Unify request assembly + tool selection
- Implement `assembleAgentRequest(agentDef, input)` replacing the three separate functions
- Top-level: system prompt + runtime reminder from agent body
- Sub-agent: system prompt includes agent body, no runtime reminder
- Replace `getToolRegistryForMode()` with `getToolRegistryForAgent(agentDef)`
- Tools come from the `tools` field in the agent definition

### Phase 5: Wire it all together
- Thin wrappers load agent definitions from registry instead of hardcoded config
- `call_sub_agent` tool resolves agent ID → `AgentDefinition` via the new registry
- Remove `src/server/sub-agents/registry.ts` (hardcoded definitions)
- Remove `buildPlannerPrompt()`, `buildBuilderPrompt()`, `buildVerifierPrompt()`
- Remove `assemblePlannerRequest()`, `assembleBuilderRequest()`, `assembleVerifierRequest()`
- Remove `getToolRegistryForMode()`

### Phase 6: API + UI
- Expose agent CRUD endpoints (same pattern as commands/skills API)
- Agent editor in UI: name, description, subagent toggle, tool selection, prompt editor

## What gets deleted

- `buildVerifierPrompt()` — replaced by `verifier.agent.md`
- `buildPlannerPrompt()` / `buildBuilderPrompt()` — replaced by respective `.agent.md` + unified prompt assembly
- `assemblePlannerRequest()` / `assembleBuilderRequest()` / `assembleVerifierRequest()` — replaced by `assembleAgentRequest()`
- `getToolRegistryForMode()` — replaced by `getToolRegistryForAgent()`
- `src/server/sub-agents/registry.ts` hardcoded definitions — replaced by `.agent.md` files
- Hardcoded sub-agents section in `buildPrimaryPrompt()` — dynamically generated from registry
- Duplicate execution loops in `runPlannerTurn` / `runBuilderTurn` / `executeSubAgent` — unified into `runAgentTurn()`

## Key files

| File | Action |
|------|--------|
| `src/server/agents/types.ts` | **New** — AgentMetadata, AgentDefinition |
| `src/server/agents/registry.ts` | **New** — file-based agent registry |
| `src/server/agents/defaults/*.agent.md` | **New** — built-in agent definitions |
| `src/server/chat/agent-loop.ts` | **New** — unified `runAgentTurn()` execution loop |
| `src/server/chat/prompts.ts` | **Refactor** — extract buildBasePrompt, add buildTopLevelSystemPrompt, buildSubAgentSystemPrompt |
| `src/server/chat/request-context.ts` | **Refactor** — unified assembleAgentRequest |
| `src/server/tools/index.ts` | **Refactor** — getToolRegistryForAgent replaces getToolRegistryForMode |
| `src/server/sub-agents/manager.ts` | **Refactor** — thin wrapper around runAgentTurn with fresh context + return value capture |
| `src/server/sub-agents/registry.ts` | **Delete** — replaced by .agent.md files |
| `src/server/chat/orchestrator.ts` | **Refactor** — thin wrappers around runAgentTurn, load agent defs from registry |

## Verification

1. Default agents produce identical behavior to current hardcoded implementation
2. Existing orchestrator and decision tests pass
3. A custom agent (e.g., `security-auditor`) can be defined entirely as a `.agent.md` file
4. Sub-agents get `buildBasePrompt()` + their body in system prompt
5. Top-level agents get `buildBasePrompt()` + sub-agents section in system prompt, body as runtime reminder
6. Tool list in agent definition correctly constrains available tools
7. KV cache is preserved when switching between top-level agents
8. User-defined agents override built-in agents by ID
9. Single execution loop handles planner, builder, and sub-agent turns without code branches per agent type
