/**
 * Session Event Queue
 *
 * Manages event queues for active sessions, enabling:
 * - Decoupled execution from WebSocket connections
 * - Event replay for reconnecting clients
 * - Multiple subscribers (multiple browser tabs)
 */

import type { ServerMessage } from '../../shared/protocol.js'
import { logger } from '../utils/logger.js'

interface QueuedEvent {
  seq: number
  event: ServerMessage
  timestamp: number
}

interface SessionEventQueue {
  events: QueuedEvent[]
  subscribers: Map<symbol, (event: ServerMessage, seq: number) => void>
  nextSeq: number
  cleanupTimer: ReturnType<typeof setTimeout> | null
}

const DEFAULT_MAX_EVENTS = 10000
const DEFAULT_CLEANUP_DELAY_MS = 30000

export class SessionEvents {
  private queues = new Map<string, SessionEventQueue>()
  private maxEvents: number
  private cleanupDelayMs: number

  constructor(options: { maxEvents?: number; cleanupDelayMs?: number } = {}) {
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS
    this.cleanupDelayMs = options.cleanupDelayMs ?? DEFAULT_CLEANUP_DELAY_MS
  }

  /**
   * Get or create a queue for a session
   */
  private getQueue(sessionId: string): SessionEventQueue {
    let queue = this.queues.get(sessionId)
    if (!queue) {
      queue = {
        events: [],
        subscribers: new Map(),
        nextSeq: 0,
        cleanupTimer: null,
      }
      this.queues.set(sessionId, queue)
    }
    return queue
  }

  /**
   * Push an event to the session queue and notify all subscribers
   * Returns the sequence number assigned to the event
   */
  push(sessionId: string, event: ServerMessage): number {
    const queue = this.getQueue(sessionId)
    const seq = queue.nextSeq++
    const timestamp = Date.now()

    // Add to queue
    queue.events.push({ seq, event, timestamp })

    // Trim if over max
    if (queue.events.length > this.maxEvents) {
      const trimCount = queue.events.length - this.maxEvents
      queue.events.splice(0, trimCount)
      logger.debug('Trimmed event queue', { sessionId, trimCount })
    }

    // Notify all subscribers
    for (const callback of queue.subscribers.values()) {
      try {
        callback(event, seq)
      } catch (error) {
        logger.error('Subscriber callback error', { sessionId, error })
      }
    }

    return seq
  }

  /**
   * Subscribe to events for a session
   * Returns an unsubscribe function
   */
  subscribe(sessionId: string, callback: (event: ServerMessage, seq: number) => void): () => void {
    const queue = this.getQueue(sessionId)
    const id = Symbol()
    queue.subscribers.set(id, callback)

    logger.debug('Subscribed to session events', {
      sessionId,
      subscriberCount: queue.subscribers.size,
    })

    // Cancel any pending cleanup since we have a subscriber
    if (queue.cleanupTimer) {
      clearTimeout(queue.cleanupTimer)
      queue.cleanupTimer = null
    }

    return () => {
      queue.subscribers.delete(id)
      logger.debug('Unsubscribed from session events', {
        sessionId,
        subscriberCount: queue.subscribers.size,
      })
    }
  }

  /**
   * Get events from a specific sequence number onwards
   * Used for replaying missed events to reconnecting clients
   */
  getEvents(sessionId: string, fromSeq: number): QueuedEvent[] {
    const queue = this.queues.get(sessionId)
    if (!queue) return []

    return queue.events.filter((e) => e.seq >= fromSeq)
  }

  /**
   * Get the current sequence number for a session
   */
  getCurrentSeq(sessionId: string): number {
    const queue = this.queues.get(sessionId)
    return queue?.nextSeq ?? 0
  }

  /**
   * Check if a session has an active queue
   */
  hasQueue(sessionId: string): boolean {
    return this.queues.has(sessionId)
  }

  /**
   * Get subscriber count for a session
   */
  getSubscriberCount(sessionId: string): number {
    const queue = this.queues.get(sessionId)
    return queue?.subscribers.size ?? 0
  }

  /**
   * Schedule cleanup of a session's event queue
   * Called when execution completes
   */
  scheduleCleanup(sessionId: string): void {
    const queue = this.queues.get(sessionId)
    if (!queue) return

    // Cancel any existing timer
    if (queue.cleanupTimer) {
      clearTimeout(queue.cleanupTimer)
    }

    // Schedule cleanup
    queue.cleanupTimer = setTimeout(() => {
      this.clear(sessionId)
    }, this.cleanupDelayMs)

    logger.debug('Scheduled event queue cleanup', {
      sessionId,
      delayMs: this.cleanupDelayMs,
    })
  }

  /**
   * Immediately clear a session's event queue
   */
  clear(sessionId: string): void {
    const queue = this.queues.get(sessionId)
    if (queue) {
      if (queue.cleanupTimer) {
        clearTimeout(queue.cleanupTimer)
      }
      this.queues.delete(sessionId)
      logger.debug('Cleared event queue', { sessionId })
    }
  }

  /**
   * Clear all queues (used for testing or shutdown)
   */
  clearAll(): void {
    for (const [_sessionId, queue] of this.queues) {
      if (queue.cleanupTimer) {
        clearTimeout(queue.cleanupTimer)
      }
    }
    this.queues.clear()
    logger.debug('Cleared all event queues')
  }
}

// Singleton instance
export const sessionEvents = new SessionEvents()
