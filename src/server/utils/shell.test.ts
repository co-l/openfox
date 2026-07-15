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

const { spawnShellProcess } = await import('./shell.js')

describe('spawnShellProcess', () => {
  it('passes windowsHide: true in spawn options', () => {
    spawnShellProcess('echo hello', '/tmp')

    expect(spawn).toHaveBeenCalledWith('/bin/sh', ['-c', 'echo hello'], expect.objectContaining({ windowsHide: true }))
  })
})
