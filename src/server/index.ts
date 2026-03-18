import express from 'express'
import cors from 'cors'
import { createServer as createHttpServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { readFile, access } from 'node:fs/promises'
import { createServer as createViteServer, type ViteDevServer } from 'vite'

import type { Config } from '../shared/types.js'
import { initDatabase, closeDatabase } from './db/index.js'
import { createLLMClient, detectModel, getLlmStatus, detectBackend, getBackendDisplayName, type Backend } from './llm/index.js'
import { createToolRegistry } from './tools/index.js'
import { createWebSocketServer } from './ws/index.js'
import { sessionManager } from './session/index.js'
import { logger, setLogLevel } from './utils/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function createServer(config: Config): Promise<void> {
  // Set log level
  setLogLevel(config.logging?.level ?? undefined, config.mode)

  // Initialize database
  initDatabase(config)

  // Create LLM client
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
  const app = express()

  // Middleware
  app.use(cors())
  app.use(express.json())

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // Session endpoints (REST)
  app.get('/api/sessions', (_req, res) => {
    const sessions = sessionManager.listSessions()
    res.json({ sessions })
  })

  app.post('/api/sessions', async (req, res) => {
    const { workdir, title } = req.body
    const session = sessionManager.createSession(workdir, title)
    res.status(201).json({ session })
  })

  app.get('/api/sessions/:id', (req, res) => {
    const session = sessionManager.getSession(req.params.id)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }
    res.json({ session })
  })

  app.delete('/api/sessions/:id', (_req, res) => {
    sessionManager.deleteSession(req.params.id)
    res.json({ success: true })
  })

  // Config endpoint
  app.get('/api/config', (_req, res) => {
    res.json({
      model: llmClient.getModel(),
      maxContext: config.context.maxTokens,
      llmUrl: config.llm.baseUrl,
      llmStatus: getLlmStatus(),
      backend: llmClient.getBackend(),
    })
  })

  // Model refresh endpoint
  app.post('/api/model/refresh', async (_req, res) => {
    const detected = await detectModel(config.llm.baseUrl)
    if (detected) {
      llmClient.setModel(detected)
      return res.json({ model: detected, source: 'detected', llmStatus: getLlmStatus(), backend: llmClient.getBackend() })
    }
    res.json({ model: llmClient.getModel(), source: 'cached', llmStatus: getLlmStatus(), backend: llmClient.getBackend() })
  })

  // Directory browser endpoint
  const DEFAULT_BASE_PATH = process.cwd()

  app.get('/api/directories', async (req, res) => {
    const path = req.query.path as string || DEFAULT_BASE_PATH
    
    try {
      const resolvedPath = resolve(path)
      
      const entries = await import('node:fs/promises').then(m => m.readdir(resolvedPath, { withFileTypes: true }))
      const directories = entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => ({
          name: entry.name,
          path: join(resolvedPath, entry.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
      
      const parent = dirname(resolvedPath)
      const hasParent = parent !== resolvedPath
      
      res.json({
        current: resolvedPath,
        parent: hasParent ? parent : null,
        directories,
        basename: basename(resolvedPath),
      })
    } catch (error) {
      res.status(400).json({ 
        error: 'Cannot read directory',
        current: DEFAULT_BASE_PATH,
        parent: null,
        directories: [],
        basename: basename(DEFAULT_BASE_PATH),
      })
    }
  })

  // Serve static web UI
  const webDir = resolve(__dirname, '../../web')
  const isDev = config.mode === 'development'
  
  let viteServer: ViteDevServer | undefined
  
  // Dev mode: use Vite as middleware
  if (isDev) {
    logger.info('Dev mode: using Vite middleware')
    
    // Create Vite server in middleware mode
    viteServer = await createViteServer({
      root: webDir,
      configFile: resolve(__dirname, '../../web/vite.config.ts'),
      server: { middlewareMode: true },
      appType: 'spa',
      logLevel: 'warn',
    })
    
    // Use Vite's middleware - handles all Vite routes (/@vite/*, /@react-refresh, /src/*, etc.)
    app.use(viteServer.middlewares)
    
    // Static files that Vite doesn't handle
    app.get('/fox.svg', (_req, res) => {
      readFile(join(webDir, 'fox.svg')).then(content => {
        res.set('Content-Type', 'image/svg+xml')
        res.send(content)
      }).catch(() => {
        res.status(404).send('Not found')
      })
    })
    
    app.get('/sounds/*', (req, res) => {
      const fullPath = join(webDir, req.path.substring(1))
      readFile(fullPath).then(content => {
        res.set('Content-Type', 'audio/mpeg')
        res.send(content)
      }).catch(() => {
        res.status(404).send('Not found')
      })
    })
    
    // SPA fallback for non-API routes
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return
      }
      readFile(join(webDir, 'index.html'), 'utf-8')
        .then(indexHtml => viteServer!.transformIndexHtml(req.originalUrl, indexHtml))
        .then(transformed => res.send(transformed))
        .catch(err => {
          logger.error('Error serving index.html', { error: err })
          res.status(500).send('Server error')
        })
    })
    
    logger.info('Vite middleware ready', { port: config.server.port })
  }
  
  // Production mode: serve static files from dist/web
  if (!isDev) {
    const distWebDir = resolve(__dirname, 'web')
    
    // Serve static assets
    app.use('/assets', express.static(join(distWebDir, 'assets')))
    
    // Static files
    app.get('/fox.svg', (_req, res) => {
      readFile(join(distWebDir, 'fox.svg')).then(content => {
        res.set('Content-Type', 'image/svg+xml')
        res.send(content)
      }).catch(() => {
        res.status(404).send('Not found')
      })
    })
    
    app.get('/sounds/*', (req, res) => {
      const fullPath = join(distWebDir, req.path.substring(1))
      readFile(fullPath).then(content => {
        res.set('Content-Type', 'audio/mpeg')
        res.send(content)
      }).catch(() => {
        res.status(404).send('Not found')
      })
    })
    
    // Root serves index.html
    app.get('/', (_req, res) => {
      readFile(join(distWebDir, 'index.html'), 'utf-8')
        .then(content => res.send(content))
        .catch(() => {
          res.status(404).send('Web UI not built. Run `npm run build:web`')
        })
    })
    
    // SPA fallback - serve index.html for any unmatched path
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/assets/') || req.path.startsWith('/sounds/') || req.path === '/fox.svg') {
        return
      }
      readFile(join(distWebDir, 'index.html'), 'utf-8')
        .then(content => res.send(content))
        .catch(() => {
          res.status(404).send('Web UI not built')
        })
    })
  }

  // Create HTTP server from Express app
  const httpServer = createHttpServer(app)

  // Create WebSocket server attached to HTTP server
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

function basename(path: string): string {
  return path.split('/').pop() || path.split('\\').pop() || path
}
