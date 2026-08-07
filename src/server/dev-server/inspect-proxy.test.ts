import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import http from 'http'
import zlib from 'zlib'

vi.mock('../db/projects.js', () => ({
  getProjectByWorkdir: vi.fn((workdir: string) => {
    if (workdir === '/tmp') return { id: 'proj-1', name: 'Test Project', workdir: '/tmp' }
    if (workdir === '/other') return { id: 'proj-2', name: 'Other Project', workdir: '/other' }
    return null
  }),
}))

import { startInspectProxy, stopAllInspectProxies } from './inspect-proxy.js'

// Use a high base port to avoid conflicts with other services
const ORIGINAL_PORT = process.env['OPENFOX_PORT']
beforeEach(() => {
  process.env['OPENFOX_PORT'] = '45678'
})
afterAll(() => {
  if (ORIGINAL_PORT) process.env['OPENFOX_PORT'] = ORIGINAL_PORT
  else delete process.env['OPENFOX_PORT']
})

function createMockTarget(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') resolve(addr.port)
      else reject(new Error('Failed to get port'))
    })
  })
}

function httpGetRaw(
  host: string,
  port: number,
  path: string,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: host, port, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers as Record<string, string>,
          body: Buffer.concat(chunks),
        })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function httpGet(
  host: string,
  port: number,
  path: string,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const raw = await httpGetRaw(host, port, path)
  let body = raw.body
  const ce = (raw.headers['content-encoding'] || '').toLowerCase()
  if (ce === 'gzip') body = zlib.gunzipSync(body)
  else if (ce === 'deflate') body = zlib.inflateSync(body)
  return { ...raw, body: body.toString('utf8') }
}

function httpPost(
  host: string,
  port: number,
  path: string,
  body: string | Buffer,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
    const req = http.request(
      {
        hostname: host,
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data).toString() },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        })
      },
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

describe('InspectProxy', () => {
  const mockSessionManager = {
    queueMessage: vi.fn(),
    listSessions: vi.fn(() => [
      {
        id: 'session-1',
        title: 'Test Session',
        projectId: 'proj-1',
        workdir: '/tmp',
        mode: 'build',
        phase: 'build',
        isRunning: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 0,
      },
      {
        id: 'session-2',
        title: 'Another Session',
        projectId: 'proj-1',
        workdir: '/tmp',
        mode: 'plan',
        phase: 'plan',
        isRunning: true,
        createdAt: '2024-01-02T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        criteriaCount: 3,
        criteriaCompleted: 1,
        messageCount: 5,
      },
      {
        id: 'session-3',
        title: 'Other Project Session',
        projectId: 'proj-2',
        workdir: '/other',
        mode: 'build',
        phase: 'build',
        isRunning: false,
        createdAt: '2024-01-03T00:00:00Z',
        updatedAt: '2024-01-03T00:00:00Z',
        criteriaCount: 1,
        criteriaCompleted: 0,
        messageCount: 2,
      },
    ]),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterAll(() => {
    stopAllInspectProxies()
  })

  describe('HTML injection', () => {
    it('injects script before </body> in uncompressed HTML', async () => {
      const targetPort = await createMockTarget((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><h1>Hello</h1></body></html>')
      })

      const { port, cleanup } = await startInspectProxy(
        `http://127.0.0.1:${targetPort}`,
        mockSessionManager as any,
        targetPort,
      )
      try {
        const result = await httpGet('127.0.0.1', port, '/')
        expect(result.status).toBe(200)
        expect(result.body).toContain('__inspect__.js')
        expect(result.body).toContain('</body>')
        expect(result.body.indexOf('__inspect__.js')).toBeLessThan(result.body.indexOf('</body>'))
      } finally {
        cleanup()
      }
    })

    it('injects script before </head> when no </body>', async () => {
      const targetPort = await createMockTarget((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><head><title>Test</title></head><div>content</div></html>')
      })

      const { port, cleanup } = await startInspectProxy(
        `http://127.0.0.1:${targetPort}`,
        mockSessionManager as any,
        targetPort,
      )
      try {
        const result = await httpGet('127.0.0.1', port, '/')
        expect(result.status).toBe(200)
        expect(result.body).toContain('__inspect__.js')
        expect(result.body.indexOf('__inspect__.js')).toBeLessThan(result.body.indexOf('</head>'))
      } finally {
        cleanup()
      }
    })

    it('injects script in gzip-compressed HTML', async () => {
      const targetPort = await createMockTarget((_req, res) => {
        const compressed = zlib.gzipSync('<html><body><h1>Hello</h1></body></html>')
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' })
        res.end(compressed)
      })

      const { port, cleanup } = await startInspectProxy(
        `http://127.0.0.1:${targetPort}`,
        mockSessionManager as any,
        targetPort,
      )
      try {
        const result = await httpGet('127.0.0.1', port, '/')
        expect(result.status).toBe(200)
        expect(result.body).toContain('__inspect__.js')
      } finally {
        cleanup()
      }
    })

    it('injects script in deflate-compressed HTML', async () => {
      const targetPort = await createMockTarget((_req, res) => {
        const compressed = zlib.deflateSync('<html><body><h1>Hello</h1></body></html>')
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'deflate' })
        res.end(compressed)
      })

      const { port, cleanup } = await startInspectProxy(
        `http://127.0.0.1:${targetPort}`,
        mockSessionManager as any,
        targetPort,
      )
      try {
        const result = await httpGet('127.0.0.1', port, '/')
        expect(result.status).toBe(200)
        expect(result.body).toContain('__inspect__.js')
      } finally {
        cleanup()
      }
    })

    it('injects script in chunked transfer encoded HTML', async () => {
      const targetPort = await createMockTarget((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Transfer-Encoding': 'chunked' })
        res.write('5\r\n<html')
        res.write('\r\n8\r\n><body><h')
        res.write('\r\n7\r\n1>Hi</h1>')
        res.write('\r\n10\r\n</body></html>\r\n')
        res.end('0\r\n\r\n')
      })

      const { port, cleanup } = await startInspectProxy(
        `http://127.0.0.1:${targetPort}`,
        mockSessionManager as any,
        targetPort,
      )
      try {
        const result = await httpGet('127.0.0.1', port, '/')
        expect(result.status).toBe(200)
        expect(result.body).toContain('__inspect__.js')
      } finally {
        cleanup()
      }
    })
  })

  describe('Non-HTML passthrough', () => {
    it('passes through CSS responses unchanged', async () => {
      const targetPort = await createMockTarget((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/css' })
        res.end('body { color: red; }')
      })

      const { port, cleanup } = await startInspectProxy(
        `http://127.0.0.1:${targetPort}`,
        mockSessionManager as any,
        targetPort,
      )
      try {
        const result = await httpGet('127.0.0.1', port, '/style.css')
        expect(result.status).toBe(200)
        expect(result.body).toBe('body { color: red; }')
        expect(result.body).not.toContain('__inspect__.js')
      } finally {
        cleanup()
      }
    })

    it('passes through JS responses unchanged', async () => {
      const targetPort = await createMockTarget((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/javascript' })
        res.end('console.log("hello");')
      })

      const { port, cleanup } = await startInspectProxy(
        `http://127.0.0.1:${targetPort}`,
        mockSessionManager as any,
        targetPort,
      )
      try {
        const result = await httpGet('127.0.0.1', port, '/script.js')
        expect(result.status).toBe(200)
        expect(result.body).toBe('console.log("hello");')
        expect(result.body).not.toContain('__inspect__.js')
      } finally {
        cleanup()
      }
    })

    it('passes through JSON responses unchanged', async () => {
      const targetPort = await createMockTarget((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
      })

      const { port, cleanup } = await startInspectProxy(
        `http://127.0.0.1:${targetPort}`,
        mockSessionManager as any,
        targetPort,
      )
      try {
        const result = await httpGet('127.0.0.1', port, '/data.json')
        expect(result.status).toBe(200)
        expect(result.body).toBe('{"ok":true}')
      } finally {
        cleanup()
      }
    })
  })

  describe('Feedback endpoint', () => {
    it('queues a message when valid feedback is posted', async () => {
      const targetPort = await createMockTarget((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
      })

      const { port, cleanup } = await startInspectProxy(
        `http://127.0.0.1:${targetPort}`,
        mockSessionManager as any,
        targetPort,
      )
      try {
        const result = await httpPost(
          '127.0.0.1',
          port,
          '/__openfox_feedback',
          JSON.stringify({
            sessionId: 'session-1',
            element: { tag: 'button', id: 'submit-btn' },
            annotation: 'This button is misaligned',
            pageUrl: 'http://localhost:3000/page',
          }),
        )
        expect(result.status).toBe(200)
        expect(mockSessionManager.queueMessage).toHaveBeenCalledWith(
          'session-1',
          'asap',
          expect.stringContaining('misaligned'),
          [],
          'ui_feedback',
        )
      } finally {
        cleanup()
      }
    })

    it('returns 400 for invalid JSON body', async () => {
      const targetPort = await createMockTarget((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
      })

      const { port, cleanup } = await startInspectProxy(
        `http://127.0.0.1:${targetPort}`,
        mockSessionManager as any,
        targetPort,
      )
      try {
        const result = await httpPost(
          '127.0.0.1',
          port,
          '/__openfox_feedback',
          Buffer.from('not valid json at all', 'utf8'),
        )
        expect(result.status).toBe(400)
      } finally {
        cleanup()
      }
    })

    it('does not queue message when sessionId is missing', async () => {
      const targetPort = await createMockTarget((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
      })

      const { port, cleanup } = await startInspectProxy(
        `http://127.0.0.1:${targetPort}`,
        mockSessionManager as any,
        targetPort,
      )
      try {
        await httpPost(
          '127.0.0.1',
          port,
          '/__openfox_feedback',
          JSON.stringify({
            element: { tag: 'div' },
            annotation: 'test',
          }),
        )
        expect(mockSessionManager.queueMessage).not.toHaveBeenCalled()
      } finally {
        cleanup()
      }
    })
  })

  describe('Session listing endpoint', () => {
    it('returns sessions sorted by createdAt descending', async () => {
      const targetPort = await createMockTarget((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
      })

      const { port, cleanup } = await startInspectProxy(
        `http://127.0.0.1:${targetPort}`,
        mockSessionManager as any,
        targetPort,
      )
      try {
        const result = await httpGet('127.0.0.1', port, '/__openfox_sessions')
        expect(result.status).toBe(200)
        const data = JSON.parse(result.body)
        expect(data.sessions).toHaveLength(3)
        // Most recent first (session-3 has newest createdAt)
        expect(data.sessions[0]).toMatchObject({ id: 'session-3' })
        expect(data.sessions[1]).toMatchObject({ id: 'session-2' })
        expect(data.sessions[2]).toMatchObject({ id: 'session-1' })
      } finally {
        cleanup()
      }
    })

    it('filters sessions by project when workdir is provided', async () => {
      const targetPort = await createMockTarget((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
      })

      // proj-1 has workdir /tmp, so passing /tmp should filter to sessions 1 and 2
      const { port, cleanup } = await startInspectProxy(
        `http://127.0.0.1:${targetPort}`,
        mockSessionManager as any,
        targetPort,
        '/tmp',
      )
      try {
        const result = await httpGet('127.0.0.1', port, '/__openfox_sessions')
        expect(result.status).toBe(200)
        const data = JSON.parse(result.body)
        expect(data.sessions).toHaveLength(2)
        expect(data.sessions[0]).toMatchObject({ id: 'session-2' })
        expect(data.sessions[1]).toMatchObject({ id: 'session-1' })
      } finally {
        cleanup()
      }
    })
  })

  describe('Port allocation', () => {
    it('keeps the proxy port below 65536 when devServerPort + 1000 would overflow', async () => {
      const targetPort = await createMockTarget((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
      })

      // 65000 + 1000 exceeds the valid port range; net.listen() beyond 65535
      // throws a synchronous RangeError, so an unbounded scan crashes here
      // instead of binding. Ephemeral ports land in 49152-65535 on Windows,
      // so any listen(0)-derived devServerPort above 64535 hits this in the wild.
      const { port, cleanup } = await startInspectProxy(
        `http://127.0.0.1:${targetPort}`,
        mockSessionManager as any,
        65000,
      )
      try {
        expect(port).toBeLessThanOrEqual(65535)
        const result = await httpGet('127.0.0.1', port, '/')
        expect(result.status).toBe(200)
        expect(result.body).toBe('ok')
      } finally {
        cleanup()
      }
    })
  })

  describe('Error handling', () => {
    it('handles target server that closes connection prematurely', async () => {
      const targetPort = await createMockTarget((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.write('<html><body>')
        res.destroy()
      })

      const { port, cleanup } = await startInspectProxy(
        `http://127.0.0.1:${targetPort}`,
        mockSessionManager as any,
        targetPort,
      )
      try {
        const result = await httpGet('127.0.0.1', port, '/')
        expect(result.status).toBeGreaterThanOrEqual(0)
      } finally {
        cleanup()
      }
    })

    it('handles unreachable target gracefully', async () => {
      const { port, cleanup } = await startInspectProxy('http://127.0.0.1:1', mockSessionManager as any, 9001)
      try {
        const result = await httpGet('127.0.0.1', port, '/')
        expect(result.status).toBeGreaterThanOrEqual(0)
      } finally {
        cleanup()
      }
    })
  })
})
