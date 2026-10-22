import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolve } from 'node:path'
import {
  requestPathAccess,
  providePathConfirmation,
  clearAllowedPaths,
  PathAccessDeniedError,
} from './path-security.js'

const { loggerInfo } = vi.hoisted(() => ({ loggerInfo: vi.fn() }))

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: loggerInfo, warn: vi.fn(), error: vi.fn() },
}))

const SESSION_ID = 'reason-code-session'
const WORKDIR = '/app/project'
const INSIDE_PATH = resolve(WORKDIR, 'src/file.ts')

function reasonCodes(): string[] {
  return (loggerInfo.mock.calls as Array<[string, Record<string, unknown>]>)
    .filter(([message]) => message === 'approval.mandatory_rule_resolved')
    .map(([, context]) => context['reasonCode'] as string)
}

describe('mandatory rule reason codes (emitted before the reviewer is consulted)', () => {
  beforeEach(() => {
    loggerInfo.mockReset()
    clearAllowedPaths(SESSION_ID)
  })

  it('night mode emits night_mode before auto-resolution', async () => {
    const onEvent = vi.fn()
    await expect(
      requestPathAccess(
        ['/etc/passwd'],
        WORKDIR,
        SESSION_ID,
        'call-night',
        'read_file',
        onEvent,
        'normal',
        undefined,
        undefined,
        undefined,
        true,
      ),
    ).rejects.toBeInstanceOf(PathAccessDeniedError)
    expect(reasonCodes()).toContain('night_mode')
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('sub-agent emits sub_agent before auto-resolution', async () => {
    const onEvent = vi.fn()
    await expect(
      requestPathAccess(
        ['/etc/passwd'],
        WORKDIR,
        SESSION_ID,
        'call-sub',
        'read_file',
        onEvent,
        'normal',
        undefined,
        true,
      ),
    ).rejects.toBeInstanceOf(PathAccessDeniedError)
    expect(reasonCodes()).toContain('sub_agent')
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('git --no-verify emits git_no_verify and requires an explicit confirmation', async () => {
    const onEvent = vi.fn()
    const promise = requestPathAccess(
      [INSIDE_PATH],
      WORKDIR,
      SESSION_ID,
      'call-noverify',
      'run_command',
      onEvent,
      'normal',
      'git commit --no-verify -m "skip hooks"',
    )
    providePathConfirmation('call-noverify', false)
    await expect(promise).rejects.toThrow(PathAccessDeniedError)
    expect(reasonCodes()).toContain('git_no_verify')
    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it('a dangerous command pattern emits dangerous_command and requires an explicit confirmation', async () => {
    const onEvent = vi.fn()
    const promise = requestPathAccess(
      [INSIDE_PATH],
      WORKDIR,
      SESSION_ID,
      'call-dangerous',
      'run_command',
      onEvent,
      'normal',
      'sudo ls /etc',
    )
    providePathConfirmation('call-dangerous', false)
    await expect(promise).rejects.toThrow(PathAccessDeniedError)
    expect(reasonCodes()).toContain('dangerous_command')
    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it('an allowed in-workdir operation emits no reason code', async () => {
    const onEvent = vi.fn()
    await requestPathAccess([INSIDE_PATH], WORKDIR, SESSION_ID, 'call-ok', 'read_file', onEvent, 'normal')
    expect(reasonCodes()).toEqual([])
  })
})
