import type {
  Attachment,
  InjectedFile,
  PromptContext,
  PromptContextMessage,
  PromptContextTool,
  PromptRequestOptions,
} from '../../shared/types.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { SkillMetadata } from '../skills/types.js'
import type { AgentDefinition } from '../agents/types.js'
import {
  buildTopLevelSystemPrompt,
  buildSubAgentSystemPrompt,
  buildAgentReminder,
} from './prompts.js'

export type RequestContextMessage = PromptContextMessage

export interface BaseAssemblyInput {
  workdir: string
  messages: RequestContextMessage[]
  injectedFiles: InjectedFile[]
  customInstructions?: string
  skills?: SkillMetadata[]
  includeRuntimeReminder?: boolean
  promptTools: LLMToolDefinition[]
  requestTools?: LLMToolDefinition[]
  toolChoice?: PromptRequestOptions['toolChoice']
  disableThinking?: boolean
}

interface AssemblyResult {
  systemPrompt: string
  messages: Array<{
    role: 'user' | 'assistant' | 'tool'
    content: string
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
    toolCallId?: string
    attachments?: Attachment[]
  }>
  promptContext: PromptContext
}

export function createPromptContext(input: {
  systemPrompt: string
  messages: RequestContextMessage[]
  injectedFiles: InjectedFile[]
  requestTools: LLMToolDefinition[]
  toolChoice: PromptRequestOptions['toolChoice']
  disableThinking: boolean
  userMessage?: string
}): PromptContext {
  return {
    systemPrompt: input.systemPrompt,
    injectedFiles: input.injectedFiles,
    userMessage: input.userMessage ?? getTriggerUserMessage(input.messages),
    messages: input.messages.map((message) => ({
      role: message.role,
      content: message.content,
      source: message.source,
      ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      ...(message.attachments ? { attachments: message.attachments } : {}),
    })),
    tools: input.requestTools.map<PromptContextTool>((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    })),
    requestOptions: {
      toolChoice: input.toolChoice,
      disableThinking: input.disableThinking,
    },
  }
}

function createAssemblyResult(input: {
  systemPrompt: string
  messages: RequestContextMessage[]
  runtimeReminder?: string
  injectedFiles: InjectedFile[]
  requestTools: LLMToolDefinition[]
  toolChoice: PromptRequestOptions['toolChoice']
  disableThinking: boolean
}): AssemblyResult {
  const triggerUserMessage = getTriggerUserMessage(input.messages)
  const messages = input.runtimeReminder
    ? injectRuntimeReminder(input.messages, input.runtimeReminder)
    : input.messages

  return {
    systemPrompt: input.systemPrompt,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      ...(message.attachments ? { attachments: message.attachments } : {}),
    })),
    promptContext: createPromptContext({
      ...input,
      messages,
      userMessage: triggerUserMessage,
    }),
  }
}

function injectRuntimeReminder(messages: RequestContextMessage[], runtimeReminder: string): RequestContextMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user' || message.source !== 'history') {
      continue
    }

    return messages.map((entry, entryIndex) => {
      if (entryIndex !== index) {
        return entry
      }

      return {
        ...entry,
        content: `${entry.content}\n\n${runtimeReminder}`,
      }
    })
  }

  return [...messages, { role: 'user', content: runtimeReminder, source: 'runtime' }]
}

function getTriggerUserMessage(messages: RequestContextMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && message.source === 'history') {
      return message.content
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user') {
      return message.content
    }
  }

  return ''
}

// ============================================================================
// Unified Agent Request Assembly
// ============================================================================

export interface AgentAssemblyInput extends BaseAssemblyInput {
  agentDef: AgentDefinition
  subAgentDefs?: AgentDefinition[]
}

/**
 * Unified request assembly for any agent type.
 *
 * Top-level agents (subagent: false):
 *   - System prompt = buildTopLevelSystemPrompt() (shared, cacheable)
 *   - Runtime reminder = agent's prompt body (injected into user message)
 *
 * Sub-agents (subagent: true):
 *   - System prompt = buildSubAgentSystemPrompt() (base + agent body)
 *   - No runtime reminder
 */
export function assembleAgentRequest(input: AgentAssemblyInput): AssemblyResult {
  const { agentDef, subAgentDefs, ...baseInput } = input

  if (agentDef.metadata.subagent) {
    const systemPrompt = buildSubAgentSystemPrompt(
      baseInput.workdir,
      agentDef,
      baseInput.skills,
    )
    return createAssemblyResult({
      systemPrompt,
      messages: baseInput.messages,
      injectedFiles: baseInput.injectedFiles,
      requestTools: baseInput.requestTools ?? baseInput.promptTools,
      toolChoice: baseInput.toolChoice ?? 'auto',
      disableThinking: baseInput.disableThinking ?? false,
    })
  }

  const systemPrompt = buildTopLevelSystemPrompt(
    baseInput.workdir,
    baseInput.customInstructions,
    baseInput.skills,
    subAgentDefs,
  )
  const runtimeReminder = baseInput.includeRuntimeReminder === false
    ? undefined
    : buildAgentReminder(agentDef)

  return createAssemblyResult({
    systemPrompt,
    messages: baseInput.messages,
    ...(runtimeReminder ? { runtimeReminder } : {}),
    injectedFiles: baseInput.injectedFiles,
    requestTools: baseInput.requestTools ?? baseInput.promptTools,
    toolChoice: baseInput.toolChoice ?? 'auto',
    disableThinking: baseInput.disableThinking ?? false,
  })
}
