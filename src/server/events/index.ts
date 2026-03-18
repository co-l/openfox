/**
 * Event Sourcing Module
 *
 * This module provides the event store - the single source of truth
 * for all session state in OpenFox.
 *
 * Usage:
 * ```typescript
 * import { initEventStore, getEventStore, createEvent } from './events/index.js'
 * import type { TurnEvent, StoredEvent, SessionSnapshot } from './events/index.js'
 *
 * // Initialize (once, at app startup)
 * initEventStore(db)
 *
 * // Append events
 * const store = getEventStore()
 * store.append(sessionId, createEvent('message.start', { messageId, role: 'user', content }))
 *
 * // Subscribe to live events
 * const { iterator, unsubscribe } = store.subscribe(sessionId)
 * for await (const event of iterator) {
 *   // Handle event
 * }
 *
 * // Load session (snapshot + events since)
 * const { snapshot, events } = store.getEventsSinceSnapshot(sessionId)
 * ```
 */

// Store
export { EventStore, initEventStore, getEventStore } from './store.js'

// Types
export type {
  TurnEvent,
  StoredEvent,
  SessionSnapshot,
  SnapshotMessage,
  ToolCallWithResult,
  EventType,
  EventData,
} from './types.js'

// Helpers
export { createEvent, isTurnEvent, isStoredEvent } from './types.js'
