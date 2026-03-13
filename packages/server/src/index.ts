import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, basename, join } from 'node:path'
import { readdir, stat } from 'node:fs/promises'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../../../.env') })
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { loadConfig } from './config.js'
import { initDatabase, closeDatabase } from './db/index.js'
import { createLLMClient, detectModel } from './llm/index.js'
import { createToolRegistry } from './tools/index.js'
import { createWebSocketServer } from './ws/index.js'
import { sessionManager } from './session/index.js'
import { logger, setLogLevel } from './utils/logger.js'

// Load configuration
const config = loadConfig()

// Set log level
setLogLevel(process.env['OPENFOX_LOG_LEVEL'] as 'debug' | 'info' | 'warn' | 'error' ?? 'info')

// Initialize database
initDatabase(config)

// Create LLM client
const llmClient = createLLMClient(config)

// Auto-detect model from vLLM
async function initModel(): Promise<void> {
  const detected = await detectModel(config.vllm.baseUrl)
  if (detected) {
    llmClient.setModel(detected)
    logger.info('Auto-detected model from vLLM', { model: detected })
  } else {
    logger.warn('Could not auto-detect model, using config', { model: config.vllm.model })
  }
}

// Run model detection (non-blocking)
initModel().catch(err => logger.error('Model detection failed', { error: err }))

// Create tool registry
const toolRegistry = createToolRegistry()

// Create Hono app
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
    vllmUrl: config.vllm.baseUrl,
  })
})

// Model refresh endpoint - re-detect model from vLLM
app.post('/api/model/refresh', async (c) => {
  const detected = await detectModel(config.vllm.baseUrl)
  if (detected) {
    llmClient.setModel(detected)
    return c.json({ model: detected, source: 'detected' })
  }
  return c.json({ model: llmClient.getModel(), source: 'cached' })
})

// Directory browser endpoint
const DEFAULT_BASE_PATH = '/home/conrad/dev'

app.get('/api/directories', async (c) => {
  const path = c.req.query('path') || DEFAULT_BASE_PATH
  
  try {
    // Security: ensure path is under allowed base paths
    const resolvedPath = resolve(path)
    
    const entries = await readdir(resolvedPath, { withFileTypes: true })
    const directories = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => ({
        name: entry.name,
        path: join(resolvedPath, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    
    // Get parent directory (if not at root)
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
const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Skip WebSocket upgrade requests - they're handled by ws
  if (req.headers.upgrade?.toLowerCase() === 'websocket') {
    return
  }
  
  const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`
  const method = req.method ?? 'GET'
  
  // Build request
  const requestInit: RequestInit = {
    method,
    headers: toHeaders(req.headers),
  }
  
  // Add body for non-GET/HEAD requests
  if (!['GET', 'HEAD'].includes(method)) {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    if (chunks.length > 0) {
      requestInit.body = Buffer.concat(chunks)
    }
  }
  
  // Handle with Hono
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
  logger.info(`Connected to vLLM at ${config.vllm.baseUrl}`)
  logger.info(`Model: ${config.vllm.model}`)
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

export { app }
