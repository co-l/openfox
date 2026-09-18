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

vi.mock('./tailscale-preview.js', () => ({
  tailscalePreviewManager: {
    start: vi.fn(),
    stop: vi.fn(),
    stopAll: vi.fn(),
    isActive: vi.fn(),
    getActiveUrl: vi.fn(),
  },
  isTailscaleAvailable: vi.fn(),
}))

vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn(() => ({ mode: 'development' })),
}))

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { devServerManager } from './manager.js'
import { tailscalePreviewManager, isTailscaleAvailable } from './tailscale-preview.js'

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
      tailscaleExpose: false,
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
      tailscaleExpose: false,
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

  it('reads tailscaleExpose=true when present in config', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        command: 'npm run dev',
        url: 'http://localhost:5173',
        tailscaleExpose: true,
      }),
    )
    const config = await devServerManager.loadConfig('/some/project')
    expect(config?.tailscaleExpose).toBe(true)
  })

  it('reads tailscaleExpose=false when explicitly set', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        command: 'npm run dev',
        url: 'http://localhost:5173',
        tailscaleExpose: false,
      }),
    )
    const config = await devServerManager.loadConfig('/some/project')
    expect(config?.tailscaleExpose).toBe(false)
  })

  it('defaults tailscaleExpose to false when absent', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ command: 'npm run dev', url: 'http://localhost:5173' }))
    const config = await devServerManager.loadConfig('/some/project')
    expect(config?.tailscaleExpose).toBe(false)
  })

  it('coerces non-boolean tailscaleExpose values to false (strict opt-in)', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        command: 'npm run dev',
        url: 'http://localhost:5173',
        tailscaleExpose: 'yes',
      }),
    )
    const config = await devServerManager.loadConfig('/some/project')
    expect(config?.tailscaleExpose).toBe(false)
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

  it('does NOT auto-launch preview when tailscaleExpose is absent (default OFF)', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ command: 'npm run dev', url: 'http://localhost:3200' }))
    vi.mocked(spawn).mockReturnValue(makeMockProc('server started') as any)

    await devServerManager.start('/tmp/project-no-tailscale')

    expect(tailscalePreviewManager.start).not.toHaveBeenCalled()
  })

  it('does NOT auto-launch preview when tailscaleExpose is explicitly false', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        command: 'npm run dev',
        url: 'http://localhost:3201',
        tailscaleExpose: false,
      }),
    )
    vi.mocked(spawn).mockReturnValue(makeMockProc('server started') as any)

    await devServerManager.start('/tmp/project-tailscale-off')

    expect(tailscalePreviewManager.start).not.toHaveBeenCalled()
  })

  it('auto-launches preview fire-and-forget when tailscaleExpose is true', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        command: 'npm run dev',
        url: 'http://localhost:3202',
        tailscaleExpose: true,
      }),
    )
    vi.mocked(spawn).mockReturnValue(makeMockProc('server started') as any)
    vi.mocked(isTailscaleAvailable).mockResolvedValue({
      available: true,
      nodeName: 'laptop.tailnet.ts.net',
    })
    vi.mocked(tailscalePreviewManager.start).mockResolvedValue({
      url: 'https://laptop.tailnet.ts.net:8443/',
      remotePort: 8443,
    })

    const status = await devServerManager.start('/tmp/project-tailscale-on')

    // start() returns immediately at state=running; preview launches async
    expect(status.state).toBe('running')
    // The fire-and-forget promise resolves on the next microtask tick
    await new Promise((resolve) => setImmediate(resolve))
    expect(tailscalePreviewManager.start).toHaveBeenCalledTimes(1)
    expect(tailscalePreviewManager.start).toHaveBeenCalledWith('/tmp/project-tailscale-on', expect.any(Number))
  })

  it('start() does not reject when preview auto-launch fails (caught internally)', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        command: 'npm run dev',
        url: 'http://localhost:3203',
        tailscaleExpose: true,
      }),
    )
    vi.mocked(spawn).mockReturnValue(makeMockProc('server started') as any)
    vi.mocked(isTailscaleAvailable).mockResolvedValue({
      available: true,
      nodeName: 'laptop.tailnet.ts.net',
    })
    // Preview throws after a microtask — start() must still resolve with state=running
    vi.mocked(tailscalePreviewManager.start).mockImplementation(async () => {
      await new Promise((resolve) => setImmediate(resolve))
      throw new Error('Access denied: serve config denied')
    })

    const status = await devServerManager.start('/tmp/project-tailscale-throws')
    expect(status.state).toBe('running')

    // Let the fire-and-forget resolve and confirm no unhandled rejection
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
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

describe('tailscalePreview integration', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset()
    vi.mocked(spawn).mockReset()
    vi.mocked(tailscalePreviewManager.start).mockReset()
    vi.mocked(tailscalePreviewManager.stop).mockReset()
    vi.mocked(tailscalePreviewManager.stopAll).mockReset()
    // Default: Tailscale is available. Individual tests can override.
    vi.mocked(isTailscaleAvailable).mockResolvedValue({ available: true, nodeName: 'laptop.ts.net' })
  })

  it('initial status includes a default tailscalePreview of status idle', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ command: 'npm run dev', url: 'http://localhost:3110' }))
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)
    await devServerManager.start('/tmp/preview-init')
    const status = devServerManager.getStatus('/tmp/preview-init')
    expect(status.tailscalePreview).toEqual({ status: 'idle' })
  })

  it('startTailscalePreview rejects when dev server is not running', async () => {
    const status = await devServerManager.startTailscalePreview('/tmp/no-server')
    expect(status.tailscalePreview.status).toBe('error')
    expect(status.tailscalePreview.error).toMatch(/not running/i)
  })

  it('startTailscalePreview is idempotent when a preview is already active', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ command: 'npm run dev', url: 'http://localhost:3111' }))
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)
    await devServerManager.start('/tmp/preview-already')

    vi.mocked(tailscalePreviewManager.start).mockResolvedValue({
      url: 'https://x.ts.net:8443/',
      remotePort: 8443,
    })

    const first = await devServerManager.startTailscalePreview('/tmp/preview-already')
    expect(first.tailscalePreview).toEqual({ status: 'active', url: 'https://x.ts.net:8443/' })

    // Second call should be a no-op: returns the current active URL, no overwrite.
    const second = await devServerManager.startTailscalePreview('/tmp/preview-already')
    expect(second.tailscalePreview).toEqual({ status: 'active', url: 'https://x.ts.net:8443/' })
    // Only one underlying start should have happened.
    expect(tailscalePreviewManager.start).toHaveBeenCalledTimes(1)
  })

  it('startTailscalePreview transitions to active when preview manager succeeds', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ command: 'npm run dev', url: 'http://localhost:3112' }))
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)
    await devServerManager.start('/tmp/preview-success')

    vi.mocked(tailscalePreviewManager.start).mockResolvedValue({
      url: 'https://laptop.ts.net:8443/',
      remotePort: 8443,
    })

    const status = await devServerManager.startTailscalePreview('/tmp/preview-success')
    expect(status.tailscalePreview).toEqual({ status: 'active', url: 'https://laptop.ts.net:8443/' })
  })

  it('startTailscalePreview records error when preview manager throws', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ command: 'npm run dev', url: 'http://localhost:3113' }))
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)
    await devServerManager.start('/tmp/preview-fail')

    vi.mocked(tailscalePreviewManager.start).mockRejectedValue(new Error('Access denied: serve config denied'))

    const status = await devServerManager.startTailscalePreview('/tmp/preview-fail')
    expect(status.tailscalePreview.status).toBe('error')
    expect(status.tailscalePreview.error).toContain('Access denied')
  })

  it('startTailscalePreview surfaces a clear error when Tailscale is not available', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ command: 'npm run dev', url: 'http://localhost:3113a' }))
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)
    await devServerManager.start('/tmp/preview-unavailable')

    vi.mocked(isTailscaleAvailable).mockResolvedValueOnce({
      available: false,
      reason: 'spawn tailscale ENOENT',
    })

    const status = await devServerManager.startTailscalePreview('/tmp/preview-unavailable')
    expect(status.tailscalePreview.status).toBe('error')
    expect(status.tailscalePreview.error).toContain('ENOENT')
    expect(tailscalePreviewManager.start).not.toHaveBeenCalled()
  })

  it('stopTailscalePreview returns to idle and calls preview manager stop', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ command: 'npm run dev', url: 'http://localhost:3114' }))
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)
    await devServerManager.start('/tmp/preview-stop')

    vi.mocked(tailscalePreviewManager.start).mockResolvedValue({
      url: 'https://laptop.ts.net:8443/',
      remotePort: 8443,
    })
    vi.mocked(tailscalePreviewManager.stop).mockResolvedValue(undefined)

    await devServerManager.startTailscalePreview('/tmp/preview-stop')
    const status = await devServerManager.stopTailscalePreview('/tmp/preview-stop')
    expect(status.tailscalePreview).toEqual({ status: 'idle' })
    expect(tailscalePreviewManager.stop).toHaveBeenCalledWith('/tmp/preview-stop')
  })

  it('stop() on the dev server also tears down the active Tailscale preview', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ command: 'npm run dev', url: 'http://localhost:3115' }))
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)
    await devServerManager.start('/tmp/preview-coupled')

    vi.mocked(tailscalePreviewManager.start).mockResolvedValue({
      url: 'https://laptop.ts.net:8443/',
      remotePort: 8443,
    })
    vi.mocked(tailscalePreviewManager.stop).mockResolvedValue(undefined)

    await devServerManager.startTailscalePreview('/tmp/preview-coupled')
    await devServerManager.stop('/tmp/preview-coupled')
    expect(tailscalePreviewManager.stop).toHaveBeenCalledWith('/tmp/preview-coupled')
    const status = devServerManager.getStatus('/tmp/preview-coupled')
    expect(status.tailscalePreview).toEqual({ status: 'idle' })
  })

  it('stopAll() tears down every Tailscale preview', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ command: 'npm run dev', url: 'http://localhost:3116' }))
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)
    await devServerManager.start('/tmp/preview-stopall-a')
    await devServerManager.start('/tmp/preview-stopall-b')

    vi.mocked(tailscalePreviewManager.start).mockResolvedValue({
      url: 'https://x.ts.net:8443/',
      remotePort: 8443,
    })
    vi.mocked(tailscalePreviewManager.stopAll).mockResolvedValue(undefined)
    vi.mocked(tailscalePreviewManager.stop).mockResolvedValue(undefined)

    await devServerManager.startTailscalePreview('/tmp/preview-stopall-a')
    await devServerManager.startTailscalePreview('/tmp/preview-stopall-b')

    await devServerManager.stopAll()
    expect(tailscalePreviewManager.stopAll).toHaveBeenCalled()
  })
})
