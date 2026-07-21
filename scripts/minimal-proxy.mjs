#!/usr/bin/env node
import { createServer } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as tcpConnect } from 'node:net'

const PORT = parseInt(process.argv[2] || '9876', 10)

const server = createServer((req, res) => {
  const targetUrl = req.url
  if (!targetUrl) {
    res.writeHead(400)
    res.end('No target URL')
    return
  }

  const parsed = new URL(targetUrl)
  const isHttps = parsed.protocol === 'https:'
  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers: { ...req.headers, host: parsed.host },
  }

  const backend = isHttps ? httpsRequest : httpRequest
  const proxyReq = backend(options, (backendRes) => {
    res.writeHead(backendRes.statusCode || 200, backendRes.headers)
    backendRes.pipe(res)
  })
  proxyReq.on('error', () => {
    res.writeHead(502)
    res.end('Bad Gateway')
  })
  req.pipe(proxyReq)
})

server.on('connect', (req, clientSocket, head) => {
  const [host, port] = req.url.split(':')
  const serverSocket = tcpConnect(parseInt(port || '443', 10), host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    serverSocket.write(head)
    serverSocket.pipe(clientSocket)
    clientSocket.pipe(serverSocket)
  })
  serverSocket.on('error', () => {
    clientSocket.end()
  })
  clientSocket.on('error', () => {
    serverSocket.end()
  })
})

server.listen(PORT, () => {
  console.log(`minimal-proxy listening on http://localhost:${PORT}`)
})
