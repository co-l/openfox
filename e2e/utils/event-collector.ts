/**
 * Event collection utilities for E2E tests.
 * 
 * Provides higher-level patterns for collecting and asserting on events.
 */

import type { ServerMessage, ServerMessageType } from '@openfox/shared/protocol'
import type { TestClient } from './ws-client.js'

export const DEFAULT_COLLECTION_TIMEOUT_MS = 1_500
export const DEFAULT_PHASE_TIMEOUT_MS = 1_500

// ============================================================================
// Types
// ============================================================================

export interface CollectedEvents {
  /** All events collected */
  all: ServerMessage[]
  /** Events by type */
  byType: Map<ServerMessageType, ServerMessage[]>
  /** Get events of a specific type */
  get<T>(type: ServerMessageType): ServerMessage<T>[]
  /** Check if any event matches predicate */
  hasEvent(predicate: (event: ServerMessage) => boolean): boolean
  /** Find first event matching predicate */
  findEvent<T>(predicate: (event: ServerMessage) => boolean): ServerMessage<T> | undefined
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a collected events object from an array of events.
 */
export function createCollectedEvents(events: ServerMessage[]): CollectedEvents {
  const normalizedEvents = events.map(event => ({
    ...event,
    payload: typeof event.payload === 'object' && event.payload !== null
      ? structuredClone(event.payload)
      : event.payload,
  }))

  const toolNamesByCallId = new Map<string, string>()
  const messagesById = new Map<string, { message: Record<string, unknown> }>()

  for (const event of normalizedEvents) {
    if (event.type === 'chat.tool_call') {
      const payload = event.payload as { callId: string; tool: string }
      toolNamesByCallId.set(payload.callId, payload.tool)
    }

    if (event.type === 'chat.tool_result') {
      const payload = event.payload as { callId: string; tool?: string }
      const tool = toolNamesByCallId.get(payload.callId)
      if (tool) {
        payload.tool = tool
      }
    }

    if (event.type === 'chat.message') {
      const payload = event.payload as { message: Record<string, unknown> }
      const messageId = payload.message['id']
      if (typeof messageId === 'string') {
        messagesById.set(messageId, payload)
      }
    }

    if (event.type === 'chat.message_updated') {
      const payload = event.payload as { messageId: string; updates: Record<string, unknown> }
      const messagePayload = messagesById.get(payload.messageId)
      if (messagePayload) {
        messagePayload.message = {
          ...messagePayload.message,
          ...payload.updates,
        }
      }
    }
  }

  const byType = new Map<ServerMessageType, ServerMessage[]>()
  
  for (const event of normalizedEvents) {
    const list = byType.get(event.type) ?? []
    list.push(event)
    byType.set(event.type, list)
  }
  
  return {
    all: normalizedEvents,
    byType,
    get<T>(type: ServerMessageType): ServerMessage<T>[] {
      return (byType.get(type) ?? []) as ServerMessage<T>[]
    },
    hasEvent(predicate: (event: ServerMessage) => boolean): boolean {
      return events.some(predicate)
    },
    findEvent<T>(predicate: (event: ServerMessage) => boolean): ServerMessage<T> | undefined {
      return events.find(predicate) as ServerMessage<T> | undefined
    },
  }
}

/**
 * Collect events from client until a condition is met.
 * 
 * @param client - Test client to collect from
 * @param stopCondition - Function that returns true when we should stop
 * @param timeout - Maximum time to wait
 */
export async function collectUntil(
  client: TestClient,
  stopCondition: (event: ServerMessage) => boolean,
  timeout = DEFAULT_COLLECTION_TIMEOUT_MS
): Promise<CollectedEvents> {
  const collectedEvents = await client.consumeEventsUntil(stopCondition, timeout)
  return createCollectedEvents(collectedEvents)
}

/**
 * Collect all events during a chat interaction.
 * Waits for chat.done event.
 */
export async function collectChatEvents(
  client: TestClient,
  timeout = DEFAULT_COLLECTION_TIMEOUT_MS
): Promise<CollectedEvents> {
  return collectUntil(
    client,
    (event) => event.type === 'chat.done',
    timeout
  )
}

/**
 * Collect events until a specific phase is reached.
 */
export async function collectUntilPhase(
  client: TestClient,
  phase: 'plan' | 'build' | 'verification' | 'blocked' | 'done',
  timeout = DEFAULT_PHASE_TIMEOUT_MS
): Promise<CollectedEvents> {
  return collectUntil(
    client,
    (event) => event.type === 'phase.changed' && 
      (event.payload as { phase: string }).phase === phase,
    timeout
  )
}

/**
 * Assert helper: check that collected events contain expected types.
 */
export function assertEventTypes(
  collected: CollectedEvents,
  expectedTypes: ServerMessageType[]
): void {
  for (const type of expectedTypes) {
    const events = collected.get(type)
    if (events.length === 0) {
      throw new Error(`Expected event type '${type}' but none found`)
    }
  }
}

/**
 * Assert helper: check that no errors occurred.
 */
export function assertNoErrors(collected: CollectedEvents): void {
  const errors = collected.get('error')
  const chatErrors = collected.get('chat.error')
  
  if (errors.length > 0 || chatErrors.length > 0) {
    const allErrors = [...errors, ...chatErrors]
    const messages = allErrors.map(e => {
      const payload = e.payload as { message?: string; error?: string }
      return payload.message ?? payload.error ?? 'Unknown error'
    })
    throw new Error(`Unexpected errors: ${messages.join(', ')}`)
  }
}
