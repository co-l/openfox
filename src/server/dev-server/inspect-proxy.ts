import httpProxy from 'http-proxy'
import { createServer as createHttpServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { logger } from '../utils/logger.js'
import type { SessionManager } from '../session/manager.js'

const proxyCache = new Map<string, httpProxy>()

function getProxy(target: string) {
  if (!proxyCache.has(target)) {
    const proxy = httpProxy.createProxyServer({
      changeOrigin: true,
      selfHandleResponse: true,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    proxy.on('error', (err: Error, _req: any, res: any) => {
      if (res && !res.writableEnded) {
        res.writeHead(502, { 'content-type': 'text/plain' })
        res.end('Proxy error: ' + err.message)
      }
    })
    proxyCache.set(target, proxy)
  }
  return proxyCache.get(target)!
}

interface ProxyInstance {
  server: Server
  target: string
}

const proxyPool = new Map<string, ProxyInstance>()
let nextOffset = 0

function getAvailablePort(): number {
  const base = Number(process.env['OPENFOX_BASE_PROXY_PORT'] ?? 10_000)
  const used = new Set<number>()
  for (const instance of proxyPool.values()) {
    const addr = instance.server.address()
    if (addr && typeof addr === 'object') used.add(addr.port)
  }
  for (let port = base + 1; port < base + 200; port++) {
    if (!used.has(port)) return port
  }
  return base + ((nextOffset++ % 200) + 1)
}

export function startInspectProxy(target: string, sessionManager: SessionManager): { port: number; cleanup: () => void } {
  const port = getAvailablePort()
  const proxy = getProxy(target)

  const server = createHttpServer()

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/__openfox_feedback' && req.method === 'POST') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        try {
          const { sessionId, element, annotation, pageUrl } = JSON.parse(body)
          if (!sessionId) {
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: 'sessionId required' }))
            return
          }
          const elementDesc = element ? `${element.tag}${element.id ? '#' + element.id : ''}` : 'unknown'
          const htmlSnippet = element?.outerHTML ? `\nHtml: ${element.outerHTML.slice(0, 300)}` : ''
          const content = `# User feedback from page inspection on dev_server\n\n## Context\n\nPage: ${pageUrl || ''}\nElement: ${elementDesc}\nxPath: ${element?.xpath || ''}${htmlSnippet}\n\n## Feedback\n\n${annotation || '(none)'}`
          sessionManager.queueMessage(sessionId, 'asap', content, [], 'ui_feedback')
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Invalid request' }))
        }
      })
      return
    }

    if (req.url === '/__inspect__.js') {
      import('node:fs/promises').then(async ({ readFile }) => {
        const dir = import.meta.dirname ?? __dirname
        const devPath = `${dir}/../public/__inspect__.js`
        const prodPath = `${dir}/server/public/__inspect__.js`
        try {
          const content = await readFile(devPath, 'utf-8')
          res.writeHead(200, { 'Content-Type': 'application/javascript' })
          res.end(content)
        } catch {
          try {
            const content = await readFile(prodPath, 'utf-8')
            res.writeHead(200, { 'Content-Type': 'application/javascript' })
            res.end(content)
          } catch {
            res.writeHead(404)
            res.end('Not found')
          }
        }
      })
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(proxy as any).web(req, res, { target }, (err: Error | undefined) => {
      if (err && !res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain' })
        res.end('Proxy error: ' + err.message)
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    proxy.on('proxyRes', (proxyRes: any) => {
      const contentType = proxyRes.headers?.['content-type'] ?? ''
      const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml')

      if (!isHtml) {
        if (res.headersSent) return
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(proxyRes as any).pipe(res)
        return
      }

      const chunks: Buffer[] = []
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
      proxyRes.on('end', () => {
        try {
          const html = Buffer.concat(chunks).toString('utf8')
          const snippet = `<script src="/__inspect__.js"></script>`
          const injected = html.replace('</head>', snippet + '</head>')
          res.writeHead(proxyRes.statusCode ?? 200, {
            ...proxyRes.headers,
            'content-type': 'text/html; charset=utf-8',
          })
          res.end(injected)
        } catch {
          res.writeHead(500, { 'content-type': 'text/plain' })
          res.end('Failed to process response')
        }
      })
    })
  })

  server.listen(port, '0.0.0.0', () => {
    logger.debug('Inspect proxy listening', { port, target })
  })

  proxyPool.set(target, { server, target })

  const cleanup = () => {
    server.close()
    proxyCache.delete(target)
    proxyPool.delete(target)
    logger.debug('Inspect proxy stopped', { port, target })
  }

  return { port, cleanup }
}

export function stopAllInspectProxies(): void {
  for (const instance of proxyPool.values()) {
    instance.server.close()
  }
  proxyPool.clear()
  proxyCache.clear()
}