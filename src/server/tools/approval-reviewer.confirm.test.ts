import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { requestUserConfirmation } from './tool-helpers.js'
import type { ToolContext } from './types.js'
import { setPluginApprovalReviewers, clearPluginApprovalReviewers } from '../plugins/approval-reviewers.js'
import type { PluginApprovalContext } from '../../plugin/index.js'

// Track callIds and control resolution of native confirmations
const capturedCallIds: string[] = []
let pendingResolve: ((approved: boolean) => void) | undefined

vi.mock('./path-security.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./path-security.js')>()
  return {
    ...actual,
    registerPathConfirmation: (callId: string, ..._args: unknown[]) => {
      capturedCallIds.push(callId)
      return new Promise<boolean>((resolve) => {
        pendingResolve = resolve
      })
    },
  }
})

vi.mock('../db/settings.js', () => ({
  getSetting: (key: string) => {
    if (key === 'tools.confirmOnWorkspaceActions') return 'true'
    if (key === 'display.locale') return 'fr'
    return null
  },
  SETTINGS_KEYS: {
    CONFIRM_ON_WORKSPACE_ACTIONS: 'tools.confirmOnWorkspaceActions',
    DISPLAY_LOCALE: 'display.locale',
  },
}))

const mockSessionManager = {
  recordFileRead: vi.fn(),
  getReadFiles: vi.fn().mockReturnValue({}),
  updateFileHash: vi.fn(),
} as unknown as ToolContext['sessionManager']

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionManager: mockSessionManager,
    workdir: '/test/workdir',
    sessionId: 'reviewer-session',
    toolCallId: 'tool-call-1',
    onEvent: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  capturedCallIds.length = 0
  pendingResolve = undefined
  clearPluginApprovalReviewers()
})

afterEach(() => {
  clearPluginApprovalReviewers()
})

describe('requestUserConfirmation with approval reviewer', () => {
  it('allow returns true without emitting a dialog', async () => {
    setPluginApprovalReviewers([{ pluginId: 'jev', reviewer: { id: 'jev', evaluate: () => ({ action: 'allow' }) } }])
    const context = makeContext()
    expect(await requestUserConfirmation(context, 'command', 'git checkout dev')).toBe(true)
    expect(context.onEvent as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
    expect(capturedCallIds).toHaveLength(0)
  })

  it('deny returns false without emitting a dialog', async () => {
    setPluginApprovalReviewers([
      {
        pluginId: 'jev',
        reviewer: { id: 'jev', evaluate: () => ({ action: 'deny', reason: 'blocked' }) },
      },
    ])
    const context = makeContext()
    expect(await requestUserConfirmation(context, 'command', 'git push --force')).toBe(false)
    expect(context.onEvent as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
    expect(capturedCallIds).toHaveLength(0)
  })

  it('ask falls through to the native confirmation dialog', async () => {
    setPluginApprovalReviewers([{ pluginId: 'jev', reviewer: { id: 'jev', evaluate: () => ({ action: 'ask' }) } }])
    const context = makeContext()
    const pending = requestUserConfirmation(context, 'command', 'switch branch')
    await vi.waitFor(() => expect(capturedCallIds).toHaveLength(1))
    expect(context.onEvent as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
    pendingResolve?.(false)
    expect(await pending).toBe(false)
  })

  it('reviewer failure falls back to native confirmation (fail-closed)', async () => {
    setPluginApprovalReviewers([
      {
        pluginId: 'jev',
        reviewer: {
          id: 'jev',
          evaluate: () => Promise.reject(new Error('offline')),
        },
      },
    ])
    const context = makeContext()
    const pending = requestUserConfirmation(context, 'command', 'switch branch')
    await vi.waitFor(() => expect(capturedCallIds).toHaveLength(1))
    pendingResolve?.(true)
    expect(await pending).toBe(true)
  })

  it('no reviewer: native behavior unchanged (dialog emitted)', async () => {
    const context = makeContext()
    const pending = requestUserConfirmation(context, 'command', 'switch branch')
    await vi.waitFor(() => expect(capturedCallIds).toHaveLength(1))
    expect(context.onEvent as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
    pendingResolve?.(false)
    expect(await pending).toBe(false)
  })

  it('night mode fail-closed happens before the reviewer', async () => {
    const evaluate = vi.fn().mockReturnValue({ action: 'allow' })
    setPluginApprovalReviewers([{ pluginId: 'jev', reviewer: { id: 'jev', evaluate } }])
    const context = makeContext({ nightMode: true, dangerLevel: 'normal' })
    expect(await requestUserConfirmation(context, 'command', 'night op')).toBe(false)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('dangerous mode auto-approves before the reviewer (unchanged)', async () => {
    const evaluate = vi.fn().mockReturnValue({ action: 'deny' })
    setPluginApprovalReviewers([{ pluginId: 'jev', reviewer: { id: 'jev', evaluate } }])
    const context = makeContext({ dangerLevel: 'dangerous' })
    expect(await requestUserConfirmation(context, 'command', 'dangerous op')).toBe(true)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('sub-agent fail-closed happens before the reviewer', async () => {
    const evaluate = vi.fn().mockReturnValue({ action: 'allow' })
    setPluginApprovalReviewers([{ pluginId: 'jev', reviewer: { id: 'jev', evaluate } }])
    const context = makeContext({ isSubAgent: true })
    expect(await requestUserConfirmation(context, 'command', 'sub op')).toBe(false)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('passes operation context to the reviewer', async () => {
    const evaluate = vi.fn().mockReturnValue({ action: 'allow' })
    setPluginApprovalReviewers([{ pluginId: 'jev', reviewer: { id: 'jev', evaluate } }])
    const context = makeContext()
    await requestUserConfirmation(context, 'command', 'Change branch to "dev"')
    const ctx = evaluate.mock.calls[0]?.[0] as PluginApprovalContext
    expect(ctx.kind).toBe('command')
    expect(ctx.tool).toBe('command')
    expect(ctx.description).toBe('Change branch to "dev"')
    expect(ctx.sessionId).toBe('reviewer-session')
    expect(ctx.dangerLevel).toBeUndefined()
  })
})
