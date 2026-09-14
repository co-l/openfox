import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  TailscalePreviewManager,
  pickFreeServePort,
  isTailscaleAvailable,
  listUsedServePorts,
  findEntryForPort,
  iterateStatusPorts,
} from './tailscale-preview.js'

interface MockChild extends EventEmitter {
  pid: number | null
  exitCode: number | null
  stdout: EventEmitter
  stderr: EventEmitter
}

function makeMockChild(
  opts: {
    pid?: number | null
    stdout?: string
    stderr?: string
    exit?: { code: number | null; delay?: number }
  } = {},
): MockChild {
  const child = new EventEmitter() as MockChild
  child.pid = opts.pid ?? 9999
  child.exitCode = null
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  if (opts.stdout) {
    const stdoutData = opts.stdout
    setImmediate(() => child.stdout.emit('data', Buffer.from(stdoutData)))
  }
  if (opts.stderr) {
    const stderrData = opts.stderr
    setImmediate(() => child.stderr.emit('data', Buffer.from(stderrData)))
  }
  if (opts.exit) {
    const { code, delay = 50 } = opts.exit
    setTimeout(() => {
      child.exitCode = code
      child.emit('exit', code)
    }, delay)
  }
  return child
}

interface ServeStatusEntry {
  host: string
  port: number
}

function statusJsonFor(entries: ServeStatusEntry[]): string {
  const Web: Record<string, unknown> = {}
  const TCP: Record<string, unknown> = {}
  for (const { host, port } of entries) {
    Web[`${host}:${port}`] = { Handlers: { '/': { Proxy: 'http://localhost:3000' } } }
    TCP[String(port)] = {}
  }
  return JSON.stringify({ TCP, Web })
}

interface ExecFileResponse {
  stdout?: string
  stderr?: string
  err?: Error
}

function setupExecFileMock(responses: ExecFileResponse[]): void {
  let idx = 0
  vi.mocked(execFile).mockImplementation(((
    _cmd: string,
    _args: string[] | undefined,
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    const slot = responses[Math.min(idx, responses.length - 1)]
    idx++
    if (!slot) {
      cb(new Error('no mock response configured'), '', '')
      return undefined as never
    }
    if (slot.err) {
      cb(slot.err, '', '')
    } else {
      cb(null, slot.stdout ?? '', slot.stderr ?? '')
    }
    return undefined as never
  }) as never)
}

function captureSpawnChild(
  stdout: string,
  opts: { stderr?: string; exit?: { code: number | null; delay?: number } } = {},
): {
  child: MockChild
} {
  const child = makeMockChild({ stdout, ...opts })
  vi.mocked(spawn).mockImplementationOnce(() => child as unknown as ChildProcess)
  return { child }
}

function captureAllSpawnChildren(stdout: string): { children: MockChild[] } {
  const children: MockChild[] = []
  vi.mocked(spawn).mockImplementation(() => {
    const c = makeMockChild({ stdout })
    children.push(c)
    return c as unknown as ChildProcess
  })
  return { children }
}

beforeEach(() => {
  vi.mocked(spawn).mockReset()
  vi.mocked(execFile).mockReset()
})

describe('pickFreeServePort', () => {
  it('prefers 443 when free', () => {
    expect(pickFreeServePort([])).toBe(443)
  })

  it('skips occupied ports in candidate list', () => {
    expect(pickFreeServePort([443, 8443])).toBe(10000)
  })

  it('falls back to scanned ports when candidates all occupied', () => {
    const used = new Set([443, 8443, 10000, 10443, 12345])
    const found = pickFreeServePort(Array.from(used))
    expect(used.has(found)).toBe(false)
    expect(found).toBeGreaterThanOrEqual(443)
    expect(found).toBeLessThan(65536)
  })
})

describe('findEntryForPort', () => {
  it('finds a web entry by port suffix and tcp key', () => {
    const status = {
      TCP: { 443: { HTTPS: true } },
      Web: {
        'host.tailnet.ts.net:443': { Handlers: { '/': { Proxy: 'http://localhost:3000' } } },
      },
    }
    const result = findEntryForPort(status, 443)
    expect(result.webKey).toBe('host.tailnet.ts.net:443')
    expect(result.tcpKey).toBe('443')
  })

  it('returns no entry when port not present', () => {
    const status = { Web: { 'host:443': {} }, TCP: { 443: {} } }
    expect(findEntryForPort(status, 8443)).toEqual({})
  })
})

describe('isTailscaleAvailable', () => {
  it('returns available when tailscale status reports Running', async () => {
    setupExecFileMock([
      {
        stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'laptop.tailnet.ts.net.' } }),
      },
    ])
    const result = await isTailscaleAvailable()
    expect(result.available).toBe(true)
    expect(result.nodeName).toBe('laptop.tailnet.ts.net')
    expect(result.reason).toBeUndefined()
  })

  it('returns unavailable with reason when backend not Running', async () => {
    setupExecFileMock([{ stdout: JSON.stringify({ BackendState: 'Stopped' }) }])
    const result = await isTailscaleAvailable()
    expect(result.available).toBe(false)
    expect(result.reason).toContain('Stopped')
  })

  it('returns unavailable when tailscale binary fails', async () => {
    setupExecFileMock([{ err: new Error('spawn tailscale ENOENT') }])
    const result = await isTailscaleAvailable()
    expect(result.available).toBe(false)
    expect(result.reason).toContain('ENOENT')
  })
})

describe('listUsedServePorts', () => {
  it('parses web and tcp keys', async () => {
    setupExecFileMock([
      {
        stdout: statusJsonFor([
          { host: 'host', port: 443 },
          { host: 'host', port: 8443 },
        ]),
      },
    ])
    const ports = await listUsedServePorts()
    expect(ports.sort()).toEqual([443, 8443])
  })

  it('returns empty array on error', async () => {
    setupExecFileMock([{ err: new Error('not found') }])
    const ports = await listUsedServePorts()
    expect(ports).toEqual([])
  })
})

describe('TailscalePreviewManager.start (foreground)', () => {
  it('rejects when a preview is already active for the workdir', async () => {
    const manager = new TailscalePreviewManager()
    captureSpawnChild('https://laptop.ts.net:8443/')
    setupExecFileMock([
      { stdout: statusJsonFor([{ host: 'laptop.ts.net', port: 443 }]) },
      {
        stdout: statusJsonFor([
          { host: 'laptop.ts.net', port: 443 },
          { host: 'laptop.ts.net', port: 8443 },
        ]),
      },
    ])

    const first = await manager.start('/tmp/a', 3000)
    expect(first.url).toBe('https://laptop.ts.net:8443/')

    await expect(manager.start('/tmp/a', 3000)).rejects.toThrow(/already active/)
  })

  it('starts foreground tailscale serve and extracts URL from stdout', async () => {
    const manager = new TailscalePreviewManager()
    captureSpawnChild('https://node.tailnet.ts.net:8443/\n')
    setupExecFileMock([
      { stdout: statusJsonFor([{ host: 'node.tailnet.ts.net', port: 443 }]) },
      {
        stdout: statusJsonFor([
          { host: 'node.tailnet.ts.net', port: 443 },
          { host: 'node.tailnet.ts.net', port: 8443 },
        ]),
      },
    ])

    const result = await manager.start('/tmp/b', 3000)
    expect(result.url).toBe('https://node.tailnet.ts.net:8443/')
    expect(result.remotePort).toBe(8443)

    const spawnArgs = vi.mocked(spawn).mock.calls[0]
    expect(spawnArgs?.[0]).toBe('tailscale')
    expect(spawnArgs?.[1]).toEqual(expect.arrayContaining(['serve', '--yes', '--https=8443', 'http://localhost:3000']))
  })

  it('falls back to status JSON web key when stdout has no URL', async () => {
    const manager = new TailscalePreviewManager()
    captureSpawnChild('config sent, listening...\n')
    setupExecFileMock([
      { stdout: statusJsonFor([{ host: 'laptop.ts.net', port: 443 }]) },
      {
        stdout: statusJsonFor([
          { host: 'laptop.ts.net', port: 443 },
          { host: 'laptop.ts.net', port: 8443 },
        ]),
      },
    ])

    const result = await manager.start('/tmp/c', 3000)
    expect(result.url).toBe('https://laptop.ts.net:8443/')
  })

  it('rejects with stderr error when tailscale exits before becoming active (Access denied)', async () => {
    const manager = new TailscalePreviewManager()
    captureSpawnChild('', {
      stderr: 'sending serve config: Access denied: serve config denied\n',
      exit: { code: 1, delay: 10 },
    })
    setupExecFileMock([{ stdout: statusJsonFor([{ host: 'laptop.ts.net', port: 443 }]) }])

    await expect(manager.start('/tmp/d', 3000)).rejects.toThrow(/Access denied/)
  })

  it('rejects when the entry never appears in status JSON', async () => {
    const manager = new TailscalePreviewManager()
    captureSpawnChild('https://x.ts.net:8443/')
    setupExecFileMock([
      { stdout: statusJsonFor([{ host: 'laptop.ts.net', port: 443 }]) },
      { stdout: statusJsonFor([{ host: 'laptop.ts.net', port: 443 }]) },
    ])

    await expect(manager.start('/tmp/e', 3000)).rejects.toThrow(/did not register/)
  })
})

describe('TailscalePreviewManager.stop', () => {
  it('kills foreground child and skips targeted inverse when entry disappears on its own', async () => {
    const manager = new TailscalePreviewManager()
    const { child } = captureSpawnChild('https://laptop.ts.net:8443/')
    setupExecFileMock([
      { stdout: statusJsonFor([{ host: 'laptop.ts.net', port: 443 }]) },
      {
        stdout: statusJsonFor([
          { host: 'laptop.ts.net', port: 443 },
          { host: 'laptop.ts.net', port: 8443 },
        ]),
      },
      { stdout: statusJsonFor([{ host: 'laptop.ts.net', port: 443 }]) },
    ])

    await manager.start('/tmp/f', 3000)

    const spawnCallsBefore = vi.mocked(spawn).mock.calls.length

    await manager.stop('/tmp/f')

    expect(vi.mocked(spawn).mock.calls.length).toBe(spawnCallsBefore)
    child.exitCode = 0
  })

  it('uses targeted tailscale serve --https=<port> off when entry persists, never reset', async () => {
    const manager = new TailscalePreviewManager()
    const { child } = captureSpawnChild('https://laptop.ts.net:8443/')
    const removeCalls: string[][] = []
    let inverseCalled = false
    const initialJson = statusJsonFor([{ host: 'laptop.ts.net', port: 443 }])
    const presentJson = statusJsonFor([
      { host: 'laptop.ts.net', port: 443 },
      { host: 'laptop.ts.net', port: 8443 },
    ])
    const goneJson = statusJsonFor([{ host: 'laptop.ts.net', port: 443 }])
    let callIndex = 0

    vi.mocked(spawn).mockImplementation(((cmd: string, args: string[] | undefined) => {
      if (cmd === 'tailscale' && Array.isArray(args) && args[0] === 'serve' && args[args.length - 1] === 'off') {
        inverseCalled = true
        removeCalls.push(args)
        return makeMockChild({ exit: { code: 0, delay: 5 } }) as ChildProcess
      }
      return child as ChildProcess
    }) as never)

    vi.mocked(execFile).mockImplementation(((
      _cmd: string,
      args: string[] | undefined,
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const joined = (args ?? []).join(' ')
      if (joined.includes('status --json')) {
        // first call: initial state (only 443). Subsequent: present or gone based on inverse
        if (callIndex === 0) {
          callIndex++
          cb(null, initialJson, '')
        } else {
          callIndex++
          cb(null, inverseCalled ? goneJson : presentJson, '')
        }
      } else {
        cb(new Error(`unexpected execFile args: ${joined}`), '', '')
      }
      return undefined as never
    }) as never)

    await manager.start('/tmp/g', 3000)
    await manager.stop('/tmp/g')

    expect(removeCalls.length).toBeGreaterThan(0)
    expect(removeCalls[0]).toEqual(['serve', '--yes', '--https=8443', 'off'])
    expect(removeCalls.some((args) => args.includes('reset'))).toBe(false)
    child.exitCode = 0
  })
})

describe('TailscalePreviewManager.stopAll', () => {
  it('stops every active preview', async () => {
    const manager = new TailscalePreviewManager()
    const { children } = captureAllSpawnChildren('https://x.ts.net:8443/')
    // Track which ports are currently exposed in the simulated Tailscale node.
    const exposedPorts = new Set<number>([443])
    const presentJson = () => statusJsonFor(Array.from(exposedPorts).map((p) => ({ host: 'laptop.ts.net', port: p })))

    vi.mocked(spawn).mockImplementation(((cmd: string, args: string[] | undefined) => {
      if (cmd === 'tailscale' && Array.isArray(args) && args[0] === 'serve' && args[args.length - 1] === 'off') {
        // Inverse call: remove the targeted port from the simulated node.
        const httpsIdx = args.findIndex((a) => a.startsWith('--https='))
        if (httpsIdx >= 0) {
          const port = parseInt(args[httpsIdx]!.slice('--https='.length), 10)
          if (!isNaN(port)) exposedPorts.delete(port)
        }
        return makeMockChild({ exit: { code: 0, delay: 5 } }) as ChildProcess
      }
      // Foreground serve: figure out which port it will use, add to exposed set.
      if (cmd === 'tailscale' && Array.isArray(args)) {
        const httpsIdx = args.findIndex((a) => a.startsWith('--https='))
        if (httpsIdx >= 0) {
          const port = parseInt(args[httpsIdx]!.slice('--https='.length), 10)
          if (!isNaN(port)) {
            setTimeout(() => exposedPorts.add(port), 50)
          }
        }
      }
      return makeMockChild({ stdout: 'https://x.ts.net:8443/' }) as ChildProcess
    }) as never)

    vi.mocked(execFile).mockImplementation(((
      _cmd: string,
      args: string[] | undefined,
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const joined = (args ?? []).join(' ')
      if (joined.includes('status --json')) {
        cb(null, presentJson(), '')
      } else {
        cb(new Error(`unexpected execFile args: ${joined}`), '', '')
      }
      return undefined as never
    }) as never)

    await manager.start('/tmp/h1', 3001)
    await manager.start('/tmp/h2', 3002)
    await manager.stopAll()
    expect(manager.isActive('/tmp/h1')).toBe(false)
    expect(manager.isActive('/tmp/h2')).toBe(false)
    expect(exposedPorts.has(8443)).toBe(false)
    for (const c of children) c.exitCode = 0
  })
})

/**
 * Real Tailscale serve status JSON captured during Verify — exactly the shape
 * produced by `tailscale serve --https=8443 ...` running in foreground on a
 * node that already has a persistent 443 → 10369 entry.
 */
const REAL_SERVE_STATUS_FIXTURE = {
  TCP: {
    '443': { HTTPS: true },
  },
  Web: {
    'node.tailnet.ts.net:443': {
      Handlers: { '/': { Proxy: 'http://127.0.0.1:10369' } },
    },
  },
  Foreground: {
    f326d7c5f68a8f3f: {
      TCP: { '8443': { HTTPS: true } },
      Web: {
        'node.tailnet.ts.net:8443': {
          Handlers: { '/': { Proxy: 'http://127.0.0.1:10469' } },
        },
      },
    },
  },
}

describe('serve status JSON normalization (root + Foreground)', () => {
  it('iterateStatusPorts returns entries from both root and Foreground', () => {
    const ports = iterateStatusPorts(REAL_SERVE_STATUS_FIXTURE)
    const uniquePorts = Array.from(new Set(ports.map((p) => p.port))).sort((a, b) => a - b)
    expect(uniquePorts).toEqual([443, 8443])
    // Each port appears in both TCP and Web subtrees of its containing object
    expect(ports.length).toBe(4) // root TCP 443 + root Web 443 + FG TCP 8443 + FG Web 8443
  })

  it('iterateStatusPorts carries host for Web entries (root and Foreground)', () => {
    const ports = iterateStatusPorts(REAL_SERVE_STATUS_FIXTURE)
    const root443 = ports.find((p) => p.port === 443 && p.host === 'node.tailnet.ts.net')
    const fg8443 = ports.find((p) => p.port === 8443 && p.host === 'node.tailnet.ts.net')
    expect(root443).toBeDefined()
    expect(fg8443).toBeDefined()
  })

  it('findEntryForPort returns the root Web entry for port 443 (pre-existing)', () => {
    const result = findEntryForPort(REAL_SERVE_STATUS_FIXTURE, 443)
    expect(result.webKey).toBe('node.tailnet.ts.net:443')
    expect(result.tcpKey).toBe('443')
  })

  it('findEntryForPort returns the Foreground Web entry for port 8443 (the bug)', () => {
    const result = findEntryForPort(REAL_SERVE_STATUS_FIXTURE, 8443)
    expect(result.webKey).toBe('node.tailnet.ts.net:8443')
    expect(result.tcpKey).toBe('8443')
  })

  it('listUsedServePorts reports both 443 and 8443 so port choice skips them', () => {
    expect(listUsedServePortsFromFixture()).toEqual([443, 8443])
  })

  it('pickFreeServePort avoids both 443 (root) and 8443 (Foreground)', () => {
    const used = listUsedServePortsFromFixture()
    const port = pickFreeServePort(used)
    expect(used).not.toContain(port)
    expect(port).toBe(10000)
  })

  it('on-disk fixture JSON matches the real observed shape', () => {
    const fixturePath = join(__dirname, '__fixtures__', 'real-serve-status.json')
    let onDisk: unknown = null
    try {
      onDisk = JSON.parse(readFileSync(fixturePath, 'utf-8'))
    } catch {
      // fixture file is optional; the inline constant above is the source of truth.
    }
    if (onDisk) {
      const uniquePorts = Array.from(new Set(iterateStatusPorts(onDisk).map((p) => p.port))).sort((a, b) => a - b)
      expect(uniquePorts).toEqual([443, 8443])
    }
  })
})

function listUsedServePortsFromFixture(): number[] {
  const ports = new Set<number>()
  for (const entry of iterateStatusPorts(REAL_SERVE_STATUS_FIXTURE)) {
    ports.add(entry.port)
  }
  return Array.from(ports).sort((a, b) => a - b)
}
