import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, basename, join } from 'node:path'
import { readdir, readFile, access } from 'node:fs/promises'

import type { Config } from '../shared/types.js'
import { initDatabase, closeDatabase } from './db/index.js'
import { createLLMClient, detectModel, getLlmStatus, detectBackend, getBackendDisplayName, type Backend } from './llm/index.js'
import { createToolRegistry } from './tools/index.js'
import { createWebSocketServer } from './ws/index.js'
import { sessionManager } from './session/index.js'
import { logger, setLogLevel } from './utils/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function createServer(config: Config): Promise<void> {
  // Set log level (mode-based default: debug for dev, warn for production)
  setLogLevel(config.logging?.level ?? undefined, config.mode)

  // Initialize database
  initDatabase(config)

  // Create LLM client (backend will be set after detection)
  const llmClient = createLLMClient(config)

  // Auto-detect backend and model from LLM server
  async function initLLM(): Promise<void> {
    let backend: Backend = 'unknown'
    if (config.llm.backend === 'auto') {
      backend = await detectBackend(config.llm.baseUrl)
      llmClient.setBackend(backend)
      logger.info('Auto-detected LLM backend', { backend: getBackendDisplayName(backend) })
    } else {
      backend = config.llm.backend
      llmClient.setBackend(backend)
      logger.info('Using configured LLM backend', { backend: getBackendDisplayName(backend) })
    }
    
    const detected = await detectModel(config.llm.baseUrl)
    if (detected) {
      llmClient.setModel(detected)
      logger.info('Auto-detected LLM model', { model: detected, backend: getBackendDisplayName(backend) })
    } else {
      logger.warn('Could not auto-detect model, using config', { model: config.llm.model })
    }
  }

  initLLM().catch(err => logger.error('LLM initialization failed', { error: err }))

  const toolRegistry = createToolRegistry()
  const app = new Hono()

  // Middleware
  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }))

  // Health check
  app.get('/api/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // Session endpoints (REST fallback)
  app.get('/api/sessions', (c) => {
    const sessions = sessionManager.listSessions()
    return c.json({ sessions })
  })

  app.post('/api/sessions', async (c) => {
    const body = await c.req.json<{ workdir: string; title?: string }>()
    const session = sessionManager.createSession(body.workdir, body.title)
    return c.json({ session }, 201)
  })

  app.get('/api/sessions/:id', (c) => {
    const session = sessionManager.getSession(c.req.param('id'))
    if (!session) {
      return c.json({ error: 'Session not found' }, 404)
    }
    return c.json({ session })
  })

  app.delete('/api/sessions/:id', (c) => {
    sessionManager.deleteSession(c.req.param('id'))
    return c.json({ success: true })
  })

  // Config endpoint - returns current model (auto-detected or configured)
  app.get('/api/config', (c) => {
    return c.json({
      model: llmClient.getModel(),
      maxContext: config.context.maxTokens,
      llmUrl: config.llm.baseUrl,
      llmStatus: getLlmStatus(),
      backend: llmClient.getBackend(),
    })
  })

  // Model refresh endpoint - re-detect model from LLM server
  app.post('/api/model/refresh', async (c) => {
    const detected = await detectModel(config.llm.baseUrl)
    if (detected) {
      llmClient.setModel(detected)
      return c.json({ model: detected, source: 'detected', llmStatus: getLlmStatus(), backend: llmClient.getBackend() })
    }
    return c.json({ model: llmClient.getModel(), source: 'cached', llmStatus: getLlmStatus(), backend: llmClient.getBackend() })
  })

  // Directory browser endpoint
  const DEFAULT_BASE_PATH = process.cwd()

  app.get('/api/directories', async (c) => {
    const path = c.req.query('path') || DEFAULT_BASE_PATH
    
    try {
      const resolvedPath = resolve(path)
      
      const entries = await readdir(resolvedPath, { withFileTypes: true })
      const directories = entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => ({
          name: entry.name,
          path: join(resolvedPath, entry.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
      
      const parent = dirname(resolvedPath)
      const hasParent = parent !== resolvedPath
      
      return c.json({
        current: resolvedPath,
        parent: hasParent ? parent : null,
        directories,
        basename: basename(resolvedPath),
      })
    } catch (error) {
      return c.json({ 
        error: 'Cannot read directory',
        current: DEFAULT_BASE_PATH,
        parent: null,
        directories: [],
        basename: basename(DEFAULT_BASE_PATH),
      }, 400)
    }
  })

  // Serve static web UI (built output in dist/web, sibling to server chunks)
  const webDir = resolve(__dirname, 'web')
  
  // Helper to get content type from extension
  function getContentType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase()
    const types: Record<string, string> = {
      js: 'application/javascript',
      css: 'text/css',
      html: 'text/html',
      svg: 'image/svg+xml',
      woff: 'font/woff',
      woff2: 'font/woff2',
      png: 'image/png',
      jpg: 'image/jpeg',
      ico: 'image/x-icon',
    }
    return types[ext || ''] || 'application/octet-stream'
  }
  
  // Dev mode: proxy frontend requests to Vite dev server
  const isDev = config.mode === 'development'
  
  if (isDev) {
    logger.info('Dev mode: proxying frontend requests to Vite', { target: 'http://localhost:5173' })
    
    // Proxy root path to Vite
    app.get('/', async (c) => {
      const response = await fetch('http://localhost:5173/')
      const content = await response.text()
      return c.html(content)
    })
    
    // Proxy assets
    app.get('/assets/*', async (c) => {
      const path = c.req.path
      const response = await fetch(`http://localhost:5173${path}`)
      const content = await response.arrayBuffer()
      return c.body(content, 200, { 'Content-Type': getContentType(path) })
    })
    
    // Proxy fox.svg
    app.get('/fox.svg', async (c) => {
      const response = await fetch('http://localhost:5173/fox.svg')
      const content = await response.arrayBuffer()
      return c.body(content, 200, { 'Content-Type': 'image/svg+xml' })
    })
    
    // Proxy sounds
    app.get('/sounds/*', async (c) => {
      const path = c.req.path
      const response = await fetch(`http://localhost:5173${path}`)
      const content = await response.arrayBuffer()
      return c.body(content, 200, { 'Content-Type': 'audio/mpeg' })
    })
    
    // Catch-all for SPA routing - proxy to Vite
    app.get('*', async (c) => {
      const path = c.req.path
      // Skip catch-all for API
      if (path.startsWith('/api/')) {
        // API routes are handled above, this won't be reached
        return
      }
      const response = await fetch(`http://localhost:5173${path}`)
      if (response.status === 404) {
        // Vite returns 404, try index.html for SPA
        const indexResponse = await fetch('http://localhost:5173/')
        const content = await indexResponse.text()
        return c.html(content)
      }
      const content = await response.text()
      return c.body(content, 200, { 'Content-Type': getContentType(path) })
    })
  } else {
    // Production mode: serve static files from dist/web
    
    // Serve all static files from web directory
    app.get('/assets/*', async (c) => {
      const path = c.req.path
      const filename = path.substring(path.lastIndexOf('/') + 1)
      const filePath = join(webDir, 'assets', filename)
      try {
        await access(filePath)
        const content = await readFile(filePath)
        return c.body(content, 200, { 'Content-Type': getContentType(filePath) })
      } catch {
        return c.text('Not found: ' + filename, 404)
      }
    })
    
    app.get('/fox.svg', async (c) => {
      try {
        const content = await readFile(join(webDir, 'fox.svg'))
        return c.body(content, 200, { 'Content-Type': 'image/svg+xml' })
      } catch {
        return c.text('Not found', 404)
      }
    })
    
    app.get('/sounds/*', async (c) => {
      const path = c.req.path
      const filename = path.substring(path.lastIndexOf('/') + 1)
      const filePath = join(webDir, 'sounds', filename)
      try {
        await access(filePath)
        const content = await readFile(filePath)
        return c.body(content, 200, { 'Content-Type': 'audio/mpeg' })
      } catch {
        return c.text('Not found: ' + filename, 404)
      }
    })
    
    app.get('/', async (c) => {
      try {
        const content = await readFile(join(webDir, 'index.html'))
        return c.html(content.toString())
      } catch {
        return c.text('Web UI not built. Run `npm run build:web`', 404)
      }
    })
    
    // Catch-all route for SPA - serve index.html for any unmatched path
    // Must be after all specific routes (/api/*, /assets/*, /sounds/*, /fox.svg)
    app.get('*', async (c) => {
      const path = c.req.path
      // Skip catch-all for API and static assets
      if (path.startsWith('/api/') || path.startsWith('/assets/') || path.startsWith('/sounds/') || path === '/fox.svg') {
        return c.body(null)
      }
      try {
        const content = await readFile(join(webDir, 'index.html'))
        return c.html(content.toString())
      } catch {
        return c.text('Web UI not built. Run `npm run build:web`', 404)
      }
    })
  }

  // Convert headers to Headers object
  function toHeaders(incomingHeaders: IncomingMessage['headers']): Headers {
    const headers = new Headers()
    for (const [key, value] of Object.entries(incomingHeaders)) {
      if (value) {
        if (Array.isArray(value)) {
          value.forEach(v => headers.append(key, v))
        } else {
          headers.set(key, value)
        }
      }
    }
    return headers
  }

  // Create HTTP server
  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.headers.upgrade?.toLowerCase() === 'websocket') {
      return
    }
    
    const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`
    const method = req.method ?? 'GET'
    
    const requestInit: RequestInit = {
      method,
      headers: toHeaders(req.headers),
    }
    
    if (!['GET', 'HEAD'].includes(method)) {
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(chunk as Buffer)
      }
      if (chunks.length > 0) {
        requestInit.body = Buffer.concat(chunks)
      }
    }
    
    const response = await app.fetch(new Request(url, requestInit))
    
    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })
    
    if (response.body) {
      const reader = response.body.getReader()
      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read()
        if (done) {
          res.end()
          return
        }
        res.write(value)
        return pump()
      }
      await pump()
    } else {
      res.end()
    }
  })

  // Create WebSocket server
  createWebSocketServer(httpServer, config, llmClient, toolRegistry)

  // Start server
  httpServer.listen(config.server.port, config.server.host, () => {
    logger.info(`OpenFox server running at http://${config.server.host}:${config.server.port}`)
    logger.info(`WebSocket available at ws://${config.server.host}:${config.server.port}/ws`)
    logger.info(`LLM server at ${config.llm.baseUrl}`)
    logger.info(`Model: ${config.llm.model}`)
  })

  // Graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Shutting down...')
    closeDatabase()
    httpServer.close()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    logger.info('Shutting down...')
    closeDatabase()
    httpServer.close()
    process.exit(0)
  })
}
