# Plan: Workflow Completeness

## Context

Depends on: **SUBAGENT-REWORK.md** (must be completed first).

After the sub-agent rework, each pipeline step can declare its own prompt, context, and tools. This plan covers everything needed to make workflows fully self-contained and editable — so users can create entirely new workflows from the UI without touching code.

## What's Missing After Sub-Agent Rework

### 1. LLM Turn steps also need configurable context and tools
The sub-agent rework makes `sub_agent` steps data-driven, but `llm_turn` steps (the builder) still use hardcoded prompt assembly in `assembleBuilderRequest()` / `assemblePlannerRequest()` in `src/server/chat/request-context.ts`. The builder's system prompt, tool set, and context injection are all hardcoded.

**Goal**: `llm_turn` steps should also declare context blocks and tool lists, just like sub-agent steps. The difference is execution model (continues main conversation vs. fresh context), not configuration shape.

### 2. Unified step configuration shape
After this work, both step types share the same config surface:
```
{
  "prompt": "...",           // Role-specific instructions appended to PrimaryPrompt
  "contextBlocks": [...],    // What context to inject
  "tools": [...],            // Which tools are available
  "options": { ... }         // Execution options
}
```
The only difference is:
- `llm_turn`: runs in the main conversation context
- `sub_agent`: runs in fresh/isolated context

### 3. Pipeline editor UI needs to expose the new fields
- Context blocks: multi-select from available blocks
- Tools: multi-select from available tools
- Prompt: textarea (already exists)
- Options: checkboxes for `freshContext`, `disableThinking`, etc.

### 4. Context block editor
Users should be able to see what each context block produces and potentially create custom blocks. Custom blocks could be templates with `{{variables}}` that get resolved from session state.

### 5. Shell step result → context flow
Shell steps capture stdout/stderr. This output needs to flow into subsequent steps' context. Currently handled by `{{previousStepOutput}}` template variable, but with context blocks this becomes a first-class block: `previous_step_output`.

### 6. Step result conditions need richer evaluation
Currently transitions evaluate criteria state. With richer workflows, steps might need to evaluate:
- Shell exit code (already supported via `step_result`)
- Sub-agent return value content (e.g., "did the reviewer find critical issues?")
- Custom conditions based on session state

### 7. Pipeline validation
The editor should validate pipelines before saving:
- All transition targets exist (step IDs or terminals)
- Entry step exists
- No unreachable steps
- Tool names are valid
- Context block names are valid
- No infinite loops without exit conditions (warning, not error)

## Implementation Steps

### Phase 1: Unified step config shape
- Add `contextBlocks`, `tools`, `options` to `LLMTurnStep` type (matching `SubAgentStep`).
- Refactor `assembleBuilderRequest()` to accept these from step config instead of hardcoding.
- Default pipeline's builder step carries its full config inline.
- **Files**: `src/server/pipelines/types.ts`, `src/server/chat/request-context.ts`, `src/server/pipelines/executor.ts`

### Phase 2: API endpoints for available tools and context blocks
- `GET /api/tools` — list of all available tools with names and descriptions.
- `GET /api/context-blocks` — list of available context blocks with names, descriptions, and preview of what they produce.
- **Files**: `src/server/index.ts`, `src/server/pipelines/context-blocks.ts`

### Phase 3: Pipeline editor UI enhancements
- Add context blocks multi-select to step properties panel.
- Add tools multi-select (checkboxes) to step properties panel.
- Add options section (freshContext toggle, disableThinking toggle).
- Show available template variables in prompt textarea helper text.
- **Files**: `web/src/components/settings/PipelinesModal.tsx`

### Phase 4: Pipeline validation
- Client-side validation in the editor (red highlights for broken references).
- Server-side validation on save (reject invalid pipelines with clear errors).
- **Files**: `web/src/components/settings/PipelinesModal.tsx`, `src/server/index.ts`

### Phase 5: Custom context blocks
- Allow users to define custom context blocks as templates in the pipeline config.
- Template format: markdown with `{{session.summary}}`, `{{session.criteria}}`, etc.
- Stored inline in the pipeline step or as separate reusable blocks.
- **Files**: `src/server/pipelines/context-blocks.ts`, `src/server/pipelines/types.ts`

## Key Design Decisions to Make

1. **Should the builder step also use context blocks?** The builder currently gets the full conversation history. Adding context blocks on top would be additive (inject extra context), not replacing the conversation. This is different from sub-agents which start fresh.

2. **Tool selection granularity**: Should steps declare individual tools, or tool "presets" (e.g., "read-only", "full-access", "verification")? Individual tools are more flexible but verbose. Could support both.

3. **Where to store custom context blocks**: Inline in the pipeline JSON, or as separate files like skills? If pipelines get shared/exported, inline is more portable.

## Key Files

| File | Role |
|------|------|
| `src/server/pipelines/types.ts` | Step types — add contextBlocks, tools, options |
| `src/server/pipelines/executor.ts` | Wire up dynamic context/tools for both step types |
| `src/server/pipelines/context-blocks.ts` | Context block registry (from sub-agent rework) |
| `src/server/chat/request-context.ts` | Builder request assembly — make data-driven |
| `src/server/chat/orchestrator.ts` | `runBuilderTurn()` / `runVerifierTurn()` — accept config |
| `src/server/tools/index.ts` | Dynamic tool selection (from sub-agent rework) |
| `src/server/index.ts` | New API endpoints for tools/blocks |
| `web/src/components/settings/PipelinesModal.tsx` | Editor UI enhancements |
| `web/src/stores/pipelines.ts` | Store types for new fields |

## Verification

1. A workflow with a custom LLM turn step (non-default prompt, restricted tools, specific context blocks) works correctly.
2. A workflow with a custom sub-agent step defined entirely in JSON works correctly.
3. Pipeline editor shows available tools, context blocks, and options for each step.
4. Invalid pipelines are rejected with clear error messages.
5. Default pipeline still works identically to current behavior.
6. Pipelines can be exported/imported as self-contained JSON files.
