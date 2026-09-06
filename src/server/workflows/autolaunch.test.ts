import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelAutoLaunch,
  clearAllAutoLaunch,
  getAutoLaunchMessage,
  hasAutoLaunchPending,
  initAutoLaunch,
  scheduleAutoLaunch,
} from './autolaunch.js'
import type { AutoLaunchFavorite } from './autolaunch.js'

const favorite = { id: 'auto-flow', name: 'Autonomous build', scope: 'user' as const }
type FireCall = [string, AutoLaunchFavorite]
const TEST_DELAY_MS = 90_000

describe('favorite-workflow auto-launch timer', () => {
  let broadcasts: Array<{ sessionId: string; type: string; payload: Record<string, unknown> }>
  let fireCalls: FireCall[]
  let delayMs: number

  const isActive = (b: { payload: Record<string, unknown> }): boolean => Boolean(b.payload['active'])

  beforeEach(() => {
    vi.useFakeTimers()
    broadcasts = []
    fireCalls = []
    delayMs = TEST_DELAY_MS
    initAutoLaunch({
      broadcast: (sessionId, msg) =>
        broadcasts.push({ sessionId, type: msg.type, payload: msg.payload as Record<string, unknown> }),
      fire: (sid, fav) => fireCalls.push([sid, fav]),
      resolveDelayMs: () => delayMs,
    })
  })

  afterEach(() => {
    clearAllAutoLaunch()
    vi.useRealTimers()
  })

  it('schedules, broadcasts the deadline, and fires after the configured timeout', () => {
    scheduleAutoLaunch('s1', favorite)

    expect(hasAutoLaunchPending('s1')).toBe(true)
    expect(broadcasts).toHaveLength(1)
    const first = broadcasts[0]!
    expect(first.type).toBe('workflow.autolaunch')
    expect(first.payload['active']).toBe(true)
    expect(first.payload['workflowId']).toBe('auto-flow')
    expect(Number(first.payload['deadline'])).toBeCloseTo(Date.now() + TEST_DELAY_MS, -2)

    vi.advanceTimersByTime(TEST_DELAY_MS - 1)
    expect(fireCalls).toHaveLength(0)

    vi.advanceTimersByTime(1)
    expect(fireCalls[0]).toEqual(['s1', favorite])
    expect(hasAutoLaunchPending('s1')).toBe(false)
    // Cleared message broadcast on expiry.
    const cleared = broadcasts.at(-1)!
    expect(cleared.type).toBe('workflow.autolaunch')
    expect(cleared.payload['active']).toBe(false)
  })

  it('uses the scope-resolved timeout of the session project', () => {
    delayMs = TEST_DELAY_MS
    scheduleAutoLaunch('s1', favorite, 'p-slow')

    vi.advanceTimersByTime(20_000)
    expect(fireCalls).toHaveLength(0)

    initAutoLaunch({
      broadcast: (sessionId, msg) =>
        broadcasts.push({ sessionId, type: msg.type, payload: msg.payload as Record<string, unknown> }),
      fire: (sid, fav) => fireCalls.push([sid, fav]),
      resolveDelayMs: (projectId) => (projectId === 'p-fast' ? 10_000 : TEST_DELAY_MS),
    })
    clearAllAutoLaunch()
    broadcasts = []
    scheduleAutoLaunch('s2', favorite, 'p-fast')
    vi.advanceTimersByTime(10_000)
    expect(fireCalls).toHaveLength(1)
  })

  it('cancels before expiry and never fires', () => {
    scheduleAutoLaunch('s1', favorite)
    cancelAutoLaunch('s1')

    expect(hasAutoLaunchPending('s1')).toBe(false)
    vi.advanceTimersByTime(TEST_DELAY_MS + 1000)
    expect(fireCalls).toHaveLength(0)
    // Broadcast: active then cleared.
    expect(broadcasts.at(-1)!.payload['active']).toBe(false)
  })

  it('ignores a second schedule while one is pending', () => {
    scheduleAutoLaunch('s1', favorite)
    scheduleAutoLaunch('s1', { ...favorite, id: 'other' })

    expect(broadcasts.filter(isActive)).toHaveLength(1)
    vi.advanceTimersByTime(TEST_DELAY_MS)
    expect(fireCalls).toHaveLength(1)
    expect(fireCalls[0]![1].id).toBe('auto-flow')
  })

  it('reports remaining countdown for reconnect sync', () => {
    expect(getAutoLaunchMessage('s1')).toBeNull()

    scheduleAutoLaunch('s1', favorite)
    vi.advanceTimersByTime(20_000)

    const msg = getAutoLaunchMessage('s1')
    expect(msg).not.toBeNull()
    expect(msg!.payload['active']).toBe(true)
    expect(Number(msg!.payload['deadline'])).toBeCloseTo(Date.now() + TEST_DELAY_MS - 20_000, -3)

    cancelAutoLaunch('s1')
    expect(getAutoLaunchMessage('s1')).toBeNull()
  })

  it('cancel on a session without a pending timer is a no-op', () => {
    cancelAutoLaunch('nope')
    expect(broadcasts).toHaveLength(0)
  })
})
