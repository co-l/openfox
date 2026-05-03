import net from 'net'
import zlib from 'zlib'
import { logger } from '../utils/logger.js'
import type { SessionManager } from '../session/manager.js'

const OPENFOX_BASE_PORT = Number(process.env['OPENFOX_PORT'] ?? 10369)
const INJECT_SCRIPT = `<script src="http://127.0.0.1:${OPENFOX_BASE_PORT}/__inspect__.js"></script>`

function buildHttpHeaders(
  resHeaders: Record<string, string>,
  status: number,
  contentLengthOverride?: number,
  contentTypeOverride?: string,
): string {
  const newH: Record<string, string> = { ...resHeaders }
  delete newH['content-length']
  delete newH['transfer-encoding']
  newH['connection'] = 'close'
  if (contentLengthOverride !== undefined) newH['content-length'] = contentLengthOverride.toString()
  if (contentTypeOverride !== undefined) newH['content-type'] = contentTypeOverride
  return (
    `HTTP/1.1 ${status} OK\r\n` +
    Object.entries(newH)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n') +
    '\r\n\r\n'
  )
}

interface ProxyInstance {
  server: ReturnType<typeof net.createServer>
  target: string
}

const proxyPool = new Map<string, ProxyInstance>()
let nextOffset = 0

function getAvailablePort(): number {
  const base = Number(process.env['OPENFOX_PORT'] ?? 10369)
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
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n')
  const head = Buffer.from(`${statusLine}\r\n${headerLines}\r\n\r\n`, 'utf8')
  return Buffer.concat([head, body])
}

function dechunk(buf: Buffer): Buffer {
  const str = buf.toString('utf8')
  const parts: string[] = []
  let pos = 0
  while (pos < str.length) {
    const nlIdx = str.indexOf('\r\n', pos)
    if (nlIdx < 0) break
    const sizeStr = str.slice(pos, nlIdx)
    const size = parseInt(sizeStr, 16)
    if (isNaN(size) || size < 0) break
    if (size === 0) break
    const chunkStart = nlIdx + 2
    const chunkEnd = chunkStart + size
    if (chunkEnd > str.length) break
    parts.push(str.slice(chunkStart, chunkEnd))
    pos = chunkEnd + 2
  }
  return Buffer.from(parts.join(''), 'utf8')
}

export function startInspectProxy(
  target: string,
  sessionManager: SessionManager,
): { port: number; cleanup: () => void } {
  const port = getAvailablePort()

  const server = net.createServer((client) => {
    let clientHead = ''
    let clientParsed = false
    let targetSocket: net.Socket | undefined

    client.on('data', (chunk) => {
      if (clientParsed) {
        targetSocket?.write(chunk)
        return
      }

      clientHead += chunk.toString('utf8')
      const he = clientHead.indexOf('\r\n\r\n')
      if (he < 0) return

      const { method, url, headers } = parseReqHeaders(clientHead)
      const isWS = headers['upgrade'] === 'websocket'
      clientParsed = true

      if (url === '/__openfox_feedback' && method === 'POST') {
        const contentLength = parseInt(headers['content-length'] || '0', 10)
        let bodyData = chunk.slice(he + 4)
        let bodyTotal = bodyData.length
        const handleFeedback = () => {
          try {
            const { sessionId, element, annotation, pageUrl } = JSON.parse(bodyData.toString('utf8'))
            if (sessionId) {
              const elementDesc = element ? `${element.tag}${element.id ? '#' + element.id : ''}` : 'unknown'
              const htmlSnippet = element?.outerHTML ? `\nHtml: ${element.outerHTML.slice(0, 300)}` : ''
              const textSnippet = element?.textContent
                ? `\nText (SVG-stripped): ${element.textContent.slice(0, 500)}`
                : ''
              const content = `# User feedback from page inspection on dev_server\n\n## Context\n\nPage: ${pageUrl || ''}\nElement: ${elementDesc}\nxPath: ${element?.xpath || ''}${htmlSnippet}${textSnippet}\n\n## Feedback\n\n${annotation || '(none)'}`
              sessionManager.queueMessage(sessionId, 'asap', content, [], 'ui_feedback')
            }
            client.write(buildResponse(200, { 'Content-Type': 'application/json' }, Buffer.from('{"success":true}')))
          } catch {
            client.write(
              buildResponse(400, { 'Content-Type': 'application/json' }, Buffer.from('{"error":"Invalid request"}')),
            )
          }
          client.end()
        }
        if (bodyTotal >= contentLength) {
          handleFeedback()
          return
        }
        client.on('data', (more) => {
          bodyData = Buffer.concat([bodyData, more])
          bodyTotal += more.length
          if (bodyTotal < contentLength) return
          handleFeedback()
        })
        return
      }

      const targetParts = target.replace(/^https?:\/\//, '').split(':')
      const targetHost = targetParts[0] ?? '127.0.0.1'
      const targetPort = parseInt(targetParts[1] ?? '80')

      if (isWS) {
        targetSocket = net.connect(targetPort, targetHost)
        targetSocket.on('error', () => client.destroy())
        client.on('error', () => targetSocket!.destroy())
        targetSocket.write(clientHead)
        targetSocket.pipe(client)
        client.pipe(targetSocket!)
        return
      }

      targetSocket = net.connect(targetPort, targetHost)
      targetSocket.on('error', () => client.destroy())
      client.on('error', () => targetSocket!.destroy())
      client.on('end', () => targetSocket!.end())

      // Force target to close connection after response so we get on('end') promptly
      const connClose = '\r\nConnection: close'
      const reqEnd = clientHead.indexOf('\r\n\r\n')
      const forwardHead = clientHead.slice(0, reqEnd) + connClose + clientHead.slice(reqEnd)
      targetSocket.write(forwardHead)
      targetSocket.on('close', () => {
        if (!client.destroyed) client.end()
      })

      let serverHeadBuf = ''
      let serverParsed = false
      let isHtml = false
      let enc: string | null = null
      let status = 200
      let resHeaders: Record<string, string> = {}
      const bodyBuf: Buffer[] = []
      let headEnd = -1

      targetSocket.on('data', (sChunk) => {
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
          const isChunked = (resHeaders['transfer-encoding'] || '').toLowerCase() === 'chunked'
          serverParsed = true

          if (isHtml && enc) {
            bodyBuf.push(sChunk.slice(headEnd))
            return
          }

          if (isHtml && isChunked) {
            bodyBuf.push(sChunk.slice(headEnd))
            return
          }

          if (isHtml) {
            bodyBuf.push(sChunk.slice(headEnd))
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
          bodyBuf.push(sChunk)
          return
        }
        client.write(sChunk)
      })

      targetSocket.on('end', () => {
        if (!serverParsed) {
          client.end()
          return
        }

        if (isHtml && enc) {
          const fullBody = Buffer.concat(bodyBuf)
          let text: string
          try {
            if (enc === 'gzip') text = zlib.gunzipSync(fullBody).toString('utf8')
            else if (enc === 'deflate') text = zlib.inflateSync(fullBody).toString('utf8')
            else text = fullBody.toString('utf8')
          } catch {
            client.end()
            return
          }

          const bi = text.indexOf('</body>')
          const hi = text.indexOf('</head>')
          let modified: string
          if (bi >= 0) modified = text.slice(0, bi) + INJECT_SCRIPT + text.slice(bi)
          else if (hi >= 0) modified = text.slice(0, hi) + INJECT_SCRIPT + text.slice(hi)
          else {
            client.end()
            return
          }

          let compressed: Buffer
          if (enc === 'gzip') compressed = zlib.gzipSync(Buffer.from(modified, 'utf8'))
          else if (enc === 'deflate') compressed = zlib.deflateSync(Buffer.from(modified, 'utf8'))
          else compressed = Buffer.from(modified, 'utf8')

          const headStr = buildHttpHeaders(resHeaders, status)
          client.write(Buffer.from(headStr, 'utf8'))
          client.write(compressed)
        } else if (isHtml && bodyBuf.length > 0) {
          const fullBody = Buffer.concat(bodyBuf)
          const isChunked = (resHeaders['transfer-encoding'] || '').toLowerCase() === 'chunked'
          const dechunks = isChunked ? dechunk(fullBody) : fullBody
          const bi = dechunks.indexOf('</body>')
          const hi = dechunks.indexOf('</head>')
          let modified: Buffer
          if (bi >= 0)
            modified = Buffer.concat([dechunks.slice(0, bi), Buffer.from(INJECT_SCRIPT, 'utf8'), dechunks.slice(bi)])
          else if (hi >= 0)
            modified = Buffer.concat([dechunks.slice(0, hi), Buffer.from(INJECT_SCRIPT, 'utf8'), dechunks.slice(hi)])
          else {
            client.end()
            return
          }

          const headStr = buildHttpHeaders(resHeaders, status, Buffer.byteLength(modified), 'text/html; charset=utf-8')
          client.write(Buffer.from(headStr, 'utf8'))
          client.write(modified as Buffer)
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
