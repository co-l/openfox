import { describe, it, expect, vi, beforeEach } from 'vitest'
import net from 'node:net'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('../utils/process-tree.js', () => ({
  terminateProcessTree: vi.fn(),
}))

vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn(() => ({ mode: 'development' })),
}))

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { devServerManager } from './manager.js'

function makeMockProc(stdout = '', stderr = '', exitCode = 0) {
  const listeners: Record<string, (arg: unknown) => void> = {}
  const mock: any = {
    stdout: {
      on: vi.fn((event: string, cb: (d: Buffer) => void) => {
        if (event === 'data' && stdout) setTimeout(() => cb(Buffer.from(stdout)), 0)
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: (d: Buffer) => void) => {
        if (event === 'data' && stderr) setTimeout(() => cb(Buffer.from(stderr)), 0)
      }),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] = cb as any
      if (event === 'close' && exitCode !== undefined) {
        setTimeout(() => cb(exitCode), 0)
      }
    }),
    pid: 12345,
  }
  return mock
}

/** Start a TCP server on a random port and return the port number */
async function startTestListener(): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = addr && typeof addr === 'object' ? addr.port : 0
  return { server, port }
}

describe('probePort', () => {
  it('returns false when port is free', async () => {
    const result = await devServerManager.probePort('127.0.0.1', 18601)
    expect(result).toBe(false)
  })

  it('returns true when port is in use', async () => {
    const { server, port } = await startTestListener()
    try {
      const result = await devServerManager.probePort('127.0.0.1', port)
      expect(result).toBe(true)
    } finally {
      server.close()
    }
  })
})

describe('findFreePort', () => {
  it('returns the same port when it is free', async () => {
    const port = await devServerManager.findFreePort('127.0.0.1', 18801)
    expect(port).toBe(18801)
  })

  it('scans upward when port is taken', async () => {
    const { server, port } = await startTestListener()
    try {
      const found = await devServerManager.findFreePort('127.0.0.1', port)
      expect(found).toBeGreaterThan(port)
    } finally {
      server.close()
    }
  })

  it('throws when all ports in range are taken', async () => {
    // Occupy a batch of consecutive ports to force exhaustion
    const servers: net.Server[] = []
    const startPort = 18501
    try {
      for (let i = 0; i < 5; i++) {
        const s = net.createServer()
        await new Promise<void>((resolve, reject) => {
          s.listen(startPort + i, '127.0.0.1', () => resolve())
          s.on('error', reject)
        })
        servers.push(s)
      }
      // findFreePort with MAX_PORT_SCAN=200, but we only occupy 5 ports starting at 18501
      // It should find a free port beyond 18505, so this should succeed
      // To test exhaustion we'd need to occupy 200+ ports which is impractical.
      // Instead, verify it throws for impossible ranges by monkey-patching probePort
      vi.spyOn(devServerManager, 'probePort').mockResolvedValue(true)
      await expect(devServerManager.findFreePort('127.0.0.1', 18401)).rejects.toThrow('No free port found')
      vi.mocked(devServerManager.probePort).mockRestore()
    } finally {
      for (const s of servers) s.close()
    }
  })
})

describe('substitutePort', () => {
  it('replaces ${PORT} in command', () => {
    const cmd = devServerManager.substitutePort('npm run dev -- -p ${PORT}', 3456)
    expect(cmd).toBe('npm run dev -- -p 3456')
  })

  it('replaces ${PORT} in url', () => {
    const url = devServerManager.substitutePort('http://localhost:${PORT}', 3456)
    expect(url).toBe('http://localhost:3456')
  })

  it('leaves strings without ${PORT} unchanged', () => {
    expect(devServerManager.substitutePort('npm run dev', 3456)).toBe('npm run dev')
    expect(devServerManager.substitutePort('http://localhost:3000', 3456)).toBe('http://localhost:3000')
  })

  it('replaces multiple occurrences', () => {
    const cmd = devServerManager.substitutePort('echo ${PORT} && echo ${PORT}', 8080)
    expect(cmd).toBe('echo 8080 && echo 8080')
  })
})

describe('loadConfig with workspace fallback', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset()
  })

  it('loads config from primary path when present', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ command: 'npm run dev', url: 'http://localhost:5173' }))
    const config = await devServerManager.loadConfig('/some/project')
    expect(config).toEqual({
      command: 'npm run dev',
      url: 'http://localhost:5173',
      hotReload: false,
      disableInspect: false,
    })
  })

  it('falls back to project root when workspace path has no config', async () => {
    vi.mocked(readFile)
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(JSON.stringify({ command: 'npm run dev', url: 'http://localhost:5173' }))

    const config = await devServerManager.loadConfig('/some/project/workspaces/my-feature')
    expect(config).toEqual({
      command: 'npm run dev',
      url: 'http://localhost:5173',
      hotReload: false,
      disableInspect: false,
    })
    expect(readFile).toHaveBeenCalledTimes(2)
  })

  it('falls back to project root for a backslash workspace path (Windows)', async () => {
    vi.mocked(readFile)
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(JSON.stringify({ command: 'npm run dev', url: 'http://localhost:5173' }))

    const config = await devServerManager.loadConfig('C:\\Users\\me\\AppData\\Local\\openfox\\workspaces\\my-feature')
    expect(config).toMatchObject({ command: 'npm run dev', url: 'http://localhost:5173' })
    expect(readFile).toHaveBeenCalledTimes(2)
  })

  it('returns null when neither path has config', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
    const config = await devServerManager.loadConfig('/some/project/workspaces/my-feature')
    expect(config).toBeNull()
  })

  it('works without fallback (non-workspace path)', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
    const config = await devServerManager.loadConfig('/some/project')
    expect(config).toBeNull()
    expect(readFile).toHaveBeenCalledTimes(1)
  })
})

describe('start with port probing and substitution', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset()
    vi.mocked(spawn).mockReset()
  })

  it('probes port and substitutes ${PORT} in command and url', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ command: 'npm run dev -- -p ${PORT}', url: 'http://localhost:${PORT}' }),
    )
    vi.mocked(spawn).mockReturnValue(makeMockProc('server started') as any)

    const status = await devServerManager.start('/tmp/project')

    expect(status.state).toBe('running')
    expect(status.url).toMatch(/http:\/\/localhost:\d+/)
    expect(status.url).not.toContain('${PORT}')
  })

  it('assigns a different port when configured port is taken', async () => {
    const { server, port } = await startTestListener()
    try {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ command: 'npm run dev -- -p ${PORT}', url: 'http://localhost:${PORT}' }),
      )
      vi.mocked(spawn).mockReturnValue(makeMockProc('server started') as any)

      const status = await devServerManager.start('/tmp/project2')

      expect(status.state).toBe('running')
      expect(status.url).not.toBe(`http://localhost:${port}`)
      expect(status.url).toMatch(/http:\/\/localhost:\d+/)
    } finally {
      server.close()
    }
  })

  it('works with hardcoded port (no template)', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ command: 'npm run dev', url: 'http://localhost:3099' }))
    vi.mocked(spawn).mockReturnValue(makeMockProc('server started') as any)

    const status = await devServerManager.start('/tmp/project3')

    expect(status.state).toBe('running')
    expect(status.url).toBe('http://localhost:3099')
  })
})

describe('instance keying by workdir', () => {
  it('creates separate instances for different workdirs', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ command: 'npm run dev', url: 'http://localhost:3100' }))
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)

    const status1 = await devServerManager.start('/tmp/project-a')
    const status2 = await devServerManager.start('/tmp/project-b')

    expect(status1.state).toBe('running')
    expect(status2.state).toBe('running')
  })
})

describe('clearLogs', () => {
  it('clears all logs for a workdir', () => {
    const workdir = '/tmp/clear-test'
    const instance = (devServerManager as any).getInstance(workdir)
    instance.logs = [
      { stream: 'stdout', content: 'line1' },
      { stream: 'stderr', content: 'line2' },
    ]
    instance.totalLogBytes = 10

    devServerManager.clearLogs(workdir)

    expect(instance.logs).toEqual([])
    expect(instance.totalLogBytes).toBe(0)
  })

  it('returns logs as empty array after clear', () => {
    const workdir = '/tmp/clear-test2'
    const instance = (devServerManager as any).getInstance(workdir)
    instance.logs = [{ stream: 'stdout', content: 'something' }]
    instance.totalLogBytes = 9

    devServerManager.clearLogs(workdir)

    expect(devServerManager.getLogs(workdir)).toEqual([])
  })

  it('is idempotent on already empty logs', () => {
    const workdir = '/tmp/clear-test3'
    devServerManager.clearLogs(workdir)
    expect(devServerManager.getLogs(workdir)).toEqual([])
  })
})

describe('insertMarker', () => {
  it('inserts a marker entry into logs', () => {
    const workdir = '/tmp/marker-test'
    devServerManager.clearLogs(workdir)
    const instance = (devServerManager as any).getInstance(workdir)
    instance.logs = [{ stream: 'stdout', content: 'before' }]
    instance.totalLogBytes = 6

    devServerManager.insertMarker(workdir)

    const logs = devServerManager.getLogs(workdir)
    expect(logs).toHaveLength(2)
    expect(logs[1]).toMatchObject({
      stream: 'stdout',
      type: 'marker',
    })
    expect(typeof logs[1]?.content).toBe('string')
    expect(logs[1]?.content?.length).toBeGreaterThan(0)
  })

  it('inserts marker into empty logs', () => {
    const workdir = '/tmp/marker-test2'
    devServerManager.clearLogs(workdir)

    devServerManager.insertMarker(workdir)

    const logs = devServerManager.getLogs(workdir)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ stream: 'stdout', type: 'marker' })
  })

  it('does not affect other workdirs', () => {
    const workdirA = '/tmp/marker-isolation-a'
    const workdirB = '/tmp/marker-isolation-b'
    devServerManager.clearLogs(workdirA)
    devServerManager.clearLogs(workdirB)

    const instanceA = (devServerManager as any).getInstance(workdirA)
    instanceA.logs = [{ stream: 'stdout', content: 'only in A' }]
    instanceA.totalLogBytes = 8

    devServerManager.insertMarker(workdirA)

    const logsA = devServerManager.getLogs(workdirA)
    const logsB = devServerManager.getLogs(workdirB)
    expect(logsA).toHaveLength(2)
    expect(logsB).toHaveLength(0)
  })
})
