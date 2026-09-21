import { Buffer } from 'node:buffer'
import type { Message } from '../../shared/types.js'

export const DEFAULT_HISTORY_PAGE_MAX_TURNS = 10
export const DEFAULT_HISTORY_PAGE_MAX_ITEMS = 30
export const DEFAULT_HISTORY_PAGE_MAX_BYTES = 1024 * 1024

export interface MessagePageOptions {
  beforeMessageId?: string
  maxTurns?: number
  maxItems?: number
  maxBytes?: number
}

export interface MessagePage {
  messages: Message[]
  hiddenCount: number
}

interface MessageTurn {
  start: number
  messages: Message[]
  bytes: number
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback
}

function groupIntoTurns(messages: Message[]): MessageTurn[] {
  const turns: MessageTurn[] = []

  for (let index = 0; index < messages.length; index++) {
    const entry = messages[index]!
    let turn = turns.at(-1)

    if (!turn || entry.role === 'user') {
      turn = { start: index, messages: [], bytes: 0 }
      turns.push(turn)
    }

    turn.messages.push(entry)
    turn.bytes += Buffer.byteLength(JSON.stringify(entry), 'utf8')
  }

  return turns
}

/**
 * Select a bottom-anchored page without splitting a user turn. Limits are
 * soft for the newest eligible turn so one oversized response remains usable.
 */
export function paginateMessages(messages: Message[], options: MessagePageOptions = {}): MessagePage {
  const maxTurns = positiveInteger(options.maxTurns, DEFAULT_HISTORY_PAGE_MAX_TURNS)
  const maxItems = positiveInteger(options.maxItems, DEFAULT_HISTORY_PAGE_MAX_ITEMS)
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_HISTORY_PAGE_MAX_BYTES)

  let end = messages.length
  if (options.beforeMessageId !== undefined) {
    end = messages.findIndex((entry) => entry.id === options.beforeMessageId)
    if (end < 0) {
      throw new Error(`Message cursor not found: ${options.beforeMessageId}`)
    }
  }

  if (end === 0) return { messages: [], hiddenCount: 0 }

  const turns = groupIntoTurns(messages.slice(0, end))
  const selected: MessageTurn[] = []
  let itemCount = 0
  let byteCount = 0

  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]!
    const exceedsLimit =
      selected.length >= maxTurns || itemCount + turn.messages.length > maxItems || byteCount + turn.bytes > maxBytes

    if (selected.length > 0 && exceedsLimit) break

    selected.unshift(turn)
    itemCount += turn.messages.length
    byteCount += turn.bytes
  }

  const first = selected[0]
  return {
    messages: selected.flatMap((turn) => turn.messages),
    hiddenCount: first?.start ?? 0,
  }
}
