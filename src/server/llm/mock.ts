/**
 * Mock LLM Client for E2E Tests
 * 
 * Provides deterministic LLM responses for testing without real inference.
 * Activated via OPENFOX_MOCK_LLM=true environment variable.
 * 
 * Pattern-matches prompts to return specific tool calls, enabling fast
 * deterministic testing of the entire system through the WebSocket API.
 */

import { setTimeout as sleep } from 'node:timers/promises'

import type { LLMClientWithModel } from './client.js'
import type { LLMCompletionRequest, LLMCompletionResponse, LLMStreamEvent } from './types.js'
import type { ToolCall } from '../../shared/types.js'
import { getModelProfile } from './profiles.js'
import { type Backend } from './backend.js'

// ============================================================================
// Types
// ============================================================================

interface MockToolCall {
  name: string
  arguments: Record<string, unknown>
}

interface MockRule {
  match: RegExp
  tools: MockToolCall[]
  response: string
}

interface MockMatchResult {
  tools: MockToolCall[]
  response: string
}

// ============================================================================
// Rules - Pattern → Tool Calls
// ============================================================================

const RULES: MockRule[] = [
  // -------------------------------------------------------------------------
  // Criterion Tools
  // -------------------------------------------------------------------------
  // Multi-criteria: ID "crit-a": "First" and ID "crit-b": "Second"
  {
    match: /ID\s*["']([a-z0-9-]+)["']:\s*["']([^"']+)["'][\s\S]*ID\s*["']([a-z0-9-]+)["']:\s*["']([^"']+)["']/i,
    tools: [
      { name: 'add_criterion', arguments: { id: '$1', description: '$2' } },
      { name: 'add_criterion', arguments: { id: '$3', description: '$4' } },
    ],
    response: 'Added both criteria.',
  },
  // Single criterion: ID "test-1" with/: description "The tests pass"
  {
    match: /ID\s*["']([a-z0-9-]+)["'].*description\s*["']([^"']+)["']/i,
    tools: [{ name: 'add_criterion', arguments: { id: '$1', description: '$2' } }],
    response: 'Added the criterion.',
  },
  {
    match: /Add these two acceptance criteria:\s*1\.\s*([^\n]+)\s*2\.\s*([^\n]+)\s*Use add_criterion for each\./i,
    tools: [
      { name: 'add_criterion', arguments: { id: 'criterion-1', description: '$1' } },
      { name: 'add_criterion', arguments: { id: 'criterion-2', description: '$2' } },
    ],
    response: 'Added both criteria.',
  },
  {
    match: /Add these two acceptance criteria:[\s\S]*?1\.\s*([^\n]+)[\s\S]*?2\.\s*([^\n]+)[\s\S]*?Use add_criterion for each one\./i,
    tools: [
      { name: 'add_criterion', arguments: { id: 'criterion-1', description: '$1' } },
      { name: 'add_criterion', arguments: { id: 'criterion-2', description: '$2' } },
    ],
    response: 'Added both criteria.',
  },
  {
    match: /Add criterion:\s*([\s\S]+?)\s*Use add_criterion\.?/i,
    tools: [{ name: 'add_criterion', arguments: { id: '$auto', description: '$1' } }],
    response: 'Added the criterion.',
  },
  // Single criterion: ID "test-1": "The tests pass" (colon format)
  {
    match: /ID\s*["']([a-z0-9-]+)["']\s*:\s*["']([^"']+)["']/i,
    tools: [{ name: 'add_criterion', arguments: { id: '$1', description: '$2' } }],
    response: 'Added the criterion.',
  },
  // complete_criterion to mark "id" as done
  {
    match: /complete_criterion.*mark\s*["']([a-z0-9-]+)["']/i,
    tools: [{ name: 'complete_criterion', arguments: { id: '$1', reason: 'Completed successfully' } }],
    response: 'Marked criterion as complete.',
  },
  // complete_criterion with ID
  {
    match: /complete_criterion.*["']([a-z0-9-]+)["']/i,
    tools: [{ name: 'complete_criterion', arguments: { id: '$1', reason: 'Completed successfully' } }],
    response: 'Marked criterion as complete.',
  },
  // remove_criterion to remove "id"
  {
    match: /remove_criterion.*remove\s*["']([a-z0-9-]+)["']/i,
    tools: [{ name: 'remove_criterion', arguments: { id: '$1' } }],
    response: 'Removed the criterion.',
  },
  // remove_criterion with ID
  {
    match: /remove_criterion.*["']([a-z0-9-]+)["']/i,
    tools: [{ name: 'remove_criterion', arguments: { id: '$1' } }],
    response: 'Removed the criterion.',
  },
  // update_criterion to change "id" description to "new"
  {
    match: /update_criterion.*change\s*["']([a-z0-9-]+)["'].*to\s*["']([^"']+)["']/i,
    tools: [{ name: 'update_criterion', arguments: { id: '$1', description: '$2' } }],
    response: 'Updated the criterion.',
  },
  // update_criterion with ID and description
  {
    match: /update_criterion.*["']([a-z0-9-]+)["'].*["']([^"']+)["']/i,
    tools: [{ name: 'update_criterion', arguments: { id: '$1', description: '$2' } }],
    response: 'Updated the criterion.',
  },
  // get_criteria
  {
    match: /get_criteria/i,
    tools: [{ name: 'get_criteria', arguments: {} }],
    response: 'Here are the current criteria.',
  },
  // Generic add criterion (fallback)
  {
    match: /add.*criterion/i,
    tools: [{ name: 'add_criterion', arguments: { id: '$auto', description: 'Test criterion' } }],
    response: 'Added the criterion.',
  },

  // -------------------------------------------------------------------------
  // File Read Tools
  // -------------------------------------------------------------------------
  {
    match: /read.*src\/math\.ts.*offset|offset.*src\/math\.ts/i,
    tools: [{ name: 'read_file', arguments: { path: 'src/math.ts', offset: 5 } }],
    response: 'Read the file starting from line 5.',
  },
  {
    match: /read.*src\/math\.ts.*limit|limit.*src\/math\.ts|first.*lines.*src\/math\.ts/i,
    tools: [{ name: 'read_file', arguments: { path: 'src/math.ts', limit: 3 } }],
    response: 'Read the first 3 lines of the file.',
  },
  {
    match: /read.*src.*directory|read the src directory/i,
    tools: [{ name: 'read_file', arguments: { path: 'src' } }],
    response: 'Listed directory contents.',
  },
  {
    match: /read.*src\/nonexistent|nonexistent.*does not exist/i,
    tools: [{ name: 'read_file', arguments: { path: 'src/nonexistent.ts' } }],
    response: 'Attempted to read the file.',
  },
  {
    match: /read.*src\/index\.ts/i,
    tools: [{ name: 'read_file', arguments: { path: 'src/index.ts' } }],
    response: 'Read the file contents.',
  },
  {
    match: /read.*src\/math\.ts/i,
    tools: [{ name: 'read_file', arguments: { path: 'src/math.ts' } }],
    response: 'Read the file contents.',
  },
  {
    match: /read.*src\/multi\.ts/i,
    tools: [{ name: 'read_file', arguments: { path: 'src/multi.ts' } }],
    response: 'Read the file contents.',
  },
  {
    match: /read.*package\.json/i,
    tools: [{ name: 'read_file', arguments: { path: 'package.json' } }],
    response: 'Read package.json.',
  },
  {
    match: /read.*file/i,
    tools: [{ name: 'read_file', arguments: { path: 'src/index.ts' } }],
    response: 'Read the file.',
  },

  // -------------------------------------------------------------------------
  // Glob Tool
  // -------------------------------------------------------------------------
  {
    match: /glob.*\*\*\/\*\.ts|recursive.*typescript/i,
    tools: [{ name: 'glob', arguments: { pattern: '**/*.ts' } }],
    response: 'Found TypeScript files recursively.',
  },
  {
    match: /glob.*\*\.xyz|no matches/i,
    tools: [{ name: 'glob', arguments: { pattern: '*.xyz' } }],
    response: 'No files matched the pattern.',
  },
  {
    match: /glob.*\.ts|find.*typescript|find all.*\.ts/i,
    tools: [{ name: 'glob', arguments: { pattern: '**/*.ts' } }],
    response: 'Found TypeScript files.',
  },
  {
    match: /glob|find.*file/i,
    tools: [{ name: 'glob', arguments: { pattern: '**/*' } }],
    response: 'Found files.',
  },

  // -------------------------------------------------------------------------
  // Grep Tool
  // -------------------------------------------------------------------------
  {
    match: /grep.*XYZNONEXISTENT|search.*XYZNONEXISTENT/i,
    tools: [{ name: 'grep', arguments: { pattern: 'XYZNONEXISTENT123', path: '.' } }],
    response: 'No matches found.',
  },
  {
    match: /grep.*regex.*function\\s/i,
    tools: [{ name: 'grep', arguments: { pattern: 'function\\s+\\w+', path: '.' } }],
    response: 'Found function declarations.',
  },
  {
    match: /grep.*export.*\*\.ts|search.*export.*typescript/i,
    tools: [{ name: 'grep', arguments: { pattern: 'export', path: '.', include: '*.ts' } }],
    response: 'Found exports in TypeScript files.',
  },
  {
    match: /grep.*function|search.*function/i,
    tools: [{ name: 'grep', arguments: { pattern: 'function', path: '.' } }],
    response: 'Found function occurrences.',
  },
  {
    match: /grep|search/i,
    tools: [{ name: 'grep', arguments: { pattern: 'export', path: '.' } }],
    response: 'Searched for pattern.',
  },

  // -------------------------------------------------------------------------
  // Write Tool
  // -------------------------------------------------------------------------
  // Path security test rules - writing outside /tmp (requires confirmation)
  {
    match: /write.*\/home\/test\/approved/i,
    tools: [{ name: 'write_file', arguments: { path: '/home/test/approved.txt', content: 'approved' } }],
    response: 'Wrote to the approved path.',
  },
  {
    match: /write.*\/home\/test\/denied/i,
    tools: [{ name: 'write_file', arguments: { path: '/home/test/denied.txt', content: 'denied' } }],
    response: 'Wrote to the denied path.',
  },
  {
    match: /write.*\/home\/test\/first/i,
    tools: [{ name: 'write_file', arguments: { path: '/home/test/first.txt', content: 'first' } }],
    response: 'Wrote the first file.',
  },
  {
    match: /write.*\/home\/test\/second/i,
    tools: [{ name: 'write_file', arguments: { path: '/home/test/second.txt', content: 'second' } }],
    response: 'Wrote the second file.',
  },
  {
    match: /write.*\/home\/test\/secret/i,
    tools: [{ name: 'write_file', arguments: { path: '/home/test/secret.txt', content: 'secret' } }],
    response: 'Wrote to home.',
  },
  {
    match: /without reading.*write|write.*without reading/i,
    tools: [{ name: 'write_file', arguments: { path: 'src/index.ts', content: 'new content' } }],
    response: 'Attempted to write without reading first.',
  },
  {
    match: /create.*deep\/nested|nested.*path.*file/i,
    tools: [{ name: 'write_file', arguments: { path: 'deep/nested/path/file.ts', content: 'export const x = 1' } }],
    response: 'Created file in nested directory.',
  },
  {
    match: /create.*src\/newfile\.ts.*greeting/i,
    tools: [{ name: 'write_file', arguments: { path: 'src/newfile.ts', content: 'export const greeting = "hello"' } }],
    response: 'Created the new file.',
  },
  {
    match: /create.*src\/utils\.ts.*greet/i,
    tools: [{ name: 'write_file', arguments: { path: 'src/utils.ts', content: 'export function greet() { return "Hello!" }' } }],
    response: 'Created utils.ts with greet function.',
  },
  {
    match: /create.*src\/new\.ts/i,
    tools: [{ name: 'write_file', arguments: { path: 'src/new.ts', content: 'export const x = 1' } }],
    response: 'Created the file.',
  },
  {
    match: /write.*src\/newfile\.ts/i,
    tools: [{ name: 'write_file', arguments: { path: 'src/newfile.ts', content: 'export const x = 1' } }],
    response: 'Wrote to file.',
  },
  {
    match: /create.*file|write.*file/i,
    tools: [{ name: 'write_file', arguments: { path: 'src/newfile.ts', content: 'export const x = 1' } }],
    response: 'Created file.',
  },

  // -------------------------------------------------------------------------
  // Edit Tool
  // -------------------------------------------------------------------------
  {
    match: /without reading.*edit_file|edit_file.*without reading/i,
    tools: [{ name: 'edit_file', arguments: { path: 'src/math.ts', old_string: 'function', new_string: 'const' } }],
    response: 'Attempted to edit without reading first.',
  },
  {
    match: /edit_file.*replaceAll.*const.*let/i,
    tools: [
      { name: 'read_file', arguments: { path: 'src/multi.ts' } },
      { name: 'edit_file', arguments: { path: 'src/multi.ts', old_string: 'const', new_string: 'let', replaceAll: true } },
    ],
    response: 'Replaced all occurrences.',
  },
  {
    match: /edit_file.*NONEXISTENT_STRING/i,
    tools: [
      { name: 'read_file', arguments: { path: 'src/math.ts' } },
      { name: 'edit_file', arguments: { path: 'src/math.ts', old_string: 'NONEXISTENT_STRING_XYZ', new_string: 'replacement' } },
    ],
    response: 'Attempted to edit with non-existent string.',
  },
  {
    match: /edit_file.*add.*sum/i,
    tools: [
      { name: 'read_file', arguments: { path: 'src/math.ts' } },
      { name: 'edit_file', arguments: { path: 'src/math.ts', old_string: 'add', new_string: 'sum' } },
    ],
    response: 'Renamed function from add to sum.',
  },
  {
    match: /edit_file|edit.*file/i,
    tools: [
      { name: 'read_file', arguments: { path: 'src/math.ts' } },
      { name: 'edit_file', arguments: { path: 'src/math.ts', old_string: 'function', new_string: 'const' } },
    ],
    response: 'Edited the file.',
  },

  // -------------------------------------------------------------------------
  // Shell/Command Tool
  // -------------------------------------------------------------------------
  {
    match: /run.*echo.*first.*sleep.*second/i,
    tools: [{ name: 'run_command', arguments: { command: 'echo "first" && sleep 0.2 && echo "second"' } }],
    response: 'Executed the command sequence.',
  },
  {
    match: /run.*echo.*stdout.*stderr/i,
    tools: [{ name: 'run_command', arguments: { command: 'echo "stdout" && echo "stderr" >&2' } }],
    response: 'Executed command with stdout and stderr.',
  },
  {
    match: /run.*echo.*streaming/i,
    tools: [{ name: 'run_command', arguments: { command: 'echo "streaming test output"' } }],
    response: 'Executed streaming command.',
  },
  {
    match: /run.*echo.*Hello World/i,
    tools: [{ name: 'run_command', arguments: { command: 'echo "Hello World"' } }],
    response: 'Executed echo command.',
  },
  {
    match: /run.*cat.*package\.json/i,
    tools: [{ name: 'run_command', arguments: { command: 'cat package.json' } }],
    response: 'Displayed package.json contents.',
  },
  {
    match: /run.*cat.*nonexistent/i,
    tools: [{ name: 'run_command', arguments: { command: 'cat nonexistent-file-xyz.txt' } }],
    response: 'Attempted to read non-existent file.',
  },
  {
    match: /run.*find\s*\./i,
    tools: [{ name: 'run_command', arguments: { command: 'find .' } }],
    response: 'Listed all files.',
  },
  {
    match: /run.*ls.*workdir.*src|ls.*src.*workdir/i,
    tools: [{ name: 'run_command', arguments: { command: 'ls', cwd: 'src' } }],
    response: 'Listed src directory.',
  },
  {
    match: /run.*ls.*-la.*src/i,
    tools: [{ name: 'run_command', arguments: { command: 'ls -la src' } }],
    response: 'Listed src directory with details.',
  },
  {
    match: /run.*ls.*nonexistent/i,
    tools: [{ name: 'run_command', arguments: { command: 'ls /nonexistent/path/xyz' } }],
    response: 'Attempted to list non-existent path.',
  },
  {
    match: /run.*npm.*--version/i,
    tools: [{ name: 'run_command', arguments: { command: 'npm --version' } }],
    response: 'Checked npm version.',
  },
  {
    match: /run.*pwd.*ls/i,
    tools: [
      { name: 'run_command', arguments: { command: 'pwd' } },
      { name: 'run_command', arguments: { command: 'ls src' } },
    ],
    response: 'Executed pwd and ls.',
  },
  {
    match: /run.*ls.*src/i,
    tools: [{ name: 'run_command', arguments: { command: 'ls src' } }],
    response: 'Listed src directory.',
  },
  {
    match: /run.*ls|list.*files/i,
    tools: [{ name: 'run_command', arguments: { command: 'ls' } }],
    response: 'Listed directory contents.',
  },
  {
    match: /run.*command|execute/i,
    tools: [{ name: 'run_command', arguments: { command: 'echo "test"' } }],
    response: 'Executed the command.',
  },

  // -------------------------------------------------------------------------
  // Todo Tool
  // -------------------------------------------------------------------------
  {
    match: /todo_write.*Read files.*Make changes/i,
    tools: [{
      name: 'todo_write',
      arguments: {
        todos: [
          { content: 'Read files', status: 'in_progress', priority: 'high' },
          { content: 'Make changes', status: 'pending', priority: 'medium' },
        ],
      },
    }],
    response: 'Created todo list.',
  },
  {
    match: /todo_write|todo.*list/i,
    tools: [{
      name: 'todo_write',
      arguments: {
        todos: [{ content: 'Test task', status: 'pending', priority: 'medium' }],
      },
    }],
    response: 'Created todo list.',
  },

  // -------------------------------------------------------------------------
  // Mode/Context
  // -------------------------------------------------------------------------
  {
    match: /think.*step.*step/i,
    tools: [],
    response: 'Let me think step by step about this problem. First, I need to understand the requirements. Then I can propose a solution.',
  },
  {
    match: /long.*explanation|detailed.*explanation/i,
    tools: [],
    response: 'Here is a detailed explanation of the topic. TypeScript is a statically typed superset of JavaScript that adds optional type annotations. It provides better tooling, catches errors at compile time, and makes code more maintainable.',
  },

  // -------------------------------------------------------------------------
  // Default Responses (no tools)
  // -------------------------------------------------------------------------
  {
    match: /hello|hi there|introduce yourself/i,
    tools: [],
    response: 'Hello! I am your coding assistant. How can I help you today?',
  },
  {
    match: /magic word/i,
    tools: [],
    response: 'The magic word is "please".',
  },
  {
    match: /what.*files.*project/i,
    tools: [{ name: 'glob', arguments: { pattern: '**/*' } }],
    response: 'Let me list the project files.',
  },
  {
    match: /what.*guidelines/i,
    tools: [{ name: 'read_file', arguments: { path: 'AGENTS.md' } }],
    response: 'Let me check the guidelines.',
  },
  {
    match: /typescript|features/i,
    tools: [],
    response: 'TypeScript is a strongly typed programming language that builds on JavaScript.',
  },

  // -------------------------------------------------------------------------
  // Fallback
  // -------------------------------------------------------------------------
  {
    match: /.*/,
    tools: [],
    response: 'I understand. Let me help you with that.',
  },
]

// ============================================================================
// Rule Matching
// ============================================================================

function matchRule(prompt: string): { rule: MockRule; captures: string[] } {
  for (const rule of RULES) {
    const match = prompt.match(rule.match)
    if (match) {
      return { rule, captures: match.slice(1) }
    }
  }
  // Should never reach here due to fallback rule
  return { rule: RULES[RULES.length - 1]!, captures: [] }
}

function applyCaptures(args: Record<string, unknown>, captures: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.startsWith('$')) {
      if (value === '$auto') {
        // Generate unique ID using timestamp
        result[key] = `auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      } else {
        const idx = parseInt(value.slice(1), 10) - 1
        result[key] = captures[idx] ?? value
      }
    } else {
      result[key] = value
    }
  }
  return result
}

function getLastUserPrompt(request: LLMCompletionRequest): string {
  const stripRuntimeReminders = (content: string): string => {
    return content.replace(/\n*<system-reminder>[\s\S]*<\/system-reminder>\s*/gi, '').trim()
  }

  const userMessages = request.messages.filter(message => message.role === 'user')
  const latestUserMessage = userMessages.at(-1)
  if (!latestUserMessage) {
    return ''
  }

  const isRuntimeReminder = (content: string): boolean => {
    return /<system-reminder>[\s\S]*<\/system-reminder>/i.test(content)
  }

  const isBuilderKickoff = (content: string): boolean => {
    return /Implement the task and make sure you fulfil the \d+ criteria\./i.test(content)
  }

  const isSummaryPrompt = (content: string): boolean => {
    return /Write a 2-3 sentence summary of what the user wants to accomplish\./i.test(content)
  }

  const isCompactionPrompt = (content: string): boolean => {
    return /Summarize the conversation history concisely/i.test(content)
  }

  const isWaitingPrompt = (content: string): boolean => {
    return /Waiting for user input/i.test(content)
  }

  const isXmlCorrectionPrompt = (content: string): boolean => {
    return /IMPORTANT: You used XML tags/i.test(content)
  }

  const isVerifierKickoff = (content: string): boolean => {
    return /Verify each criterion marked \[NEEDS VERIFICATION\]\./i.test(content)
  }

  const isAutoPrompt = (content: string): boolean => {
    const strippedContent = stripRuntimeReminders(content)

    return (
      (isRuntimeReminder(content) && strippedContent.length === 0) ||
      isBuilderKickoff(strippedContent) ||
      isSummaryPrompt(strippedContent) ||
      isCompactionPrompt(strippedContent) ||
      isWaitingPrompt(strippedContent) ||
      isXmlCorrectionPrompt(strippedContent) ||
      isVerifierKickoff(strippedContent)
    )
  }

  const latestPrompt = stripRuntimeReminders(latestUserMessage.content)

  if (isVerifierKickoff(latestPrompt)) {
    return latestPrompt
  }

  if (
    isBuilderKickoff(latestPrompt)
    || isSummaryPrompt(latestPrompt)
    || isCompactionPrompt(latestPrompt)
    || isWaitingPrompt(latestPrompt)
    || isXmlCorrectionPrompt(latestPrompt)
  ) {
    return latestPrompt
  }

  if (!isAutoPrompt(latestUserMessage.content)) {
    return latestPrompt
  }

  for (let i = userMessages.length - 2; i >= 0; i--) {
    const message = userMessages[i]!
    if (!isAutoPrompt(message.content)) {
      return stripRuntimeReminders(message.content)
    }
  }

  return latestPrompt
}

function getConversationText(request: LLMCompletionRequest): string {
  return request.messages.map(message => message.content).join('\n\n')
}

function getInstructionAwareResponse(request: LLMCompletionRequest): string | null {
  const prompt = getLastUserPrompt(request)
  const conversationText = getConversationText(request)
  const previousUserPrompts = request.messages
    .filter(message => message.role === 'user')
    .slice(0, -1)
    .map(message => message.content)

  const projectName = [...previousUserPrompts]
    .reverse()
    .map(content => content.match(/project name is ["']([^"']+)["']/i)?.[1])
    .find((value): value is string => Boolean(value))

  if (/Generate a concise, descriptive session name/i.test(prompt)) {
    const userMessage = prompt.match(/User message:\s*([\s\S]+)$/i)?.[1]?.trim()
    if (!userMessage) {
      return 'New session'
    }

    if (/react/i.test(userMessage) && /typescript/i.test(userMessage)) {
      return 'React TypeScript setup'
    }
    if (/authentication bug/i.test(userMessage)) {
      return 'Fix authentication bug'
    }
    if (/unit tests/i.test(userMessage) && /api/i.test(userMessage)) {
      return 'Add API unit tests'
    }
    if (/oauth2/i.test(userMessage) && /jwt/i.test(userMessage)) {
      return 'OAuth2 JWT auth'
    }

    const words = userMessage
      .replace(/[^a-z0-9\s]/gi, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 6)
    return words.length > 0 ? words.join(' ') : 'New session'
  }

  if (/what did i say the project name was\??/i.test(prompt) && projectName) {
    return `You said the project name was ${projectName}.`
  }

  if (/what guidelines should i follow\??/i.test(prompt)) {
    return 'Follow the function, test, TDD, and style guidelines.'
  }

  if (/hello there!?/i.test(prompt) && conversationText.includes('CUSTOM_MARKER')) {
    return 'ACKNOWLEDGED. Hello there!'
  }

  if (/what is the magic word\??/i.test(prompt) && conversationText.includes('ABRACADABRA')) {
    return 'The magic word is ABRACADABRA.'
  }

  if (/say hello briefly\.?/i.test(prompt) && conversationText.includes('GLOBAL_MARKER')) {
    return 'Hello. [DONE]'
  }

  if (/what should you say now\??/i.test(prompt) && conversationText.includes('Updated instruction: say UPDATED')) {
    return 'UPDATED'
  }

  if (/what should you say\??/i.test(prompt) && conversationText.includes('Original instruction: say ORIGINAL')) {
    return 'ORIGINAL'
  }

  return null
}

function getPromptAwareToolResponse(prompt: string): MockMatchResult | null {
  const exactCommandMatch = prompt.match(/Run the exact command:\s*(.+)$/i) ?? prompt.match(/^Run exactly:\s*(.+)$/i)
  const quotedValues = [...prompt.matchAll(/"([^"]+)"/g)].map(match => match[1]!)

  if (/Use the todo_write tool to create a todo list with 2 items/i.test(prompt)) {
    return {
      tools: [{
        name: 'todo_write',
        arguments: {
          todos: [
            { content: 'Read files', status: 'in_progress', priority: 'high' },
            { content: 'Make changes', status: 'pending', priority: 'medium' },
          ],
        },
      }],
      response: 'Created todo list.',
    }
  }

  if (/Create the file src\/utils\.ts with any content, then call complete_criterion/i.test(prompt)) {
    return {
      tools: [
        { name: 'write_file', arguments: { path: 'src/utils.ts', content: 'export const created = true' } },
        { name: 'complete_criterion', arguments: { id: 'file-created', reason: 'Created the requested file' } },
      ],
      response: 'Created the file and completed the criterion.',
    }
  }

  if (/Create a new file called src\/utils\.ts/i.test(prompt)) {
    return {
      tools: [{ name: 'write_file', arguments: { path: 'src/utils.ts', content: 'export function greet() { return "Hello!" }' } }],
      response: 'Created src/utils.ts.',
    }
  }

  if (/Create a new file at src\/newfile\.ts/i.test(prompt)) {
    return {
      tools: [{ name: 'write_file', arguments: { path: 'src/newfile.ts', content: 'export const greeting = "hello"' } }],
      response: 'Created src/newfile.ts.',
    }
  }

  if (/Create a file at deep\/nested\/path\/file\.ts/i.test(prompt)) {
    return {
      tools: [{ name: 'write_file', arguments: { path: 'deep/nested/path/file.ts', content: 'export const x = 1' } }],
      response: 'Created nested file.',
    }
  }

  if (/Read src\/math\.ts, then use edit_file/i.test(prompt) && quotedValues.length >= 2) {
    return {
      tools: [
        { name: 'read_file', arguments: { path: 'src/math.ts' } },
        { name: 'edit_file', arguments: { path: 'src/math.ts', old_string: quotedValues[0], new_string: quotedValues[1] } },
      ],
      response: 'Updated src/math.ts.',
    }
  }

  if (prompt.includes('workdir parameter') && prompt.includes('src directory')) {
    return {
      tools: [{ name: 'run_command', arguments: { command: 'ls', cwd: 'src' } }],
      response: 'Listed src directory.',
    }
  }

  if (/Run the command "ls src" to list files in src directory/i.test(prompt)) {
    return {
      tools: [{ name: 'run_command', arguments: { command: 'ls src' } }],
      response: 'Listed src files.',
    }
  }

  if (/Run the command "ls" to list files in the current directory/i.test(prompt)) {
    return {
      tools: [{ name: 'run_command', arguments: { command: 'ls' } }],
      response: 'Listed current directory.',
    }
  }

  if (/Run the command "ls \/nonexistent\/path\/xyz"/i.test(prompt)) {
    return {
      tools: [{ name: 'run_command', arguments: { command: 'ls nonexistent-path-xyz' } }],
      response: 'Ran the failing command.',
    }
  }

  if (exactCommandMatch) {
    return {
      tools: [{ name: 'run_command', arguments: { command: exactCommandMatch[1]!.trim() } }],
      response: 'Ran the exact command.',
    }
  }

  if (/^Run "/i.test(prompt)) {
    const commands = quotedValues
    if (/and then run/i.test(prompt) && commands.length >= 2) {
      return {
        tools: commands.slice(0, 2).map(command => ({ name: 'run_command', arguments: { command } })),
        response: 'Ran both commands.',
      }
    }

    if (commands.length >= 1) {
      return {
        tools: [{ name: 'run_command', arguments: { command: commands[0] } }],
        response: 'Ran the command.',
      }
    }
  }

  return null
}

function getConversationAwareToolResponse(request: LLMCompletionRequest): MockMatchResult | null {
  const prompt = getLastUserPrompt(request)
  const conversationText = getConversationText(request)

  if (/Implement the task and make sure you fulfil the \d+ criteria\./i.test(prompt)) {
    if (conversationText.includes('inspect-src')) {
      return {
        tools: [
          { name: 'read_file', arguments: { path: 'src' } },
          { name: 'complete_criterion', arguments: { id: 'inspect-src', reason: 'Inspected the src directory and reported what exists' } },
        ],
        response: 'Inspected the src directory and completed the criterion.',
      }
    }

    if (conversationText.includes('trivial-pass')) {
      return {
        tools: [{ name: 'complete_criterion', arguments: { id: 'trivial-pass', reason: 'Trivial criterion passes immediately' } }],
        response: 'Completed the trivial criterion.',
      }
    }

    if (conversationText.includes('verify-fail')) {
      return {
        tools: [{ name: 'complete_criterion', arguments: { id: 'verify-fail', reason: 'Prepared criterion for verification' } }],
        response: 'Completed the criterion for verification.',
      }
    }

    if (conversationText.includes('file-created')) {
      return {
        tools: [
          { name: 'write_file', arguments: { path: 'src/utils.ts', content: 'export const created = true' } },
          { name: 'complete_criterion', arguments: { id: 'file-created', reason: 'Created the requested file' } },
        ],
        response: 'Created the file and completed the criterion.',
      }
    }
  }

  if (/Verify each criterion marked \[NEEDS VERIFICATION\]\./i.test(prompt)) {
    if (conversationText.includes('trivial-pass')) {
      return {
        tools: [{ name: 'pass_criterion', arguments: { id: 'trivial-pass', reason: 'Verified successfully' } }],
        response: 'Verified the trivial criterion.',
      }
    }

    if (conversationText.includes('verify-fail')) {
      return {
        tools: [{ name: 'fail_criterion', arguments: { id: 'verify-fail', reason: 'Verification fails intentionally for this criterion' } }],
        response: 'Failed the verification criterion.',
      }
    }

    if (conversationText.includes('file-created')) {
      return {
        tools: [{ name: 'pass_criterion', arguments: { id: 'file-created', reason: 'Verified the file was created successfully' } }],
        response: 'Verified the created file criterion.',
      }
    }

    if (conversationText.includes('impossible/path')) {
      return {
        tools: [{ name: 'fail_criterion', arguments: { id: 'auto-impossible', reason: 'Impossible path does not exist' } }],
        response: 'Failed the impossible criterion.',
      }
    }
  }

  return null
}

function getToolFollowUpResponse(request: LLMCompletionRequest): string {
  const prompt = getLastUserPrompt(request)

  if (/what guidelines should i follow\??/i.test(prompt)) {
    return 'Follow the function, test, TDD, and style guidelines.'
  }

  if (/read the package\.json file and tell me the project name\.?/i.test(prompt)) {
    return 'The project name is test-project.'
  }

  if (/read package\.json and tell me the project version\.?/i.test(prompt)) {
    return 'The project version is 1.0.0.'
  }

  if (/read package\.json and summarize it\.?/i.test(prompt)) {
    return 'The package defines test-project version 1.0.0 with TypeScript build and test scripts.'
  }

  return 'Done.'
}

function isSlowStreamingPrompt(prompt: string): boolean {
  return /long.*explanation|detailed.*explanation/i.test(prompt)
}

function buildMockResponse(request: LLMCompletionRequest): {
  content: string
  toolCalls: ToolCall[]
  finishReason: LLMCompletionResponse['finishReason']
} {
  const lastMsg = request.messages[request.messages.length - 1]
  if (lastMsg?.role === 'tool') {
    return {
      content: getToolFollowUpResponse(request),
      toolCalls: [],
      finishReason: 'stop',
    }
  }

  const instructionAwareResponse = getInstructionAwareResponse(request)
  if (instructionAwareResponse) {
    return {
      content: instructionAwareResponse,
      toolCalls: [],
      finishReason: 'stop',
    }
  }

  const prompt = getLastUserPrompt(request)
  const conversationAwareToolResponse = getConversationAwareToolResponse(request)
  if (conversationAwareToolResponse) {
    const toolCalls: ToolCall[] = conversationAwareToolResponse.tools.map((tool, index) => ({
      id: `mock-${Date.now()}-${index}`,
      name: tool.name,
      arguments: tool.arguments,
    }))

    return {
      content: conversationAwareToolResponse.response,
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    }
  }

  const promptAwareToolResponse = getPromptAwareToolResponse(prompt)
  if (promptAwareToolResponse) {
    const toolCalls: ToolCall[] = promptAwareToolResponse.tools.map((tool, index) => ({
      id: `mock-${Date.now()}-${index}`,
      name: tool.name,
      arguments: tool.arguments,
    }))

    return {
      content: promptAwareToolResponse.response,
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    }
  }

  const { rule, captures } = matchRule(prompt)
  const toolCalls: ToolCall[] = rule.tools.map((tool, index) => ({
    id: `mock-${Date.now()}-${index}`,
    name: tool.name,
    arguments: applyCaptures(tool.arguments, captures),
  }))

  return {
    content: rule.response,
    toolCalls,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
  }
}

// ============================================================================
// Mock LLM Client
// ============================================================================

export function createMockLLMClient(): LLMClientWithModel {
  const model = process.env['OPENFOX_MODEL_NAME'] ?? 'mock-model'
  const profile = getModelProfile(model)
  let backend: Backend = 'unknown'

  return {
    getModel: () => model,
    setModel: () => {},
    getProfile: () => profile,
    getBackend: () => backend,
    setBackend: (b: Backend) => { backend = b },

    async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
      const prompt = getLastUserPrompt(request)

      if (request.signal?.aborted) throw new Error('Aborted')
      const response = buildMockResponse(request)

      if (process.env['OPENFOX_TEST_VERBOSE'] === 'true') {
        console.error(`[MockLLM] "${prompt.slice(0, 50)}..." → ${response.toolCalls.length > 0 ? response.toolCalls.map(toolCall => toolCall.name).join(', ') : 'text'}`)
      }

      return {
        id: `mock-${Date.now()}`,
        content: response.content,
        thinkingContent: '',
        toolCalls: response.toolCalls,
        finishReason: response.finishReason,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }
    },

    async *stream(request: LLMCompletionRequest): AsyncIterable<LLMStreamEvent> {
      const prompt = getLastUserPrompt(request)

      if (request.signal?.aborted) throw new Error('Aborted')
      const response = buildMockResponse(request)

      if (process.env['OPENFOX_TEST_VERBOSE'] === 'true') {
        console.error(`[MockLLM] "${prompt.slice(0, 50)}..." → ${response.toolCalls.length > 0 ? response.toolCalls.map(toolCall => toolCall.name).join(', ') : 'text'}`)
      }

      // Stream tool calls
      for (let i = 0; i < response.toolCalls.length; i++) {
        const tc = response.toolCalls[i]!
        yield { type: 'tool_call_delta', index: i, id: tc.id, name: tc.name, arguments: JSON.stringify(tc.arguments) }
      }

      // Stream text response
      const words = response.content.split(' ')
      const slowStreaming = isSlowStreamingPrompt(prompt)
      for (const word of words) {
        yield { type: 'text_delta', content: word + ' ' }
        if (slowStreaming) {
          await sleep(20)
        }
      }

      // Done
      yield {
        type: 'done',
        response: {
          id: `mock-${Date.now()}`,
          content: response.content,
          thinkingContent: '',
          toolCalls: response.toolCalls,
          finishReason: response.finishReason,
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        },
      }
    },
  }
}
