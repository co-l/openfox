import type { StreamingBuffer } from './types'

/** Key used when no session is supplied (legacy/tests). */
export const DEFAULT_BUFFER_KEY = '__default__'

const buffers = new Map<string, StreamingBuffer>()
const dirtySessionIds = new Set<string>()

let flushFn: ((sessionId: string) => void) | null = null
let pendingTimer: ReturnType<typeof setTimeout> | number | null = null
let pendingTimerKind: 'raf' | 'timeout' | null = null
let lastFlushTime = 0
// One render per frame at most (~60fps). Deltas arriving within the same
// frame are coalesced into a single render via the rAF fast path below.
const MIN_STREAM_FLUSH_INTERVAL_MS = 16

export function setFlushFn(fn: ((sessionId: string) => void) | null) {
  flushFn = fn
}

export function getBuffer(sessionId: string = DEFAULT_BUFFER_KEY): StreamingBuffer {
  let buffer = buffers.get(sessionId)
  if (!buffer) {
    buffer = { messageId: null, deltaContent: '', thinkingContent: '', toolOutput: [] }
    buffers.set(sessionId, buffer)
  }
  return buffer
}

/** Drop a session's buffer entirely (e.g. when its split pane is closed). */
export function releaseStreamingBuffer(sessionId: string = DEFAULT_BUFFER_KEY) {
  buffers.delete(sessionId)
  dirtySessionIds.delete(sessionId)
}

function clearPendingTimer() {
  if (pendingTimer === null) return
  if (pendingTimerKind === 'raf') {
    cancelAnimationFrame(pendingTimer as number)
  } else {
    clearTimeout(pendingTimer)
  }
  pendingTimer = null
  pendingTimerKind = null
}

function doFlush() {
  pendingTimer = null
  pendingTimerKind = null
  lastFlushTime = Date.now()
  for (const sessionId of dirtySessionIds) {
    flushFn?.(sessionId)
  }
  dirtySessionIds.clear()
}

let waitingForVisible = false

function flushWhenVisible() {
  if (document.hidden) return
  document.removeEventListener('visibilitychange', flushWhenVisible)
  waitingForVisible = false
  if (pendingTimer === null) doFlush()
}

export function scheduleStreamingFlush(sessionId: string = DEFAULT_BUFFER_KEY) {
  dirtySessionIds.add(sessionId)
  if (pendingTimer !== null) return
  if (typeof document !== 'undefined' && document.hidden) {
    // Nobody sees a hidden page: keep buffering and render everything in one
    // flush when it is shown again, instead of rendering the stream in the
    // background (terminal commits still flush through cancelStreamingFlush).
    if (!waitingForVisible) {
      waitingForVisible = true
      document.addEventListener('visibilitychange', flushWhenVisible)
    }
    return
  }
  const elapsed = Date.now() - lastFlushTime
  if (elapsed >= MIN_STREAM_FLUSH_INTERVAL_MS) {
    // Fast path: enough time passed since the last flush — defer to the next
    // animation frame so deltas arriving in the same frame coalesce into one render.
    pendingTimer = requestAnimationFrame(doFlush)
    pendingTimerKind = 'raf'
  } else {
    // Throttle: wait until the minimum interval has elapsed since the last flush.
    pendingTimer = setTimeout(doFlush, MIN_STREAM_FLUSH_INTERVAL_MS - elapsed)
    pendingTimerKind = 'timeout'
  }
}

export function cancelStreamingFlush(sessionId: string = DEFAULT_BUFFER_KEY) {
  // The flush above is a terminal commit (end of message, error, session switch).
  // Reset the throttle window so the first delta of the next message renders
  // immediately instead of waiting out the remaining interval.
  lastFlushTime = 0
  clearPendingTimer()
  dirtySessionIds.delete(sessionId)
  flushFn?.(sessionId)
  const buffer = buffers.get(sessionId)
  if (buffer) {
    // Only reset when the flush actually consumed the pending content. If the
    // target message has not landed in the store yet (stream racing ahead), the
    // flush re-buffers the deltas — wiping them here would drop the stream.
    const stillPending =
      buffer.deltaContent.length > 0 || buffer.thinkingContent.length > 0 || buffer.toolOutput.length > 0
    if (!stillPending) {
      buffer.messageId = null
      buffer.deltaContent = ''
      buffer.thinkingContent = ''
      buffer.toolOutput = []
    }
  }
}
