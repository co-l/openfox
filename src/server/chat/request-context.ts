import type {
  Attachment,
  InjectedFile,
  PromptContext,
  PromptContextMessage,
  PromptContextTool,
  PromptRequestOptions,
} from '../../shared/types.js'
import type { LLMToolDefinition } from '../llm/types.js'
import { buildBuilderPrompt, buildPlannerPrompt, buildVerifierPrompt } from './prompts.js'

export type RequestContextMessage = PromptContextMessage

interface BaseAssemblyInput {
  workdir: string
  messages: RequestContextMessage[]
  injectedFiles: InjectedFile[]
  customInstructions?: string
  promptTools: LLMToolDefinition[]
  requestTools?: LLMToolDefinition[]
  toolChoice?: PromptRequestOptions['toolChoice']
  enableThinking?: boolean
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

export function assemblePlannerRequest(input: BaseAssemblyInput): AssemblyResult {
  const systemPrompt = buildPlannerPrompt(input.workdir, input.promptTools, input.customInstructions)
  return createAssemblyResult({
    systemPrompt,
    messages: input.messages,
    injectedFiles: input.injectedFiles,
    requestTools: input.requestTools ?? input.promptTools,
    toolChoice: input.toolChoice ?? 'auto',
    enableThinking: input.enableThinking ?? true,
  })
}

export function assembleBuilderRequest(input: BaseAssemblyInput): AssemblyResult {
  const systemPrompt = buildBuilderPrompt(input.workdir, input.promptTools, input.customInstructions)
  return createAssemblyResult({
    systemPrompt,
    messages: input.messages,
    injectedFiles: input.injectedFiles,
    requestTools: input.requestTools ?? input.promptTools,
    toolChoice: input.toolChoice ?? 'auto',
    enableThinking: input.enableThinking ?? true,
  })
}

export function assembleVerifierRequest(input: BaseAssemblyInput): AssemblyResult {
  const systemPrompt = buildVerifierPrompt(input.workdir, input.promptTools, input.customInstructions)
  return createAssemblyResult({
    systemPrompt,
    messages: input.messages,
    injectedFiles: input.injectedFiles,
    requestTools: input.requestTools ?? input.promptTools,
    toolChoice: input.toolChoice ?? 'auto',
    enableThinking: input.enableThinking ?? true,
  })
}

export function createPromptContext(input: {
  systemPrompt: string
  messages: RequestContextMessage[]
  injectedFiles: InjectedFile[]
  requestTools: LLMToolDefinition[]
  toolChoice: PromptRequestOptions['toolChoice']
  enableThinking: boolean
}): PromptContext {
  return {
    systemPrompt: input.systemPrompt,
    injectedFiles: input.injectedFiles,
    userMessage: getTriggerUserMessage(input.messages),
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
      enableThinking: input.enableThinking,
    },
  }
}

function createAssemblyResult(input: {
  systemPrompt: string
  messages: RequestContextMessage[]
  injectedFiles: InjectedFile[]
  requestTools: LLMToolDefinition[]
  toolChoice: PromptRequestOptions['toolChoice']
  enableThinking: boolean
}): AssemblyResult {
  return {
    systemPrompt: input.systemPrompt,
    messages: input.messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      ...(message.attachments ? { attachments: message.attachments } : {}),
    })),
    promptContext: createPromptContext(input),
  }
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
