import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock, createMessageConnectionMock, streamMessageReaderMock, streamMessageWriterMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  createMessageConnectionMock: vi.fn(),
  streamMessageReaderMock: vi.fn(),
  streamMessageWriterMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('vscode-jsonrpc/node.js', () => ({
  createMessageConnection: createMessageConnectionMock,
  StreamMessageReader: streamMessageReaderMock,
  StreamMessageWriter: streamMessageWriterMock,
}))

import { LspServer } from './server.js'

const tsConfig = {
  id: 'typescript',
  name: 'TypeScript',
  extensions: ['.ts', '.tsx'],
  serverCommand: 'typescript-language-server',
  serverArgs: ['--stdio'],
  rootPatterns: ['tsconfig.json'],
  languageIds: {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
  },
}

function createProcessMock(withStdio = true) {
  const proc = new EventEmitter() as any
  proc.pid = 4321
  proc.kill = vi.fn()
  proc.stdin = withStdio ? new EventEmitter() : null
  proc.stdout = withStdio ? new EventEmitter() : null
  proc.stderr = new EventEmitter()
  // start() waits for 'spawn' before wiring JSON-RPC; emit it as soon as the
  // listener registers (microtask, since tests run with fake timers)
  proc.on('newListener', (event: string) => {
    if (event === 'spawn') queueMicrotask(() => proc.emit('spawn'))
  })
  return proc
}

function createConnectionMock() {
  const notifications = new Map<string, (params: any) => void>()
  const connection = {
    onNotification: vi.fn((method: string, cb: (params: any) => void) => {
      notifications.set(method, cb)
    }),
    sendRequest: vi.fn(),
    sendNotification: vi.fn(),
    listen: vi.fn(),
    dispose: vi.fn(),
  }
  return { connection, notifications }
}

describe('LspServer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    spawnMock.mockReset()
    createMessageConnectionMock.mockReset()
    streamMessageReaderMock.mockReset()
    streamMessageWriterMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts successfully and initializes the JSON-RPC connection', async () => {
    const proc = createProcessMock()
    const { connection } = createConnectionMock()
    spawnMock.mockReturnValue(proc)
    createMessageConnectionMock.mockReturnValue(connection)
    connection.sendRequest.mockResolvedValue({ capabilities: { diagnostics: true } })
    connection.sendNotification.mockResolvedValue(undefined)

    const server = new LspServer(tsConfig, '/tmp/project', '/usr/bin/typescript-language-server')
    await server.start()
    await server.start()

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/bin/typescript-language-server',
      ['--stdio'],
      expect.objectContaining({ cwd: '/tmp/project' }),
    )
    expect(createMessageConnectionMock).toHaveBeenCalledTimes(1)
    expect(connection.listen).toHaveBeenCalledTimes(1)
    expect(connection.sendRequest).toHaveBeenCalledWith(
      'initialize',
      expect.objectContaining({ rootPath: '/tmp/project', rootUri: 'file:///tmp/project' }),
    )
    expect(connection.sendNotification).toHaveBeenCalledWith('initialized', {})
    expect(server.isRunning()).toBe(true)
    expect(server.getState()).toBe('running')
    expect(server.getLanguage()).toBe('typescript')
  })

  it('opens, changes, closes, and tracks diagnostics for documents', async () => {
    const proc = createProcessMock()
    const { connection } = createConnectionMock()
    spawnMock.mockReturnValue(proc)
    createMessageConnectionMock.mockReturnValue(connection)
    connection.sendRequest.mockResolvedValue({})
    connection.sendNotification.mockResolvedValue(undefined)

    const server = new LspServer(tsConfig, '/tmp/project', '/usr/bin/typescript-language-server')
    await server.start()
    const updates: any[] = []
    const unsubscribe = server.onDiagnostics((path, diagnostics) => {
      updates.push({ path, diagnostics })
    })

    await server.didOpen('/tmp/project/App.tsx', 'const x = 1')
    expect(connection.sendNotification).toHaveBeenCalledWith(
      'textDocument/didOpen',
      expect.objectContaining({
        textDocument: expect.objectContaining({ languageId: 'typescriptreact', version: 1, text: 'const x = 1' }),
      }),
    )
    ;(server as any).handleDiagnostics({
      uri: 'file:///tmp/project/App.tsx',
      diagnostics: [
        {
          range: { start: { line: 1, character: 2 }, end: { line: 1, character: 4 } },
          severity: 1,
          code: 2345,
          source: 'tsserver',
          message: 'Type error',
        },
      ],
    })
    expect(server.getDiagnostics('/tmp/project/App.tsx')).toEqual([
      {
        path: '/tmp/project/App.tsx',
        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 4 } },
        severity: 'error',
        message: 'Type error',
        source: 'tsserver',
        code: '2345',
      },
    ])
    expect(updates[0]?.diagnostics).toEqual(server.getDiagnostics('/tmp/project/App.tsx'))

    await server.didChange('/tmp/project/App.tsx', 'const x = 2')
    expect(connection.sendNotification).toHaveBeenCalledWith(
      'textDocument/didChange',
      expect.objectContaining({
        textDocument: { uri: 'file:///tmp/project/App.tsx', version: 2 },
        contentChanges: [{ text: 'const x = 2' }],
      }),
    )

    unsubscribe()
    ;(server as any).handleDiagnostics({
      uri: 'file:///tmp/project/App.tsx',
      diagnostics: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          severity: 4,
          message: 'Hint',
        },
      ],
    })
    expect(updates).toHaveLength(1)

    await server.didClose('/tmp/project/App.tsx')
    expect(connection.sendNotification).toHaveBeenCalledWith('textDocument/didClose', {
      textDocument: { uri: 'file:///tmp/project/App.tsx' },
    })
  })

  it('returns fallback diagnostics on timeout and handles unopened documents', async () => {
    const proc = createProcessMock()
    const { connection } = createConnectionMock()
    spawnMock.mockReturnValue(proc)
    createMessageConnectionMock.mockReturnValue(connection)
    connection.sendRequest.mockResolvedValue({})
    connection.sendNotification.mockResolvedValue(undefined)

    const server = new LspServer(tsConfig, '/tmp/project', '/usr/bin/typescript-language-server')
    await server.start()

    await expect(server.getDiagnosticsWithWait('/tmp/project/missing.ts')).resolves.toEqual([])

    await server.didChange('/tmp/project/new.ts', 'const x = 1')
    expect(connection.sendNotification).toHaveBeenCalledWith(
      'textDocument/didOpen',
      expect.objectContaining({
        textDocument: expect.objectContaining({ uri: 'file:///tmp/project/new.ts', languageId: 'typescript' }),
      }),
    )

    const pending = server.getDiagnosticsWithWait('/tmp/project/new.ts', 250)
    await vi.advanceTimersByTimeAsync(250)
    await expect(pending).resolves.toEqual([])
  })

  it('stops cleanly while running', async () => {
    const proc = createProcessMock()
    const { connection } = createConnectionMock()
    spawnMock.mockReturnValue(proc)
    createMessageConnectionMock.mockReturnValue(connection)
    connection.sendRequest.mockResolvedValue({})
    connection.sendNotification.mockResolvedValue(undefined)

    const server = new LspServer(tsConfig, '/tmp/project', '/usr/bin/typescript-language-server')
    await server.start()
    await server.didOpen('/tmp/project/file.ts', 'x')

    await server.stop()
    expect(connection.dispose).toHaveBeenCalled()
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
    expect(server.getState()).toBe('stopped')
    expect(server.getDiagnostics('/tmp/project/file.ts')).toEqual([])
  })

  it('handles process error and exit transitions', async () => {
    const proc = createProcessMock()
    const { connection } = createConnectionMock()
    spawnMock.mockReturnValue(proc)
    createMessageConnectionMock.mockReturnValue(connection)
    connection.sendRequest.mockResolvedValue({})
    connection.sendNotification.mockResolvedValue(undefined)

    const server = new LspServer(tsConfig, '/tmp/project', '/usr/bin/typescript-language-server')
    await server.start()
    await server.didOpen('/tmp/project/file.ts', 'x')
    const waiting = server.getDiagnosticsWithWait('/tmp/project/file.ts', 1000)

    proc.emit('error', new Error('process failed'))
    await expect(waiting).resolves.toEqual([])
    expect(server.getState()).toBe('error')

    await server.start()
    proc.emit('exit', 1)
    expect(server.getState()).toBe('error')
  })

  // ============================================================================
  // LSP Query Methods
  // ============================================================================

  describe('LSP query methods', () => {
    async function createStartedServer(connection: any) {
      const proc = createProcessMock()
      spawnMock.mockReturnValue(proc)
      createMessageConnectionMock.mockReturnValue(connection)
      connection.sendRequest.mockResolvedValue({})
      connection.sendNotification.mockResolvedValue(undefined)
      const server = new LspServer(tsConfig, '/tmp/project', '/usr/bin/typescript-language-server')
      await server.start()
      return server
    }

    it('getDefinition returns locations', async () => {
      const { connection } = createConnectionMock()
      const server = await createStartedServer(connection)

      connection.sendRequest.mockResolvedValueOnce({
        uri: 'file:///tmp/project/src/foo.ts',
        range: { start: { line: 10, character: 5 }, end: { line: 10, character: 20 } },
      })

      const result = await server.getDefinition('/tmp/project/App.tsx', 0, 10)
      expect(result).toEqual([
        { path: '/tmp/project/src/foo.ts', line: 10, character: 5, endLine: 10, endCharacter: 20 },
      ])
      expect(connection.sendRequest).toHaveBeenCalledWith(
        'textDocument/definition',
        expect.objectContaining({
          textDocument: { uri: 'file:///tmp/project/App.tsx' },
          position: { line: 0, character: 10 },
        }),
      )
    })

    it('getDefinition handles null response', async () => {
      const { connection } = createConnectionMock()
      const server = await createStartedServer(connection)

      connection.sendRequest.mockResolvedValueOnce(null)

      const result = await server.getDefinition('/tmp/project/App.tsx', 0, 10)
      expect(result).toEqual([])
    })

    it('getDefinition handles array response', async () => {
      const { connection } = createConnectionMock()
      const server = await createStartedServer(connection)

      connection.sendRequest.mockResolvedValueOnce([
        {
          uri: 'file:///tmp/project/a.ts',
          range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } },
        },
        {
          uri: 'file:///tmp/project/b.ts',
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
        },
      ])

      const result = await server.getDefinition('/tmp/project/App.tsx', 0, 10)
      expect(result).toHaveLength(2)
      expect(result[0]!.path).toBe('/tmp/project/a.ts')
      expect(result[1]!.path).toBe('/tmp/project/b.ts')
    })

    it('getReferences returns locations', async () => {
      const { connection } = createConnectionMock()
      const server = await createStartedServer(connection)

      connection.sendRequest.mockResolvedValueOnce([
        {
          uri: 'file:///tmp/project/bar.ts',
          range: { start: { line: 42, character: 0 }, end: { line: 42, character: 15 } },
        },
      ])

      const result = await server.getReferences('/tmp/project/App.tsx', 0, 10)
      expect(result).toHaveLength(1)
      expect(result[0]!.path).toBe('/tmp/project/bar.ts')
      expect(result[0]!.line).toBe(42)
      expect(connection.sendRequest).toHaveBeenCalledWith(
        'textDocument/references',
        expect.objectContaining({
          textDocument: { uri: 'file:///tmp/project/App.tsx' },
          position: { line: 0, character: 10 },
          context: { includeDeclaration: true },
        }),
      )
    })

    it('getTypeDefinition returns locations', async () => {
      const { connection } = createConnectionMock()
      const server = await createStartedServer(connection)

      connection.sendRequest.mockResolvedValueOnce({
        uri: 'file:///tmp/project/types.ts',
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 30 } },
      })

      const result = await server.getTypeDefinition('/tmp/project/App.tsx', 0, 10)
      expect(result).toHaveLength(1)
      expect(result[0]!.path).toBe('/tmp/project/types.ts')
    })

    it('findWorkspaceSymbol returns symbol info', async () => {
      const { connection } = createConnectionMock()
      const server = await createStartedServer(connection)

      connection.sendRequest.mockResolvedValueOnce([
        {
          name: 'rebuildTools',
          kind: 12, // Function
          location: {
            uri: 'file:///tmp/project/src/tools.ts',
            range: { start: { line: 42, character: 0 }, end: { line: 42, character: 13 } },
          },
          containerName: 'tools',
        },
      ])

      const result = await server.findWorkspaceSymbol('rebuildTools')
      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('rebuildTools')
      expect(result[0]!.location.path).toBe('/tmp/project/src/tools.ts')
      expect(result[0]!.location.line).toBe(42)
      expect(connection.sendRequest).toHaveBeenCalledWith('workspace/symbol', { query: 'rebuildTools' })
    })

    it('getHoverInfo returns hover content', async () => {
      const { connection } = createConnectionMock()
      const server = await createStartedServer(connection)

      connection.sendRequest.mockResolvedValueOnce({
        contents: {
          kind: 'markdown',
          value: '```typescript\nconst rebuildTools: (opts: Options) => Promise<void>\n```',
        },
        range: { start: { line: 0, character: 5 }, end: { line: 0, character: 17 } },
      })

      const result = await server.getHoverInfo('/tmp/project/App.tsx', 0, 10)
      expect(result).not.toBeNull()
      expect(result!.contents).toContain('rebuildTools')
      expect(result!.range).toBeDefined()
      expect(connection.sendRequest).toHaveBeenCalledWith(
        'textDocument/hover',
        expect.objectContaining({
          textDocument: { uri: 'file:///tmp/project/App.tsx' },
          position: { line: 0, character: 10 },
        }),
      )
    })

    it('getHoverInfo returns null when no hover data', async () => {
      const { connection } = createConnectionMock()
      const server = await createStartedServer(connection)

      connection.sendRequest.mockResolvedValueOnce(null)

      const result = await server.getHoverInfo('/tmp/project/App.tsx', 999, 0)
      expect(result).toBeNull()
    })

    it('returns empty array when server not running', async () => {
      const server = new LspServer(tsConfig, '/tmp/project', '/usr/bin/typescript-language-server')

      await expect(server.getDefinition('/tmp/project/f.ts', 0, 0)).resolves.toEqual([])
      await expect(server.getReferences('/tmp/project/f.ts', 0, 0)).resolves.toEqual([])
      await expect(server.getTypeDefinition('/tmp/project/f.ts', 0, 0)).resolves.toEqual([])
      await expect(server.findWorkspaceSymbol('foo')).resolves.toEqual([])
      await expect(server.getHoverInfo('/tmp/project/f.ts', 0, 0)).resolves.toBeNull()
    })
  })

  it('throws start errors for missing stdio and initialize failures', async () => {
    const noStdioProcess = createProcessMock(false)
    spawnMock.mockReturnValueOnce(noStdioProcess)

    const noStdioServer = new LspServer(tsConfig, '/tmp/project', '/usr/bin/typescript-language-server')
    await expect(noStdioServer.start()).rejects.toThrow('Failed to get stdio streams from language server process')
    expect(noStdioServer.getState()).toBe('error')

    const proc = createProcessMock()
    const { connection } = createConnectionMock()
    spawnMock.mockReturnValueOnce(proc)
    createMessageConnectionMock.mockReturnValueOnce(connection)
    connection.sendRequest.mockRejectedValueOnce(new Error('initialize failed'))

    const failingServer = new LspServer(tsConfig, '/tmp/project', '/usr/bin/typescript-language-server')
    await expect(failingServer.start()).rejects.toThrow('initialize failed')
    expect(failingServer.getState()).toBe('error')
  })
})
