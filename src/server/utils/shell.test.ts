import { describe, it, expect, vi } from 'vitest'
import { spawn } from 'node:child_process'

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn().mockReturnValue({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
  }),
}))

vi.mock('./platform.js', () => ({
  getPlatformShell: () => ({ command: '/bin/sh', args: ['-c'] }),
}))

const { spawnShell, spawnShellProcess } = await import('./shell.js')

function withPlatform(platform: NodeJS.Platform, fn: () => void): void {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    fn()
  } finally {
    Object.defineProperty(process, 'platform', { value: original })
  }
}

describe('spawnShell', () => {
  it('passes windowsHide: true and no FORCE_COLOR in spawn options', () => {
    spawnShell('echo hello', { cwd: '/tmp' })

    expect(spawn).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', 'echo hello'],
      expect.objectContaining({
        cwd: '/tmp',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }),
    )
    // Verify spawnShell does not override FORCE_COLOR (was hardcoded to '0' before)
    const callArgs = vi.mocked(spawn).mock.calls[0]![2] as Record<string, unknown>
    const env = callArgs['env'] as Record<string, string | undefined>
    expect(env['FORCE_COLOR']).toBe(process.env['FORCE_COLOR'])
  })

  it('passes detached flag when set (non-win32)', () => {
    withPlatform('linux', () => {
      spawnShell('echo hello', { cwd: '/tmp', detached: true })
    })

    expect(spawn).toHaveBeenCalledWith('/bin/sh', ['-c', 'echo hello'], expect.objectContaining({ detached: true }))
  })

  it('ignores detached flag on win32 (visible console + MSYS pipe hangs)', () => {
    withPlatform('win32', () => {
      spawnShell('echo hello', { cwd: '/tmp', detached: true })
    })

    expect(spawn).toHaveBeenCalledWith('/bin/sh', ['-c', 'echo hello'], expect.not.objectContaining({ detached: true }))
  })

  it('does not set detached when not requested', () => {
    spawnShell('echo hello', { cwd: '/tmp' })

    expect(spawn).toHaveBeenCalledWith('/bin/sh', ['-c', 'echo hello'], expect.not.objectContaining({ detached: true }))
  })
})

describe('spawnShellProcess', () => {
  it('delegates to spawnShell with positional args', () => {
    withPlatform('linux', () => {
      spawnShellProcess('echo hello', '/tmp', undefined, true)
    })

    expect(spawn).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', 'echo hello'],
      expect.objectContaining({ windowsHide: true, detached: true }),
    )
  })
})
