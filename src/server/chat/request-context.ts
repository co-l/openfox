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
} from './prompts.js'

export type RequestContextMessage = PromptContextMessage

export type MinimalMessage = {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  toolCallId?: string
  attachments?: Attachment[]
}

export function minimalMessagesToRequestContextMessages(messages: MinimalMessage[], source: 'history' | 'runtime' = 'history'): RequestContextMessage[] {
  return messages.map((message) => minimalMessageToRequestContextMessage(message, source))
}

export function minimalMessageToRequestContextMessage(message: MinimalMessage, source: 'history' | 'runtime' = 'history'): RequestContextMessage {
  return {
    role: message.role,
    content: message.content,
    source,
    ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.attachments ? { attachments: message.attachments } : {}),
  }
}

export interface BaseAssemblyInput {
  workdir: string
  messages: RequestContextMessage[]
  injectedFiles: InjectedFile[]
  customInstructions?: string
  skills?: SkillMetadata[]
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

function getTriggerUserMessage(messages: RequestContextMessage[]): string {
  const stripRuntimeReminders = (content: string): string => {
    return content.replace(/\n*<system-reminder>[\s\S]*<\/system-reminder>\s*/gi, '').trim()
  }
  
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && message.source === 'history') {
      const stripped = stripRuntimeReminders(message.content)
      if (stripped) {
        return stripped
      }
    }
  }

  return ''
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
  injectedFiles: InjectedFile[]
  requestTools: LLMToolDefinition[]
  toolChoice: PromptRequestOptions['toolChoice']
  disableThinking: boolean
  customInstructions?: string
  skills?: SkillMetadata[]
}): AssemblyResult {
  const triggerUserMessage = getTriggerUserMessage(input.messages)
  
  // Filter out runtime messages (auto-prompts) from messages sent to LLM
  // These are only for internal tracking, not part of conversation history
  const messagesForLLM = input.messages.filter(m => m.source !== 'runtime')

  return {
    systemPrompt: input.systemPrompt,
    messages: messagesForLLM.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      ...(message.attachments ? { attachments: message.attachments } : {}),
    })),
    promptContext: createPromptContext({
      ...input,
      userMessage: triggerUserMessage,
    }),
  }
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
 *   - Runtime reminder = NOT injected here (injected separately by orchestrator on mode switch only)
 *
 * Sub-agents (subagent: true):
 *   - System prompt = buildSubAgentSystemPrompt() (base + agent body)
 *   - No runtime reminder
 * 
 * NOTE: Runtime reminders are now injected by the orchestrator only on mode switch,
 * not on every turn. This preserves vLLM prefix cache by keeping historical messages
 * identical across turns within the same mode.
 */
export function assembleAgentRequest(input: AgentAssemblyInput): AssemblyResult {
  const { agentDef, subAgentDefs, ...baseInput } = input

  if (agentDef.metadata.subagent) {
    const systemPrompt = buildSubAgentSystemPrompt(
      baseInput.workdir,
      agentDef,
      baseInput.skills,
    )
    const assemblyInput = {
      systemPrompt,
      messages: baseInput.messages,
      injectedFiles: baseInput.injectedFiles,
      requestTools: baseInput.requestTools ?? baseInput.promptTools,
      toolChoice: baseInput.toolChoice ?? 'auto',
      disableThinking: baseInput.disableThinking ?? false,
      ...(baseInput.customInstructions ? { customInstructions: baseInput.customInstructions } : {}),
      ...(baseInput.skills && baseInput.skills.length > 0 ? { skills: baseInput.skills } : {}),
    }
    return createAssemblyResult(assemblyInput)
  }

  const systemPrompt = buildTopLevelSystemPrompt(
    baseInput.workdir,
    baseInput.customInstructions,
    baseInput.skills,
    subAgentDefs,
  )

  // DO NOT inject runtime reminder here - it's handled by orchestrator.injectModeReminderIfNeeded()
  // which only injects on mode switch to preserve vLLM cache
  const assemblyInput = {
    systemPrompt,
    messages: baseInput.messages,
    injectedFiles: baseInput.injectedFiles,
    requestTools: baseInput.requestTools ?? baseInput.promptTools,
    toolChoice: baseInput.toolChoice ?? 'auto',
    disableThinking: baseInput.disableThinking ?? false,
    ...(baseInput.customInstructions ? { customInstructions: baseInput.customInstructions } : {}),
    ...(baseInput.skills && baseInput.skills.length > 0 ? { skills: baseInput.skills } : {}),
  }
  return createAssemblyResult(assemblyInput)
}
