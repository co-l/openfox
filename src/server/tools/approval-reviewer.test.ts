import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { realpath } from 'node:fs/promises'
import { normalize, resolve } from 'node:path'
import { requestPathAccess, PathAccessDeniedError, isPathAllowed, clearAllowedPaths } from './path-security.js'
import { setPluginApprovalReviewers, clearPluginApprovalReviewers } from '../plugins/approval-reviewers.js'
import type { PluginApprovalContext } from '../../plugin/index.js'

const SESSION_ID = 'session-reviewer-test'

async function canonicalOrResolved(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return normalize(resolve(path))
  }
}

let WORKDIR: string
let OUTSIDE_PATH: string

beforeAll(async () => {
  WORKDIR = await canonicalOrResolved(process.platform === 'win32' ? 'C:\\app\\project' : '/app/project')
  OUTSIDE_PATH = await canonicalOrResolved('/etc/passwd')
})

beforeEach(() => {
  clearAllowedPaths(SESSION_ID)
  clearPluginApprovalReviewers()
})

afterEach(() => {
  clearAllowedPaths(SESSION_ID)
  clearPluginApprovalReviewers()
})

describe('Approval reviewer in requestPathAccess', () => {
  it('allow executes without dialog and does NOT persist to the session allowlist', async () => {
    const evaluate = vi.fn().mockReturnValue({ action: 'allow' })
    setPluginApprovalReviewers([{ pluginId: 'jev', reviewer: { id: 'jev', evaluate } }])

    const onEvent = vi.fn()
    await expect(
      requestPathAccess([OUTSIDE_PATH], WORKDIR, SESSION_ID, 'call-1', 'read_file', onEvent, 'normal'),
    ).resolves.toBeUndefined()

    expect(onEvent).not.toHaveBeenCalled()
    expect(evaluate).toHaveBeenCalledTimes(1)
    // One-time approval: nothing persisted — the next operation is reviewed again.
    expect(isPathAllowed(SESSION_ID, OUTSIDE_PATH)).toBe(false)
  })

  it('a second identical operation is reviewed again, not auto-allowed from memory', async () => {
    const evaluate = vi.fn().mockReturnValue({ action: 'allow' })
    setPluginApprovalReviewers([{ pluginId: 'jev', reviewer: { id: 'jev', evaluate } }])
    const onEvent = vi.fn()

    await requestPathAccess([OUTSIDE_PATH], WORKDIR, SESSION_ID, 'call-a', 'read_file', onEvent, 'normal')
    await requestPathAccess([OUTSIDE_PATH], WORKDIR, SESSION_ID, 'call-b', 'read_file', onEvent, 'normal')

    expect(evaluate).toHaveBeenCalledTimes(2)
    expect(isPathAllowed(SESSION_ID, OUTSIDE_PATH)).toBe(false)
  })

  it('deny throws PathAccessDeniedError with the reviewer reason', async () => {
    setPluginApprovalReviewers([
      {
        pluginId: 'jev',
        reviewer: { id: 'jev', evaluate: () => ({ action: 'deny', reason: 'Operation classified as destructive.' }) },
      },
    ])
    const onEvent = vi.fn()
    await expect(
      requestPathAccess([OUTSIDE_PATH], WORKDIR, SESSION_ID, 'call-2', 'read_file', onEvent, 'normal'),
    ).rejects.toThrow(PathAccessDeniedError)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('ask falls through to the native confirmation dialog', async () => {
    setPluginApprovalReviewers([{ pluginId: 'jev', reviewer: { id: 'jev', evaluate: () => ({ action: 'ask' }) } }])
    const onEvent = vi.fn()
    const pending = requestPathAccess([OUTSIDE_PATH], WORKDIR, SESSION_ID, 'call-3', 'read_file', onEvent, 'normal')
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1))
    expect(String((onEvent.mock.calls[0]?.[0] as { type?: string })?.type ?? '')).toContain('confirmation')
    // resolve the pending dialog so the test cleans up
    const { providePathConfirmation } = await import('./path-security.js')
    providePathConfirmation('call-3', false)
    await expect(pending).rejects.toThrow(PathAccessDeniedError)
  })

  it('reviewer failure falls back to the native dialog (fail-closed)', async () => {
    setPluginApprovalReviewers([
      {
        pluginId: 'jev',
        reviewer: {
          id: 'jev',
          evaluate: () => Promise.reject(new Error('backend offline')),
        },
      },
    ])
    const onEvent = vi.fn()
    const pending = requestPathAccess([OUTSIDE_PATH], WORKDIR, SESSION_ID, 'call-4', 'read_file', onEvent, 'normal')
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1))
    const { providePathConfirmation } = await import('./path-security.js')
    providePathConfirmation('call-4', false)
    await expect(pending).rejects.toThrow(PathAccessDeniedError)
  })

  it('no reviewer registered: native behavior unchanged', async () => {
    const onEvent = vi.fn()
    const pending = requestPathAccess([OUTSIDE_PATH], WORKDIR, SESSION_ID, 'call-5', 'read_file', onEvent, 'normal')
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1))
    const { providePathConfirmation } = await import('./path-security.js')
    providePathConfirmation('call-5', false)
    await expect(pending).rejects.toThrow(PathAccessDeniedError)
  })

  it('mandatory git --no-verify rule is never downgraded by a reviewer allow', async () => {
    const evaluate = vi.fn().mockReturnValue({ action: 'allow' })
    setPluginApprovalReviewers([{ pluginId: 'jev', reviewer: { id: 'jev', evaluate } }])
    const onEvent = vi.fn()

    const pending = requestPathAccess(
      [WORKDIR],
      WORKDIR,
      SESSION_ID,
      'call-git',
      'run_command',
      onEvent,
      'normal',
      'git commit -m "x" --no-verify',
    )
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1))
    // Reviewer must NOT have been consulted — the mandatory rule asks first.
    expect(evaluate).not.toHaveBeenCalled()
    const { providePathConfirmation } = await import('./path-security.js')
    providePathConfirmation('call-git', false)
    await expect(pending).rejects.toThrow(PathAccessDeniedError)
  })

  it('mandatory dangerous-command rule is never downgraded by a reviewer allow', async () => {
    const evaluate = vi.fn().mockReturnValue({ action: 'allow' })
    setPluginApprovalReviewers([{ pluginId: 'jev', reviewer: { id: 'jev', evaluate } }])
    const onEvent = vi.fn()

    const pending = requestPathAccess(
      [WORKDIR],
      WORKDIR,
      SESSION_ID,
      'call-danger',
      'run_command',
      onEvent,
      'normal',
      'sudo rm -rf /',
    )
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1))
    expect(evaluate).not.toHaveBeenCalled()
    const { providePathConfirmation } = await import('./path-security.js')
    providePathConfirmation('call-danger', false)
    await expect(pending).rejects.toThrow(PathAccessDeniedError)
  })

  it('night mode never consults the reviewer (fail-closed)', async () => {
    const evaluate = vi.fn().mockReturnValue({ action: 'allow' })
    setPluginApprovalReviewers([{ pluginId: 'jev', reviewer: { id: 'jev', evaluate } }])
    const onEvent = vi.fn()
    await expect(
      requestPathAccess(
        [OUTSIDE_PATH],
        WORKDIR,
        SESSION_ID,
        'call-night',
        'read_file',
        onEvent,
        'normal',
        undefined,
        false,
        undefined,
        true,
      ),
    ).rejects.toThrow(PathAccessDeniedError)
    expect(evaluate).not.toHaveBeenCalled()
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('sub-agents never consult the reviewer (fail-closed)', async () => {
    const evaluate = vi.fn().mockReturnValue({ action: 'allow' })
    setPluginApprovalReviewers([{ pluginId: 'jev', reviewer: { id: 'jev', evaluate } }])
    const onEvent = vi.fn()
    await expect(
      requestPathAccess(
        [OUTSIDE_PATH],
        WORKDIR,
        SESSION_ID,
        'call-sub',
        'read_file',
        onEvent,
        'normal',
        undefined,
        true,
      ),
    ).rejects.toThrow(PathAccessDeniedError)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('passes operation context to the reviewer', async () => {
    const evaluate = vi.fn().mockReturnValue({ action: 'allow' })
    setPluginApprovalReviewers([{ pluginId: 'jev', reviewer: { id: 'jev', evaluate } }])
    const onEvent = vi.fn()
    await requestPathAccess(
      [OUTSIDE_PATH],
      WORKDIR,
      SESSION_ID,
      'call-ctx',
      'read_file',
      onEvent,
      'normal',
      'cat /etc/passwd',
    )
    const ctx = evaluate.mock.calls[0]?.[0] as PluginApprovalContext
    expect(ctx.kind).toBe('path')
    expect(ctx.tool).toBe('read_file')
    expect(ctx.command).toBe('cat /etc/passwd')
    expect(ctx.reason).toBe('outside_workdir')
    expect(ctx.paths).toEqual([OUTSIDE_PATH])
    expect(ctx.dangerLevel).toBe('normal')
  })
})
