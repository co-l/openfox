# Mock LLM for E2E Testing

## Overview

The Mock LLM allows you to test the OpenFox system **without depending on real LLM inference**. This provides:

- **Deterministic behavior** - Same prompt always returns same tool calls
- **Fast tests** - No waiting for LLM inference
- **No external dependencies** - Tests work without vLLM running
- **Complete coverage** - Test edge cases and error handling

## What the Mock Does

The mock LLM:
1. **Matches prompts** to predefined rules using text patterns or regex
2. **Returns deterministic tool calls** based on the matched rule
3. **Streams responses** like the real LLM (thinking, tool calls, content)
4. **Tracks metrics** (tokens, timing) for testing stats aggregation

## What the Mock Tests

You can test the entire system **except the LLM**:

✅ Tool execution pipelines  
✅ Session state management  
✅ Criteria/plan/verifier workflows  
✅ Error handling (denied paths, failures, etc.)  
✅ Concurrency and race conditions  
✅ WebSocket protocol handling  
✅ Event streaming and persistence  
✅ UI rendering from server events  

❌ LLM quality or reasoning  
❌ Model-specific behavior  
❌ Real inference performance  

## Usage

### 1. Run Tests with Mock LLM

```bash
# Set environment variable to enable mock mode
OPENFOX_MOCK_LLM=true npx vitest run

# Or run specific test files
OPENFOX_MOCK_LLM=true npx vitest run e2e/tools-read.test.ts
```

### 2. Use Mock in Test Files

```typescript
import { createMockLLMClient, type MockToolCallRule } from './utils/mock-llm.js'

// Create mock client with custom rules
const mockClient = createMockLLMClient({
  model: 'test-model',
  defaultResponse: 'Task completed.',
})

// Add custom rule for specific prompt
mockClient.addRules([
  {
    promptMatch: /my-custom-action/i,
    toolCalls: [
      { name: 'run_command', arguments: { command: 'echo "custom"' } }
    ],
    response: 'Custom action done.',
  }
])
```

### 3. Default Tool Call Rules

The mock includes these built-in patterns:

| Prompt Pattern | Tool Called | Arguments |
|---------------|-------------|-----------|
| `read.*file` | `read_file` | `{ path: 'src/index.ts' }` |
| `glob\|find.*file` | `glob` | `{ pattern: '**/*.ts' }` |
| `write.*file\|create.*file` | `write_file` | `{ path: 'src/newfile.ts', content: 'export const x = 1' }` |
| `run.*command\|execute.*shell` | `run_command` | `{ command: 'echo "test"' }` |
| `add_criterion\|add.*criterion` | `add_criterion` | `{ id: 'mock-crit', description: '...' }` |
| `grep\|search` | `grep` | `{ pattern: 'export', path: 'src' }` |

## Example Test

```typescript
import { describe, it, expect } from 'vitest'
import { createTestClient, createTestProject } from './utils/index.js'

describe('Mock LLM Tool Execution', () => {
  it('executes read_file tool', async () => {
    const client = await createTestClient()
    const project = await createTestProject({ template: 'typescript' })
    
    // Create project and session
    await client.send('project.create', { name: 'test', workdir: project.path })
    await client.send('session.create', { projectId: client.getProject()!.id })
    
    // Send message that triggers read_file
    const response = await client.send('chat.send', { 
      content: 'Read the file src/index.ts' 
    })
    
    // Verify tool was called
    const events = client.allEvents()
    const toolCalls = events.filter(e => e.type === 'chat.tool_call')
    
    expect(toolCalls.length).toBeGreaterThan(0)
    const tool = toolCalls[0]!.payload as { tool: string; args: Record<string, unknown> }
    expect(tool.tool).toBe('read_file')
    expect((tool.args as { path: string }).path).toBe('src/index.ts')
    
    await client.close()
    await project.cleanup()
  })
})
```

## Architecture

### Mock LLM Client (`src/server/llm/mock.ts`)

The server-side mock that replaces the real LLM client when `OPENFOX_MOCK_LLM=true`:

- Intercepts `chat.send` requests
- Matches prompts to rules
- Returns streaming tool calls and responses
- Integrates with the existing `streamLLMResponse` pipeline

### E2E Mock Utilities (`e2e/utils/mock-llm.ts`)

Test utilities for creating mock clients in isolation:

- `createMockLLMClient()` - Create standalone mock
- `MockToolCallRule` - Define prompt→tool mappings
- `addRules()` / `setRules()` - Customize behavior per test

## Limitations

1. **No real LLM behavior** - Cannot test model quality, reasoning, or creativity
2. **Pattern matching only** - Uses simple regex/text matching, not semantic understanding
3. **Fixed responses** - Cannot test dynamic/adaptive LLM behavior
4. **No context awareness** - Doesn't maintain conversation context across turns

## When to Use Mock vs Real LLM

### Use Mock For:
- Testing tool execution pipelines
- Verifying state management
- Testing error handling
- Fast iteration during development
- CI/CD without GPU requirements

### Use Real LLM For:
- Testing actual LLM quality
- End-to-end user experience
- Model-specific features (reasoning, long context)
- Performance benchmarking
- Integration testing with vLLM

## Extending the Mock

Add custom rules for your specific test needs:

```typescript
mockClient.setRules([
  {
    promptMatch: /specific-test-scenario/i,
    toolCalls: [
      { name: 'tool1', arguments: { arg1: 'value1' } },
      { name: 'tool2', arguments: { arg2: 'value2' } }
    ],
    response: 'Completed both tools.',
    thinking: 'Let me think step by step...',
  },
  // Add more rules...
])
```

## Running Mock Tests

```bash
# Run all e2e tests with mock LLM
OPENFOX_MOCK_LLM=true npx vitest run e2e/

# Run specific test file
OPENFOX_MOCK_LLM=true npx vitest run e2e/mock-llm.test.ts

# Verbose mode to see tool calls
OPENFOX_MOCK_LLM=true OPENFOX_TEST_VERBOSE=true npx vitest run e2e/
```

## Future Enhancements

Potential improvements:

- Record/replay mode: capture real LLM responses and replay deterministically
- Scenario builder: define multi-turn conversations
- Error injection: simulate LLM failures, timeouts, malformed responses
- Coverage tracking: ensure all code paths are tested
