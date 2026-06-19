import type { Attachment, InjectedFile } from '../../shared/types.js'
import type { ContextMessage } from '../events/folding.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { SkillMetadata } from '../skills/types.js'
import type { AgentDefinition } from '../agents/types.js'
import { buildTopLevelSystemPrompt, buildSubAgentSystemPrompt } from './prompts.js'

export interface RequestContextMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  thinkingContent?: string
  source: 'history' | 'runtime'
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  toolCallId?: string
  attachments?: Attachment[]
}

export type MinimalMessage = ContextMessage

export function minimalMessagesToRequestContextMessages(
  messages: MinimalMessage[],
  source: 'history' | 'runtime' = 'history',
): RequestContextMessage[] {
  return messages.map((message) => minimalMessageToRequestContextMessage(message, source))
}

function spreadMessageProps<
  T extends {
    toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[]
    toolCallId?: string
    attachments?: Attachment[]
  },
>(message: T) {
  return {
    ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.attachments ? { attachments: message.attachments } : {}),
  }
}

export function minimalMessageToRequestContextMessage(
  message: MinimalMessage,
  source: 'history' | 'runtime' = 'history',
): RequestContextMessage {
  return {
    role: message.role,
    content: message.content,
    source,
    ...(message.thinkingContent ? { thinkingContent: message.thinkingContent } : {}),
    ...spreadMessageProps(message),
  }
}

export function messageToMinimal(message: RequestContextMessage): MinimalMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.thinkingContent ? { thinkingContent: message.thinkingContent } : {}),
    ...spreadMessageProps(message),
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
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
  disableThinking?: boolean
  modelName?: string
}

export interface AssemblyResult {
  systemPrompt: string
  messages: MinimalMessage[]
}

export function createAssemblyResult(input: {
  systemPrompt: string
  messages: RequestContextMessage[]
  injectedFiles: InjectedFile[]
  requestTools: LLMToolDefinition[]
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
  disableThinking?: boolean
  customInstructions?: string
  skills?: SkillMetadata[]
}): AssemblyResult {
  // Filter out runtime messages (auto-prompts) from messages sent to LLM
  // These are only for internal tracking, not part of conversation history
  const messagesForLLM = input.messages.filter((m) => m.source !== 'runtime')

  return {
    systemPrompt: input.systemPrompt,
    messages: messagesForLLM.map((message) => messageToMinimal(message)),
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
function buildAssemblyInput(
  systemPrompt: string,
  baseInput: Omit<AgentAssemblyInput, 'agentDef' | 'subAgentDefs'>,
): ReturnType<typeof createAssemblyResult> {
  return createAssemblyResult({
    systemPrompt,
    messages: baseInput.messages,
    injectedFiles: baseInput.injectedFiles,
    requestTools: baseInput.requestTools ?? baseInput.promptTools,
    toolChoice: baseInput.toolChoice ?? 'auto',
    disableThinking: baseInput.disableThinking ?? false,
    ...(baseInput.customInstructions ? { customInstructions: baseInput.customInstructions } : {}),
    ...(baseInput.skills && baseInput.skills.length > 0 ? { skills: baseInput.skills } : {}),
  })
}

export function assembleAgentRequest(input: AgentAssemblyInput): AssemblyResult {
  const { agentDef, subAgentDefs, ...baseInput } = input

  if (agentDef.metadata.subagent) {
    const systemPrompt = buildSubAgentSystemPrompt(baseInput.workdir, agentDef, baseInput.skills, baseInput.modelName)
    return buildAssemblyInput(systemPrompt, baseInput)
  }

  const systemPrompt = buildTopLevelSystemPrompt(
    baseInput.workdir,
    baseInput.customInstructions,
    baseInput.skills,
    subAgentDefs,
    baseInput.modelName,
  )

  // DO NOT inject runtime reminder here - it's handled by orchestrator.injectAgentReminder()
  // which scans events and injects full definition or small reminder as needed
  return buildAssemblyInput(systemPrompt, baseInput)
}
