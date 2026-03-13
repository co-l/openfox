import type { LLMToolDefinition, LLMMessage } from '../llm/types.js'
import type { ToolCall } from '@openfox/shared'

/**
 * Build the planning system prompt with dynamically injected tools.
 */
export function buildPlanningSystemPrompt(tools: LLMToolDefinition[]): string {
  const toolList = tools
    .map(t => `- **${t.function.name}**: ${t.function.description}`)
    .join('\n')

  return `You are a planning assistant. Your ONLY job is to help refine the user's request and define acceptance criteria.

## CRITICAL: THIS IS PLANNING ONLY

You are in the **planning phase**. You must NOT:
- Write or modify any code
- Implement solutions
- Make changes to the codebase

A separate execution agent will handle implementation AFTER planning is complete.

Your goal: Turn a vague request into a clear, well-defined set of acceptance criteria.

## YOUR WORKFLOW

1. **Understand** - Ask clarifying questions about what the user wants
2. **Explore** - Use read-only tools to understand the codebase context
3. **Propose** - Present acceptance criteria to the user for approval
4. **Refine** - Iterate based on user feedback
5. **Finalize** - Once approved, formally create the criteria

## AVAILABLE TOOLS

${toolList}

## HOW TO PROPOSE CRITERIA

Present criteria clearly in conversation and ASK for approval:

"Based on my exploration, here are the proposed acceptance criteria:

1. **tests-pass**: All unit tests pass (\`npm test\` exits 0)
2. **api-returns-jwt**: Login endpoint returns a valid JWT on success

Do these look good? Should I add, remove, or modify any?"

IMPORTANT: Do NOT call add_criterion until the user approves your proposal.

## CRITERIA FORMAT

- **id**: Short semantic identifier (e.g., "tests-pass", "api-returns-jwt")
- **description**: Specific, verifiable requirement including HOW to verify it

Good: "Login endpoint returns 200 with valid JWT when given correct credentials"
Bad: "Login should work"

## REMEMBER

- You are planning, NOT implementing
- Ask questions when requirements are unclear
- Always get user approval before creating criteria
- Use get_criteria to see current state (user may have edited in the UI)`
}

// Planning phase tools
export const PLANNING_TOOLS: LLMToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read file contents with line numbers. Use offset/limit for large files.',
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
      description: 'Find files matching a glob pattern (e.g., "**/*.ts", "src/**/*.{js,jsx}").',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern to match files',
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
      description: 'Search for a regex pattern in files. Returns matching lines with file paths and line numbers.',
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
      name: 'get_criteria',
      description: 'Get the current acceptance criteria list, including any user edits. Always call this before modifying criteria.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_criterion',
      description: 'Add a new acceptance criterion.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Unique semantic identifier (e.g., "tests-pass", "api-returns-jwt")',
          },
          description: {
            type: 'string',
            description: 'Self-contained, verifiable requirement. Include how to verify it.',
          },
        },
        required: ['id', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_criterion',
      description: 'Update an existing criterion by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'ID of the criterion to update',
          },
          description: {
            type: 'string',
            description: 'New description',
          },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_criterion',
      description: 'Remove a criterion by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'ID of the criterion to remove',
          },
        },
        required: ['id'],
      },
    },
  },
]

/**
 * Build LLM messages array from conversation history.
 */
export function buildPlanningMessages(
  tools: LLMToolDefinition[],
  conversationHistory: Array<{ 
    role: string
    content: string
    toolCalls?: ToolCall[]
    toolCallId?: string
  }>
): LLMMessage[] {
  const systemPrompt = buildPlanningSystemPrompt(tools)
  
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
  ]
  
  for (const m of conversationHistory) {
    if (m.role === 'tool' && m.toolCallId) {
      messages.push({
        role: 'tool',
        content: m.content,
        toolCallId: m.toolCallId,
      })
    } else if (m.role === 'assistant') {
      const msg: LLMMessage = {
        role: 'assistant',
        content: m.content,
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.toolCalls = m.toolCalls
      }
      messages.push(msg)
    } else if (m.role === 'user') {
      messages.push({
        role: 'user',
        content: m.content,
      })
    }
  }
  
  return messages
}
