import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import type { MinimalMessage } from '../chat/request-context.js'
import { getSetting, SETTINGS_KEYS } from '../db/settings.js'
import { logger } from '../utils/logger.js'

export const DEFAULT_HEADROOM_URL = 'http://127.0.0.1:8787'

export interface HeadroomOpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
  tool_call_id?: string
}

export interface HeadroomCompressResponse {
  messages: HeadroomOpenAIMessage[]
  tokens_before?: number
  tokens_after?: number
  tokens_saved?: number
  compression_ratio?: number
  transforms_applied?: string[]
  ccr_hashes?: string[]
}

export interface HeadroomCompressResult {
  messages: MinimalMessage[]
  tokensBefore: number
  tokensAfter: number
  tokensSaved: number
  compressionRatio: number
  transformsApplied: string[]
  compressed: boolean
}

export interface HeadroomStatus {
  available: boolean
  installed: boolean
  running: boolean
  version: string | null
  proxyUrl: string
}

export function getHeadroomProxyUrl(): string {
  const customUrl = getSetting(SETTINGS_KEYS.TOOLS_HEADROOM_PROXY_URL)
  return customUrl && customUrl.trim() ? customUrl.trim().replace(/\/+$/, '') : DEFAULT_HEADROOM_URL
}

export function isHeadroomEnabled(): boolean {
  return getSetting(SETTINGS_KEYS.TOOLS_USE_HEADROOM) === 'true'
}

export function toHeadroomMessages(messages: MinimalMessage[]): HeadroomOpenAIMessage[] {
  return messages.map((msg) => {
    const role = msg.role
    const content = msg.content ?? ''

    const out: HeadroomOpenAIMessage = {
      role: role as HeadroomOpenAIMessage['role'],
      content,
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      out.tool_calls = msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments ?? {}),
        },
      }))
    }

    if (msg.toolCallId) {
      out.tool_call_id = msg.toolCallId
    }

    return out
  })
}

export function fromHeadroomMessages(
  compressed: HeadroomOpenAIMessage[],
  original: MinimalMessage[],
): MinimalMessage[] {
  return compressed.map((cMsg, index) => {
    const orig = original[index]
    const role = cMsg.role as MinimalMessage['role']
    const content = cMsg.content ?? ''

    const isSameRole = orig && orig.role === role

    const out: MinimalMessage = {
      role,
      content,
      ...(isSameRole && orig.thinkingContent ? { thinkingContent: orig.thinkingContent } : {}),
      ...(isSameRole && orig.attachments ? { attachments: orig.attachments } : {}),
    }

    if (role === 'assistant') {
      if (cMsg.tool_calls && cMsg.tool_calls.length > 0) {
        out.toolCalls = cMsg.tool_calls.map((tc) => {
          let parsedArgs: Record<string, unknown>
          try {
            parsedArgs = JSON.parse(tc.function.arguments)
          } catch {
            parsedArgs = {}
          }
          return {
            id: tc.id,
            name: tc.function.name,
            arguments: parsedArgs,
          }
        })
      } else if (isSameRole && orig.toolCalls) {
        out.toolCalls = orig.toolCalls
      }
    }

    if (role === 'tool') {
      if (cMsg.tool_call_id) {
        out.toolCallId = cMsg.tool_call_id
      } else if (isSameRole && orig.toolCallId) {
        out.toolCallId = orig.toolCallId
      }
    }

    return out
  })
}

export async function checkHeadroomCli(): Promise<{ installed: boolean; version: string | null }> {
  try {
    const version = await new Promise<string>((resolve, reject) => {
      const proc = spawn('headroom', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      proc.stdout?.on('data', (d: Buffer) => {
        out += d.toString()
      })
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code === 0) resolve(out.trim())
        else reject(new Error(`exit ${code}`))
      })
    })
    return { installed: true, version: version || null }
  } catch {
    try {
      await access('/usr/local/bin/headroom')
      return { installed: true, version: null }
    } catch {
      return { installed: false, version: null }
    }
  }
}

export async function checkHeadroomProxy(proxyUrl: string): Promise<boolean> {
  try {
    const resp = await fetch(`${proxyUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
    })
    if (!resp.ok) return false
    const data = (await resp.json()) as { status?: string }
    return data.status === 'healthy' || resp.status === 200
  } catch {
    return false
  }
}

export async function checkHeadroomAvailability(customProxyUrl?: string): Promise<HeadroomStatus> {
  const proxyUrl = customProxyUrl ?? getHeadroomProxyUrl()
  const [cli, running] = await Promise.all([checkHeadroomCli(), checkHeadroomProxy(proxyUrl)])

  return {
    available: running || cli.installed,
    installed: cli.installed,
    running,
    version: cli.version,
    proxyUrl,
  }
}

export interface CompressMessagesOptions {
  messages: MinimalMessage[]
  model?: string
  headroomUrl?: string
  tokenBudget?: number
  frozenMessageCount?: number
  timeoutMs?: number
}

export async function compressMessagesWithHeadroom(options: CompressMessagesOptions): Promise<HeadroomCompressResult> {
  const {
    messages,
    model = 'gpt-4o',
    headroomUrl = getHeadroomProxyUrl(),
    tokenBudget,
    frozenMessageCount,
    timeoutMs = 5000,
  } = options

  const fallback: HeadroomCompressResult = {
    messages,
    tokensBefore: 0,
    tokensAfter: 0,
    tokensSaved: 0,
    compressionRatio: 1.0,
    transformsApplied: [],
    compressed: false,
  }

  if (messages.length === 0) {
    return fallback
  }

  try {
    const openaiMessages = toHeadroomMessages(messages)
    const body: Record<string, unknown> = {
      messages: openaiMessages,
      model,
    }

    if (tokenBudget !== undefined) {
      body['token_budget'] = tokenBudget
    }

    const config: Record<string, unknown> = {}
    if (frozenMessageCount !== undefined && frozenMessageCount > 0) {
      config['frozen_message_count'] = frozenMessageCount
    }

    if (Object.keys(config).length > 0) {
      body['config'] = config
    }

    const resp = await fetch(`${headroomUrl}/v1/compress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!resp.ok) {
      logger.warn(`Headroom compression failed with HTTP ${resp.status}`, { status: resp.status })
      return fallback
    }

    const data = (await resp.json()) as HeadroomCompressResponse
    if (!data || !Array.isArray(data.messages)) {
      return fallback
    }

    const mappedMessages = fromHeadroomMessages(data.messages, messages)
    const tokensBefore = data.tokens_before ?? 0
    const tokensAfter = data.tokens_after ?? 0
    const tokensSaved = data.tokens_saved ?? Math.max(0, tokensBefore - tokensAfter)
    const compressionRatio = data.compression_ratio ?? (tokensBefore > 0 ? tokensAfter / tokensBefore : 1.0)

    logger.debug('Headroom compression succeeded', {
      tokensBefore,
      tokensAfter,
      tokensSaved,
      compressionRatio,
      transforms: data.transforms_applied,
    })

    return {
      messages: mappedMessages,
      tokensBefore,
      tokensAfter,
      tokensSaved,
      compressionRatio,
      transformsApplied: data.transforms_applied ?? [],
      compressed: true,
    }
  } catch (error) {
    logger.debug('Headroom compression fail-open fallback', { error })
    return fallback
  }
}
