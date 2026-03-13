import type { LLMToolDefinition, LLMMessage } from '../llm/types.js'
import type { ToolCall } from '@openfox/shared'

export const PLANNING_SYSTEM_PROMPT = `You are an expert software architect helping to plan a coding task.

## YOUR WORKFLOW

1. **Understand requirements** - Chat with the user, ask clarifying questions
2. **Explore the codebase** - Use read_file, glob, grep to understand current state
3. **Define acceptance criteria** - When ready, call set_acceptance_criteria

## EXPLORATION TOOLS
- read_file: Read file contents
- glob: Find files by pattern  
- grep: Search for patterns in files

Use these proactively to understand project structure, existing patterns, and what needs to change.

## ACCEPTANCE CRITERIA TOOL
When you have enough context, call set_acceptance_criteria with clear, verifiable criteria.

Each criterion needs:
- **description**: Specific, self-contained, verifiable requirement
- **verification.type**: 
  - "auto" - Can verify with a shell command (test, build, lint)
  - "model" - Requires code review to verify
  - "human" - Requires user confirmation
- **verification.command**: For "auto" type, the exact command to run

Example good criteria:
- "All tests pass: npm test exits with code 0" (auto, command: "npm test")
- "TypeScript compiles without errors" (auto, command: "npm run build")
- "Login endpoint returns JWT token on success" (model)
- "UI matches provided mockup" (human)

## GUIDELINES
- Explore before assuming - read package.json, existing tests, etc.
- Ask if requirements are ambiguous
- Make criteria specific and testable
- You can call set_acceptance_criteria multiple times to refine
- The user can edit criteria before accepting`

// Planning phase tools
export const PLANNING_TOOLS: LLMToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. Returns the file content with line numbers.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (relative to workdir or absolute)',
          },
          offset: {
            type: 'number',
            description: 'Line number to start from (1-indexed). Default: 1',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to read. Default: 200',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Find files matching a glob pattern. Returns list of matching file paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.{js,jsx}")',
          },
          cwd: {
            type: 'string',
            description: 'Base directory for the search (default: session workdir)',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search for a pattern in files. Returns matching lines with file paths and line numbers.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regex pattern to search for',
          },
          include: {
            type: 'string',
            description: 'File pattern to include (e.g., "*.ts", "*.{js,jsx}")',
          },
          cwd: {
            type: 'string',
            description: 'Base directory for the search (default: session workdir)',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_acceptance_criteria',
      description: 'Set the acceptance criteria for the task. Call this when you have gathered enough context from the conversation and codebase exploration. Each criterion should be specific and verifiable.',
      parameters: {
        type: 'object',
        properties: {
          criteria: {
            type: 'array',
            description: 'List of acceptance criteria',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Unique identifier (e.g., "criterion-1")',
                },
                description: {
                  type: 'string',
                  description: 'Clear, specific, verifiable requirement',
                },
                verification: {
                  type: 'object',
                  description: 'How to verify this criterion',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['auto', 'model', 'human'],
                      description: 'auto=shell command, model=code review, human=user confirmation',
                    },
                    command: {
                      type: 'string',
                      description: 'Shell command for auto verification (e.g., "npm test")',
                    },
                  },
                  required: ['type'],
                },
              },
              required: ['id', 'description', 'verification'],
            },
          },
        },
        required: ['criteria'],
      },
    },
  },
]

export function buildPlanningMessages(
  conversationHistory: Array<{ 
    role: string
    content: string
    toolCalls?: ToolCall[]
    toolCallId?: string
  }>
): LLMMessage[] {
  const messages: LLMMessage[] = [
    { role: 'system', content: PLANNING_SYSTEM_PROMPT },
  ]
  
  for (const m of conversationHistory) {
    if (m.role === 'tool' && m.toolCallId) {
      messages.push({
        role: 'tool',
        content: m.content,
        toolCallId: m.toolCallId,
      })
    } else if (m.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: m.content,
        toolCalls: m.toolCalls,
      })
    } else if (m.role === 'user') {
      messages.push({
        role: 'user',
        content: m.content,
      })
    }
  }
  
  return messages
}
