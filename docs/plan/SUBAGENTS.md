# Sub-Agent Architecture Plan

## Overview

This document describes the design and implementation plan for a flexible sub-agent system in OpenFox. Sub-agents are specialized AI agents that can be called by main agents (builder/planner) to perform specific tasks with isolated context and tool sets.

## Current State

Currently, OpenFox has one sub-agent type: the **verifier**. It runs as part of the orchestrator loop, verifying completed criteria with:
- Fresh context (summary + criteria + modified files)
- Restricted tools (read, run_command, pass/fail_criterion)
- Isolated execution that returns results to the main orchestrator

## Goals

1. **Extensibility**: Support multiple sub-agent types beyond verifier
2. **Context Isolation**: Main agent context remains untouched when sub-agents run
3. **Simplicity**: Clean, straightforward API for calling sub-agents
4. **Transparency**: Sub-agent activity visible but doesn't pollute main context view
5. **LLM-to-LLM Communication**: Free-form text results, no structured JSON parsing

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Main Agent                               │
│                   (Builder / Planner)                           │
│                                                                 │
│  System Prompt includes:                                        │
│  - Available sub-agents list                                    │
│  - When/how to call them                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ calls via tool
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    call_sub_agent Tool                          │
│  Parameters: { subAgentType, prompt }                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ delegates
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Sub-Agent Manager                             │
│  - Registry of sub-agent types                                  │
│  - Executes sub-agents with isolated context                    │
│  - Returns result to main agent                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ creates fresh context
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Sub-Agent                                  │
│  - Specific system prompt                                       │
│  - Restricted tool set                                          │
│  - Fresh context (not main conversation)                        │
│  - Returns free-form text result                                │
└─────────────────────────────────────────────────────────────────┘
```

### Sub-Agent Registry

**Location**: `src/server/sub-agents/registry.ts`

**Structure**:
```typescript
interface SubAgentDefinition {
  id: string                                    // Unique identifier (e.g., 'verifier')
  name: string                                  // Display name (e.g., 'Verifier')
  description: string                           // What it does (shown to main agent)
  systemPrompt: string                          // System prompt for the sub-agent
  tools: string[]                               // Available tool names
  createContext: (session: Session, args: {    // Function to build fresh context
    prompt: string
  }) => PromptContext
}

interface SubAgentRegistry {
  getSubAgent(id: string): SubAgentDefinition | undefined
  getAllSubAgents(): SubAgentDefinition[]
  getToolRegistry(subAgentType: string): ToolRegistry
}
```

**Initial Sub-Agent Types**:

| ID | Name | Description | Tools | Context Source |
|----|------|-------------|-------|----------------|
| `verifier` | Verifier | Verify completed criteria against implementation | read_file, run_command, pass_criterion, fail_criterion | Summary + criteria + modified files |
| `code_reviewer` | Code Reviewer | Review code changes for quality, bugs, and best practices | read_file, grep | Modified files + relevant context |
| `test_generator` | Test Generator | Generate tests for implemented features | read_file, write_file, run_command | Source files + requirements |
| `debugger` | Debugger | Analyze errors and suggest fixes | read_file, run_command, grep | Error logs + relevant code |

### Call Sub-Agent Tool

**Location**: `src/server/tools/sub-agent.ts`

**Tool Definition**:
```typescript
const callSubAgentTool: Tool = {
  name: 'call_sub_agent',
  definition: {
    type: 'function',
    function: {
      name: 'call_sub_agent',
      description: 'Call a sub-agent to perform a specialized task. Available sub-agents: verifier, code_reviewer, test_generator, debugger.',
      parameters: {
        type: 'object',
        properties: {
          subAgentType: {
            type: 'string',
            description: 'Type of sub-agent to call (verifier, code_reviewer, test_generator, debugger)',
            enum: ['verifier', 'code_reviewer', 'test_generator', 'debugger']
          },
          prompt: {
            type: 'string',
            description: 'Task description for the sub-agent. Be specific about what you need.'
          }
        },
        required: ['subAgentType', 'prompt']
      }
    }
  },
  async execute(args, context) {
    // Delegate to Sub-Agent Manager
    const result = await subAgentManager.executeSubAgent(
      args.subAgentType,
      args.prompt,
      context.sessionManager,
      context.sessionId
    )
    return {
      success: true,
      output: result,  // Free-form text result
      durationMs: result.durationMs,
      truncated: false
    }
  }
}
```

**Availability**:
- Builder tool registry: ✅
- Planner tool registry: ✅
- Sub-agent tool registries: ❌ (prevents nesting)

### Sub-Agent Manager

**Location**: `src/server/sub-agents/manager.ts`

**Core Function**:
```typescript
interface SubAgentManager {
  /**
   * Execute a sub-agent with isolated context
   */
  async executeSubAgent(
    subAgentType: string,
    prompt: string,
    sessionManager: SessionManager,
    sessionId: string
  ): Promise<string> {
    // 1. Get sub-agent definition from registry
    const definition = registry.getSubAgent(subAgentType)
    if (!definition) {
      throw new Error(`Unknown sub-agent type: ${subAgentType}`)
    }

    // 2. Get current session
    const session = sessionManager.requireSession(sessionId)

    // 3. Build fresh context using definition's createContext function
    const subAgentId = crypto.randomUUID()
    const contextContent = definition.createContext(session, { prompt })

    // 4. Add context reset marker to main session (visible in UI)
    const resetMsg = sessionManager.addMessage(sessionId, {
      role: 'user',
      content: `Fresh Context - ${definition.name} Sub-Agent`,
      isSystemGenerated: true,
      messageKind: 'context-reset',
      subAgentId,
      subAgentType: subAgentType as SubAgentType
    })

    // 5. Add prompt message
    const promptMsg = sessionManager.addMessage(sessionId, {
      role: 'user',
      content: prompt,
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
      subAgentId,
      subAgentType: subAgentType as SubAgentType
    })

    // 6. Get tool registry for this sub-agent type
    const toolRegistry = registry.getToolRegistry(subAgentType)

    // 7. Run LLM turn with isolated context
    const result = await streamLLMResponse({
      sessionManager,
      sessionId,
      systemPrompt: definition.systemPrompt,
      llmClient,
      tools: toolRegistry.definitions,
      toolChoice: 'auto',
      customMessages: contextContent.messages,  // Fresh context, not main conversation
      subAgentId,
      subAgentType: subAgentType as SubAgentType
    })

    // 8. Return free-form text result
    return result.content
  }
}
```

### Context Isolation

**Key Principle**: Sub-agents do NOT see the main agent's conversation history.

**How it works**:
1. Each sub-agent type has a `createContext()` function that extracts only relevant data
2. The context is built fresh for each sub-agent call
3. Messages are tagged with `subAgentId` and `subAgentType` for tracking
4. Main agent's context window remains unchanged

**Example - Verifier Context**:
```typescript
function createVerifierContext(session: Session, args: { prompt: string }): PromptContext {
  const summary = session.summary ?? 'No summary available'
  const modifiedFiles = session.executionState?.modifiedFiles ?? []
  
  const criteriaList = session.criteria
    .map(c => {
      const status = c.status.type === 'passed' ? '[PASSED]'
        : c.status.type === 'completed' ? '[NEEDS VERIFICATION]'
        : c.status.type === 'failed' ? '[FAILED]'
        : '[NOT COMPLETED]'
      return `- **${c.id}** ${status}: ${c.description}`
    })
    .join('\n')
  
  const contextContent = `## Task Summary
${summary}

## Criteria
${criteriaList}

## Modified Files
${modifiedFiles.length > 0 ? modifiedFiles.map(f => `- ${f}`).join('\n') : '(none)'}`

  return {
    systemPrompt: buildVerifierPrompt(session.workdir),
    injectedFiles: [],  // Load from getAllInstructions if needed
    userMessage: args.prompt,
    messages: [
      { role: 'user', content: contextContent, source: 'runtime' },
      { role: 'user', content: args.prompt, source: 'runtime' }
    ],
    tools: [],  // Will be filled by tool registry
    requestOptions: { toolChoice: 'auto', disableThinking: true }
  }
}
```

### Message Tagging

**Purpose**: Track which messages belong to which sub-agent session.

**Message Structure**:
```typescript
interface Message {
  // ... existing fields ...
  subAgentId?: string       // Unique ID for this sub-agent session
  subAgentType?: string     // Type of sub-agent (verifier, code_reviewer, etc.)
  messageKind?: 'correction' | 'auto-prompt' | 'context-reset'
}
```

**UI Display**:
- Messages with `subAgentId` are grouped together
- Displayed in expandable/collapsible sections
- Labeled with sub-agent type
- Collapsed by default to keep main context clean

### System Prompt Integration

**Main Agent System Prompt** includes:

```
## AVAILABLE SUB-AGENTS

You can call specialized sub-agents for specific tasks:

1. **verifier** - Verify completed criteria against implementation
   - Use when: You've completed criteria and need verification
   - Calls: pass_criterion or fail_criterion based on verification

2. **code_reviewer** - Review code changes for quality and bugs
   - Use when: You've made code changes and want feedback
   - Returns: Review findings and suggestions

3. **test_generator** - Generate tests for implemented features
   - Use when: You've implemented features and need tests
   - Returns: Test code and execution results

4. **debugger** - Analyze errors and suggest fixes
   - Use when: You encounter errors or bugs
   - Returns: Root cause analysis and fix suggestions

To call a sub-agent, use the call_sub_agent tool with:
- subAgentType: The ID of the sub-agent
- prompt: Clear description of what you need
```

## Implementation Plan

### Phase 1: Core Infrastructure

**Tasks**:
1. Create `src/server/sub-agents/types.ts` - Define core types
2. Create `src/server/sub-agents/registry.ts` - Sub-agent registry
3. Create `src/server/sub-agents/manager.ts` - Execution logic
4. Create `src/server/tools/sub-agent.ts` - call_sub_agent tool
5. Update tool registries to include call_sub_agent

**Files to Create**:
- `src/server/sub-agents/types.ts`
- `src/server/sub-agents/registry.ts`
- `src/server/sub-agents/manager.ts`
- `src/server/tools/sub-agent.ts`

**Files to Modify**:
- `src/server/tools/index.ts` - Add call_sub_agent to builder/planner registries
- `src/server/prompts.ts` - Add sub-agent list to main agent prompts

### Phase 2: Migrate Verifier

**Tasks**:
1. Refactor `src/server/chat/verifier.ts` to use new sub-agent framework
2. Update `src/server/chat/orchestrator.ts` to use sub-agent manager
3. Ensure backward compatibility (same behavior, new architecture)

**Files to Modify**:
- `src/server/chat/verifier.ts` - Convert to use sub-agent framework
- `src/server/chat/orchestrator.ts` - Update to call sub-agent manager

### Phase 3: Testing

**Tasks**:
1. Unit tests for sub-agent registry
2. Integration tests for call_sub_agent tool
3. End-to-end tests for verifier sub-agent
4. Test context isolation

**Files to Create**:
- `src/server/sub-agents/registry.test.ts`
- `src/server/sub-agents/manager.test.ts`
- `src/server/tools/sub-agent.test.ts`

### Phase 4: Additional Sub-Agents

**Tasks** (future work, not in initial implementation):
1. Implement code_reviewer sub-agent
2. Implement test_generator sub-agent
3. Implement debugger sub-agent
4. Add context builders for each type

## Acceptance Criteria

1. **subagent-registry-defined**: A sub-agent registry exists at `src/server/sub-agents/registry.ts` defining available sub-agent types with: id, name, description, system prompt template, and available tools list. At least 4 types: verifier, code_reviewer, test_generator, debugger.

2. **subagent-tool-available**: A `call_sub_agent` tool exists that main agents can use, accepting parameters: `subAgentType` (string) and `prompt` (string). The tool is available in builder and planner tool registries.

3. **subagent-execution-isolated**: When a sub-agent is called, it executes with: (1) a fresh context containing only relevant data (not the main conversation), (2) a restricted tool set specific to that sub-agent type, (3) a unique subAgentId for tracking. The main agent's context remains unchanged.

4. **subagent-result-returned**: The sub-agent returns its result as free-form text to the main agent. The result is attached to the tool call result and the main agent can act on it. No structured JSON parsing is required.

5. **subagent-conversation-visible**: Sub-agent conversations are visible in the chat UI as expandable/collapsible sections (similar to current verifier display). Each sub-agent session is tagged with subAgentId and subAgentType, allowing users to inspect the sub-agent's work without it polluting the main context view.

6. **system-prompt-includes-subagents**: The main agent's system prompt includes a list of available sub-agents with their names and descriptions, enabling the agent to know when and how to call them.

7. **verifier-migrated-to-framework**: The existing verifier implementation is refactored to use the new sub-agent framework, maintaining identical behavior (fresh context, verification logic, result handling) while conforming to the new architecture.

8. **no-nested-subagents**: Sub-agents cannot call other sub-agents. The call_sub_agent tool is not available within sub-agent tool registries, ensuring only two levels: main agent → sub-agent.

## Design Decisions

### Why Free-Form Results?

**Decision**: Sub-agents return natural text, not structured JSON.

**Rationale**:
- LLM-to-LLM communication is more flexible with natural language
- Main agent can interpret results contextually
- No need for parsing logic or schema validation
- Easier to extend without breaking changes

### Why Context Isolation?

**Decision**: Sub-agents get fresh context, not main conversation.

**Rationale**:
- Keeps main agent's context window clean and focused
- Sub-agents work with relevant data only
- Prevents context pollution and token waste
- Each sub-agent can be optimized for its specific task

### Why No Nesting?

**Decision**: Sub-agents cannot call other sub-agents.

**Rationale**:
- Simpler architecture and debugging
- Prevents infinite recursion
- Two levels (main → sub) is sufficient for most use cases
- Easier to track and display in UI

### Why Expandable UI?

**Decision**: Show sub-agent activity in collapsible sections.

**Rationale**:
- Transparency: users can inspect sub-agent work
- Doesn't clutter main conversation view
- Similar to current verifier display
- Maintains context of main agent flow

## Future Considerations

### Potential Enhancements

1. **Sub-Agent Chaining**: Allow specific sub-agents to call other sub-agents (with explicit configuration)
2. **Custom Sub-Agents**: Allow users to define their own sub-agent types
3. **Sub-Agent Results Caching**: Cache results for repeated tasks
4. **Parallel Sub-Agents**: Call multiple sub-agents simultaneously
5. **Sub-Agent Metrics**: Track performance and success rates per sub-agent type

### Metrics to Track

- Sub-agent call frequency by type
- Average execution time per sub-agent
- Success/failure rates
- Token usage per sub-agent type
- User satisfaction (if feedback mechanism added)

## References

- Current verifier implementation: `src/server/chat/verifier.ts`
- Tool registry: `src/server/tools/index.ts`
- Session types: `src/shared/types.ts`
- Protocol messages: `src/shared/protocol.ts`

---

**Document Version**: 1.0  
**Created**: 2024  
**Status**: Ready for Implementation
