/* jscpd:ignore-start */
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
import { logger } from '../utils/logger.js'
import { RULES, type MockToolCall, type MockRule } from './mock-rules.js'

interface MockMatchResult {
  tools: MockToolCall[]
  response: string
}

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

  const userMessages = request.messages.filter((message) => message.role === 'user')
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
    isBuilderKickoff(latestPrompt) ||
    isSummaryPrompt(latestPrompt) ||
    isCompactionPrompt(latestPrompt) ||
    isWaitingPrompt(latestPrompt) ||
    isXmlCorrectionPrompt(latestPrompt)
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
  return request.messages.map((message) => message.content).join('\n\n')
}

function getInstructionAwareResponse(request: LLMCompletionRequest): string | null {
  const prompt = getLastUserPrompt(request)
  const conversationText = getConversationText(request)
  const previousUserPrompts = request.messages
    .filter((message) => message.role === 'user')
    .slice(0, -1)
    .map((message) => message.content)

  const projectName = [...previousUserPrompts]
    .reverse()
    .map((content) => content.match(/project name is ["']([^"']+)["']/i)?.[1])
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
  const quotedValues = [...prompt.matchAll(/"([^"]+)"/g)].map((match) => match[1]!)

  if (/Use the session_metadata tool with key.*todos.*to create a todo list/i.test(prompt)) {
    return {
      tools: [
        {
          name: 'session_metadata',
          arguments: {
            action: 'add',
            key: 'todos',
            description: 'Read files',
          },
        },
        {
          name: 'session_metadata',
          arguments: {
            action: 'add',
            key: 'todos',
            description: 'Make changes',
          },
        },
      ],
      response: 'Created todo list.',
    }
  }

  if (/Use the todo_write tool to create a todo list with 2 items/i.test(prompt)) {
    return {
      tools: [
        {
          name: 'session_metadata',
          arguments: {
            action: 'add',
            key: 'todos',
            description: 'Read files',
          },
        },
        {
          name: 'session_metadata',
          arguments: {
            action: 'add',
            key: 'todos',
            description: 'Make changes',
          },
        },
      ],
      response: 'Created todo list.',
    }
  }

  if (
    /First call get_criteria to see what needs to be done, then create src\/test\.ts and call session_metadata to mark criteria as completed for ["']test-file["']\./i.test(
      prompt,
    )
  ) {
    return {
      tools: [
        { name: 'session_metadata', arguments: { action: 'get', key: 'criteria' } },
        { name: 'write_file', arguments: { path: 'src/test.ts', content: 'export const created = true' } },
        {
          name: 'session_metadata',
          arguments: {
            action: 'update',
            key: 'criteria',
            status: 'completed',
            id: 'test-file',
            reason: 'Created the requested file',
          },
        },
        { name: 'step_done', arguments: {} },
      ],
      response: 'Reviewed the criteria, created the file, and completed the criterion.',
    }
  }

  if (/Create the file src\/utils\.ts with any content, then call complete_criterion/i.test(prompt)) {
    return {
      tools: [
        { name: 'write_file', arguments: { path: 'src/utils.ts', content: 'export const created = true' } },
        {
          name: 'session_metadata',
          arguments: {
            action: 'update',
            key: 'criteria',
            status: 'completed',
            id: 'file-created',
            reason: 'Created the requested file',
          },
        },
        { name: 'step_done', arguments: {} },
      ],
      response: 'Created the file and completed the criterion.',
    }
  }

  if (/Create a new file called src\/utils\.ts/i.test(prompt)) {
    return {
      tools: [
        {
          name: 'write_file',
          arguments: { path: 'src/utils.ts', content: 'export function greet() { return "Hello!" }' },
        },
      ],
      response: 'Created src/utils.ts.',
    }
  }

  if (/Create a new file at src\/newfile\.ts/i.test(prompt)) {
    return {
      tools: [
        { name: 'write_file', arguments: { path: 'src/newfile.ts', content: 'export const greeting = "hello"' } },
      ],
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
        {
          name: 'edit_file',
          arguments: { path: 'src/math.ts', old_string: quotedValues[0], new_string: quotedValues[1] },
        },
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
        tools: commands.slice(0, 2).map((command) => ({ name: 'run_command', arguments: { command } })),
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

  // Builder workflow: implement criteria and call step_done
  if (
    /Implement the task and make sure you fulfil the \d+ criteria\./i.test(prompt) ||
    /Continue working on the acceptance criteria\./i.test(prompt)
  ) {
    const tools: Array<{ name: string; arguments: Record<string, unknown> }> = []
    const completedCriteria: string[] = []

    if (conversationText.includes('inspect-src')) {
      tools.push(
        { name: 'read_file', arguments: { path: 'src' } },
        {
          name: 'session_metadata',
          arguments: {
            action: 'update',
            key: 'criteria',
            status: 'completed',
            id: 'inspect-src',
            reason: 'Inspected the src directory and reported what exists',
          },
        },
      )
      completedCriteria.push('inspect-src')
    }

    if (conversationText.includes('trivial-pass')) {
      tools.push({
        name: 'session_metadata',
        arguments: {
          action: 'update',
          key: 'criteria',
          status: 'completed',
          id: 'trivial-pass',
          reason: 'Trivial criterion passes immediately',
        },
      })
      completedCriteria.push('trivial-pass')
    }

    if (conversationText.includes('verify-fail')) {
      tools.push({
        name: 'session_metadata',
        arguments: {
          action: 'update',
          key: 'criteria',
          status: 'completed',
          id: 'verify-fail',
          reason: 'Prepared criterion for verification',
        },
      })
      completedCriteria.push('verify-fail')
    }

    if (conversationText.includes('file-created')) {
      tools.push(
        { name: 'write_file', arguments: { path: 'src/utils.ts', content: 'export const created = true' } },
        {
          name: 'session_metadata',
          arguments: {
            action: 'update',
            key: 'criteria',
            status: 'completed',
            id: 'file-created',
            reason: 'Created the requested file',
          },
        },
      )
      completedCriteria.push('file-created')
    }

    // Fallback: if no specific criterion matched, just complete a mock one
    if (tools.length === 0) {
      tools.push({
        name: 'session_metadata',
        arguments: {
          action: 'update',
          key: 'criteria',
          status: 'completed',
          id: 'mock-crit',
          reason: 'Completed for testing',
        },
      })
      completedCriteria.push('mock-crit')
    }

    // Always add step_done at the end to signal workflow step completion
    tools.push({ name: 'step_done', arguments: {} })
    return {
      tools,
      response: `Completed builder work for: ${completedCriteria.join(', ')}.`,
    }
  }

  // Fallback: workflow builder prompts with criteria count should complete and call step_done
  if (/fulfil the \d+ criteria/i.test(prompt)) {
    return {
      tools: [
        {
          name: 'session_metadata',
          arguments: {
            action: 'update',
            key: 'criteria',
            status: 'completed',
            id: 'mock-crit',
            reason: 'Completed for testing',
          },
        },
        { name: 'step_done', arguments: {} },
      ],
      response: 'Completed criterion and finished step.',
    }
  }

  // Builder retry prompts should also call step_done
  if (/Continue working on the acceptance criteria/i.test(prompt)) {
    const tools: Array<{ name: string; arguments: Record<string, unknown> }> = []

    if (conversationText.includes('file-created')) {
      tools.push(
        { name: 'write_file', arguments: { path: 'src/utils.ts', content: 'export const created = true' } },
        {
          name: 'session_metadata',
          arguments: {
            action: 'update',
            key: 'criteria',
            status: 'completed',
            id: 'file-created',
            reason: 'Created the requested file',
          },
        },
      )
    } else if (conversationText.includes('trivial-pass')) {
      tools.push({
        name: 'session_metadata',
        arguments: {
          action: 'update',
          key: 'criteria',
          status: 'completed',
          id: 'trivial-pass',
          reason: 'Trivial criterion passes immediately',
        },
      })
    } else if (conversationText.includes('verify-fail')) {
      // Builder retry after verifier failed - just complete it again
      tools.push({
        name: 'session_metadata',
        arguments: {
          action: 'update',
          key: 'criteria',
          status: 'completed',
          id: 'verify-fail',
          reason: 'Prepared criterion for verification',
        },
      })
    } else {
      // Check prompt for criteria count hint
      if (/1 criteria remaining/i.test(prompt)) {
        tools.push({
          name: 'session_metadata',
          arguments: {
            action: 'update',
            key: 'criteria',
            status: 'completed',
            id: 'trivial-pass',
            reason: 'Trivial criterion passes immediately',
          },
        })
      } else {
        tools.push({
          name: 'session_metadata',
          arguments: {
            action: 'update',
            key: 'criteria',
            status: 'completed',
            id: 'mock-crit',
            reason: 'Completed for testing',
          },
        })
      }
    }

    tools.push({ name: 'step_done', arguments: {} })
    return {
      tools,
      response: 'Completed builder work.',
    }
  }

  if (/Verify each criterion marked \[NEEDS VERIFICATION\]\./i.test(prompt)) {
    // Only return verifier tools on the first call — if we already called pass/fail, stop
    const alreadyVerified = request.messages.some(
      (m) =>
        m.role === 'assistant' &&
        m.toolCalls?.some(
          (tc) =>
            tc.name === 'session_metadata' && (tc.arguments['action'] === 'pass' || tc.arguments['action'] === 'fail'),
        ),
    )
    if (alreadyVerified) {
      return null
    }

    const tools: Array<{ name: string; arguments: Record<string, unknown> }> = []
    const terminalizedCriteria: string[] = []

    if (conversationText.includes('trivial-pass')) {
      tools.push({
        name: 'session_metadata',
        arguments: {
          action: 'update',
          key: 'criteria',
          status: 'passed',
          id: 'trivial-pass',
          reason: 'Verified successfully',
        },
      })
      terminalizedCriteria.push('trivial-pass')
    }

    if (conversationText.includes('inspect-src')) {
      tools.push({
        name: 'session_metadata',
        arguments: {
          action: 'update',
          key: 'criteria',
          status: 'passed',
          id: 'inspect-src',
          reason: 'Verified the src directory was inspected successfully',
        },
      })
      terminalizedCriteria.push('inspect-src')
    }

    if (conversationText.includes('verify-fail')) {
      tools.push({
        name: 'session_metadata',
        arguments: {
          action: 'update',
          key: 'criteria',
          status: 'completed',
          id: 'verify-fail',
          reason: 'Verification fails intentionally for this criterion',
        },
      })
      terminalizedCriteria.push('verify-fail')
    }

    if (conversationText.includes('file-created')) {
      tools.push({
        name: 'session_metadata',
        arguments: {
          action: 'update',
          key: 'criteria',
          status: 'passed',
          id: 'file-created',
          reason: 'Verified the file was created successfully',
        },
      })
      terminalizedCriteria.push('file-created')
    }

    if (conversationText.includes('impossible/path')) {
      tools.push({
        name: 'session_metadata',
        arguments: {
          action: 'update',
          key: 'criteria',
          status: 'completed',
          id: 'auto-impossible',
          reason: 'Impossible path does not exist',
        },
      })
      terminalizedCriteria.push('auto-impossible')
    }

    if (tools.length > 0) {
      tools.push({
        name: 'return_value',
        arguments: { summary: `Terminalized verifier work for: ${terminalizedCriteria.join(', ')}.` },
      })
      return {
        tools,
        response: `Terminalized verifier work for: ${terminalizedCriteria.join(', ')}.`,
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
  // Detect compaction requests: no tools, toolChoice 'none' (summary generation)
  if (request.toolChoice === 'none' && (!request.tools || request.tools.length === 0)) {
    return {
      content:
        'Summary of conversation: The user has been working on the project. Files were modified and progress was made on all tasks. No errors were encountered during the session.',
      toolCalls: [],
      finishReason: 'stop',
    }
  }

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
    setBackend: (b: Backend) => {
      backend = b
    },

    async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
      const prompt = getLastUserPrompt(request)

      if (request.signal?.aborted) throw new Error('Aborted')
      const response = buildMockResponse(request)

      if (process.env['OPENFOX_TEST_VERBOSE'] === 'true') {
        logger.debug('MockLLM completion', {
          prompt: prompt.slice(0, 50),
          hasTools: response.toolCalls.length > 0,
          tools: response.toolCalls.map((tc) => tc.name),
        })
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
        logger.debug('MockLLM stream', {
          prompt: prompt.slice(0, 50),
          hasTools: response.toolCalls.length > 0,
          tools: response.toolCalls.map((tc) => tc.name),
        })
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
/* jscpd:ignore-end */
