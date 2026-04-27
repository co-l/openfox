import net from 'net'
import zlib from 'zlib'
import fs from 'fs'
import { Server } from 'node:http'
import { logger } from '../utils/logger.js'
import type { SessionManager } from '../session/manager.js'

const INJECT_SCRIPT = '<script src="/__inspect__.js"></script>'

interface ProxyInstance {
  server: ReturnType<typeof net.createServer>
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

function parseReqHeaders(str: string): { method: string; url: string; headers: Record<string, string> } {
  const lines = str.split('\r\n')
  const method = lines[0]!.split(' ')[0]!
  const url = lines[0]!.split(' ')[1]!
  const headers = parseHeaderLines(lines)
  return { method, url, headers }
}

function parseResHeaders(str: string): { status: number; headers: Record<string, string> } {
  const lines = str.split('\r\n')
  const status = parseInt(lines[0]!.split(' ')[1] || '200')
  const headers = parseHeaderLines(lines)
  return { status, headers }
}

function parseHeaderLines(lines: string[]): Record<string, string> {
  const headers: Record<string, string> = {}
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) break
    const ci = line.indexOf(':')
    if (ci < 0) continue
    headers[line.slice(0, ci).toLowerCase()] = line.slice(ci + 1).trim()
  }
  return headers
}

function buildResponse(status: number, headers: Record<string, string>, body: Buffer) {
  const statusLine = `HTTP/1.1 ${status} ${status === 200 ? 'OK' : status === 404 ? 'Not Found' : 'Error'}`
  const headerLines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')
  const head = Buffer.from(`${statusLine}\r\n${headerLines}\r\n\r\n`, 'utf8')
  return Buffer.concat([head, body])
}

function forwardHtml(client: net.Socket, body: Buffer, resHeaders: Record<string, string>, status: number) {
  const bi = body.indexOf('</body>')
  const hi = body.indexOf('</head>')
  let modified: Buffer

  if (bi >= 0) {
    modified = Buffer.concat([body.slice(0, bi), Buffer.from(INJECT_SCRIPT, 'utf8'), body.slice(bi)])
  } else if (hi >= 0) {
    modified = Buffer.concat([body.slice(0, hi), Buffer.from(INJECT_SCRIPT, 'utf8'), body.slice(hi)])
  } else {
    client.write(body)
    return
  }

  const newH = { ...resHeaders }
  delete newH['content-length']
  delete newH['transfer-encoding']
  newH['content-length'] = Buffer.byteLength(modified).toString()
  const newHead = `HTTP/1.1 ${status} OK\r\n` +
    Object.entries(newH).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n'
  client.write(Buffer.from(newHead, 'utf8'))
  client.write(modified)
}

function forwardHtmlChunk(client: net.Socket, chunk: Buffer) {
  const str = chunk.toString('utf8')
  const bi = str.indexOf('</body>')
  const hi = str.indexOf('</head>')

  if (bi >= 0) {
    const modified = Buffer.from(str.slice(0, bi) + INJECT_SCRIPT + str.slice(bi), 'utf8')
    client.write(modified)
  } else if (hi >= 0) {
    const modified = Buffer.from(str.slice(0, hi) + INJECT_SCRIPT + str.slice(hi), 'utf8')
    client.write(modified)
  } else {
    client.write(chunk)
  }
}

export function startInspectProxy(target: string, sessionManager: SessionManager): { port: number; cleanup: () => void } {
  const port = getAvailablePort()

  const server = net.createServer((client) => {
    let clientHead = ''
    let clientParsed = false

    client.on('data', (chunk) => {
      if (clientParsed) return

      clientHead += chunk.toString('utf8')
      const he = clientHead.indexOf('\r\n\r\n')
      if (he < 0) return

      const { method, url, headers } = parseReqHeaders(clientHead)
      const isWS = headers['upgrade'] === 'websocket'
      clientParsed = true

      if (url === '/__inspect__.js') {
        const possiblePaths = [
          `${import.meta.dirname}/../public/__inspect__.js`,
          `${import.meta.dirname}/../../src/server/public/__inspect__.js`,
          `${process.cwd()}/dist/server/public/__inspect__.js`,
        ]
        let inspectJs: Buffer | null = null
        for (const p of possiblePaths) {
          try {
            inspectJs = fs.readFileSync(p)
            break
          } catch {
            // try next path
          }
        }
        if (!inspectJs) {
          const resp = buildResponse(404, { 'Content-Type': 'text/plain' }, Buffer.from('Not found'))
          client.write(resp)
          client.end()
          return
        }
        const resp = buildResponse(200, { 'Content-Type': 'application/javascript', 'Content-Length': inspectJs.length.toString() }, inspectJs)
        client.write(resp)
        client.end()
        return
      }

      if (url === '/__openfox_feedback' && method === 'POST') {
        const body = chunk.slice(he + 4).toString('utf8')
        try {
          const { sessionId, element, annotation, pageUrl } = JSON.parse(body)
          if (sessionId) {
            const elementDesc = element ? `${element.tag}${element.id ? '#' + element.id : ''}` : 'unknown'
            const htmlSnippet = element?.outerHTML ? `\nHtml: ${element.outerHTML.slice(0, 300)}` : ''
            const content = `# User feedback from page inspection on dev_server\n\n## Context\n\nPage: ${pageUrl || ''}\nElement: ${elementDesc}\nxPath: ${element?.xpath || ''}${htmlSnippet}\n\n## Feedback\n\n${annotation || '(none)'}`
            sessionManager.queueMessage(sessionId, 'asap', content, [], 'ui_feedback')
          }
          client.write(buildResponse(200, { 'Content-Type': 'application/json' }, Buffer.from('{"success":true}')))
        } catch {
          client.write(buildResponse(400, { 'Content-Type': 'application/json' }, Buffer.from('{"error":"Invalid request"}')))
        }
        client.end()
        return
      }

      const targetParts = target.replace(/^https?:\/\//, '').split(':')
      const targetHost = targetParts[0] ?? '127.0.0.1'
      const targetPort = parseInt(targetParts[1] ?? '80')

      if (isWS) {
        const server = net.connect(targetPort, targetHost)
        server.on('error', () => client.destroy())
        client.on('error', () => server.destroy())
        server.write(clientHead)
        server.pipe(client)
        client.pipe(server)
        return
      }

      const server = net.connect(targetPort, targetHost)
      server.on('error', () => client.destroy())
      client.on('error', () => server.destroy())
      server.write(clientHead)
      client.pipe(server)

      let serverHeadBuf = ''
      let serverParsed = false
      let isHtml = false
      let enc: string | null = null
      let status = 200
      let resHeaders: Record<string, string> = {}
      let bodyBuf: Buffer[] = []
      let headEnd = -1

      server.on('data', (sChunk) => {
        if (!serverParsed) {
          serverHeadBuf += sChunk.toString('utf8')
          const sHe = serverHeadBuf.indexOf('\r\n\r\n')
          if (sHe < 0) return
          headEnd = sHe + 4
          const p = parseResHeaders(serverHeadBuf.slice(0, sHe))
          status = p.status
          resHeaders = p.headers
          isHtml = (resHeaders['content-type'] || '').includes('text/html')
          enc = resHeaders['content-encoding'] || null
          serverParsed = true

          if (isHtml && enc) {
            bodyBuf.push(sChunk.slice(headEnd))
            return
          }

          if (isHtml) {
            const body = sChunk.slice(headEnd)
            forwardHtml(client, body, resHeaders, status)
            return
          }

          client.write(sChunk)
          return
        }

        if (isHtml && enc) {
          bodyBuf.push(sChunk)
          return
        }
        if (isHtml) {
          forwardHtmlChunk(client, sChunk)
          return
        }
        client.write(sChunk)
      })

      server.on('end', () => {
        if (!serverParsed) { client.end(); return }

        if (isHtml && enc) {
          const fullBody = Buffer.concat(bodyBuf)
          let text: string
          try {
            if (enc === 'gzip') text = zlib.gunzipSync(fullBody).toString('utf8')
            else if (enc === 'deflate') text = zlib.inflateSync(fullBody).toString('utf8')
            else text = fullBody.toString('utf8')
          } catch { client.end(); return }

          const bi = text.indexOf('</body>')
          const hi = text.indexOf('</head>')
          let modified: string
          if (bi >= 0) modified = text.slice(0, bi) + INJECT_SCRIPT + text.slice(bi)
          else if (hi >= 0) modified = text.slice(0, hi) + INJECT_SCRIPT + text.slice(hi)
          else { client.end(); return }

          let compressed: Buffer
          if (enc === 'gzip') compressed = zlib.gzipSync(Buffer.from(modified, 'utf8'))
          else if (enc === 'deflate') compressed = zlib.deflateSync(Buffer.from(modified, 'utf8'))
          else compressed = Buffer.from(modified, 'utf8')

          const newH = { ...resHeaders }
          delete newH['content-length']
          const headStr = `HTTP/1.1 ${status} OK\r\n` +
            Object.entries(newH).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n'
          client.write(Buffer.from(headStr, 'utf8'))
          client.write(compressed)
        }

        client.end()
      })
    })

    client.on('error', () => {})
  })

  server.listen(port, '0.0.0.0', () => {
    logger.debug('Inspect proxy listening', { port, target })
  })

  proxyPool.set(target, { server, target })

  const cleanup = () => {
    server.close()
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
}