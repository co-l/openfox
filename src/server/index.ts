import express from 'express'
import cors from 'cors'
import { createServer as createHttpServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createServer as createViteServer, type ViteDevServer } from 'vite'

import type { Config, Provider } from '../shared/types.js'
import type { ServerHandle } from './context.js'
import { initDatabase, closeDatabase, getDatabase } from './db/index.js'
import { initEventStore } from './events/index.js'
import { createLLMClient, detectModel, getLlmStatus, detectBackend, getBackendDisplayName, type Backend } from './llm/index.js'
import { createMockLLMClient } from './llm/mock.js'
import { createProviderManager } from './provider-manager.js'
import { createToolRegistry } from './tools/index.js'
import { createWebSocketServer } from './ws/index.js'
import { SessionManager } from './session/manager.js'
import { logger, setLogLevel } from './utils/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Create a server handle that can be started on any port.
 * Returns a ServerHandle with start() and close() methods.
 * 
 * Use this for:
 * - In-process testing with isolated instances
 * - Programmatic server control
 */
export async function createServerHandle(config: Config): Promise<ServerHandle> {
  // Set log level
  setLogLevel(config.logging?.level ?? undefined, config.mode)

  // Initialize database
  const db = initDatabase(config)

  // Initialize event store
  initEventStore(db)

  // Create SessionManager instance (not singleton!)
  const sessionManager = new SessionManager()

  // Create Provider Manager (handles LLM client lifecycle)
  const providerManager = createProviderManager(config)
  
  // Create LLM client - use mock if OPENFOX_MOCK_LLM is set
  const useMock = process.env['OPENFOX_MOCK_LLM'] === 'true'
  // For mock mode, we bypass the provider manager
  const getMockClient = useMock ? createMockLLMClient : null
  const getLLMClient = () => getMockClient ? getMockClient() : providerManager.getLLMClient()
  
  if (useMock) {
    logger.info('Using MOCK LLM client - deterministic responses for testing')
  }

  // Auto-detect backend and model from LLM server
  async function initLLM(): Promise<void> {
    const llmClient = getLLMClient()
    let backend: Backend = 'unknown'
    const useMock = process.env['OPENFOX_MOCK_LLM'] === 'true'
    
    if (config.llm.backend === 'auto') {
      backend = await detectBackend(config.llm.baseUrl, undefined, useMock)
      llmClient.setBackend(backend)
      if (!useMock) {
        logger.info('Auto-detected LLM backend', { backend: getBackendDisplayName(backend) })
      }
    } else {
      backend = config.llm.backend
      llmClient.setBackend(backend)
      if (!useMock) {
        logger.info('Using configured LLM backend', { backend: getBackendDisplayName(backend) })
      }
    }
    
    const detected = await detectModel(config.llm.baseUrl)
    if (detected) {
      llmClient.setModel(detected)
      if (!useMock) {
        logger.info('Auto-detected LLM model', { model: detected, backend: getBackendDisplayName(backend) })
      }
    } else {
      if (!useMock) {
        logger.warn('Could not auto-detect model, using config', { model: config.llm.model })
      }
    }
  }

  initLLM().catch(err => logger.error('LLM initialization failed', { error: err instanceof Error ? err.message : String(err) }))

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

  app.delete('/api/sessions/:id', (req, res) => {
    sessionManager.deleteSession(req.params['id'] as string)
    res.json({ success: true })
  })

  // Config endpoint
  app.get('/api/config', (_req, res) => {
    const llmClient = getLLMClient()
    const activeProvider = providerManager.getActiveProvider()
    res.json({
      model: llmClient.getModel(),
      maxContext: config.context.maxTokens,
      llmUrl: activeProvider?.url ?? config.llm.baseUrl,
      llmStatus: getLlmStatus(),
      backend: llmClient.getBackend(),
      // Include provider info
      providers: providerManager.getProviders(),
      activeProviderId: providerManager.getActiveProviderId(),
    })
  })

  // Model refresh endpoint
  app.post('/api/model/refresh', async (_req, res) => {
    const llmClient = getLLMClient()
    const activeProvider = providerManager.getActiveProvider()
    const baseUrl = activeProvider?.url ?? config.llm.baseUrl
    const detected = await detectModel(baseUrl)
    if (detected) {
      llmClient.setModel(detected)
      return res.json({ model: detected, source: 'detected', llmStatus: getLlmStatus(), backend: llmClient.getBackend() })
    }
    res.json({ model: llmClient.getModel(), source: 'cached', llmStatus: getLlmStatus(), backend: llmClient.getBackend() })
  })

  // Provider endpoints
  app.get('/api/providers', (_req, res) => {
    const providers = providerManager.getProviders().map(p => ({
      ...p,
      status: providerManager.getProviderStatus(p.id),
    }))
    res.json({
      providers,
      activeProviderId: providerManager.getActiveProviderId(),
    })
  })

  app.get('/api/providers/:id/models', async (req, res) => {
    const { id } = req.params
    const models = await providerManager.getProviderModels(id as string)
    res.json({ models })
  })

  app.post('/api/providers/:id/activate', async (req, res) => {
    const { id } = req.params
    const body = req.body as { model?: string }
    const result = await providerManager.activateProvider(id as string, body.model ? { model: body.model } : undefined)
    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }
    const llmClient = getLLMClient()
    res.json({
      success: true,
      activeProviderId: id,
      model: llmClient.getModel(),
      backend: llmClient.getBackend(),
    })
  })

  // Directory browser endpoint
  const DEFAULT_BASE_PATH = process.cwd()

  app.get('/api/directories', async (req, res) => {
    const path = req.query['path'] as string || DEFAULT_BASE_PATH
    
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
    } catch {
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
    
    // Mount Vite middleware - handles /@vite/*, /@react-refresh, /src/*, etc.
    app.use(viteServer.middlewares)
    
    // Handle CSS files explicitly - Vite middleware doesn't catch them
    app.get('/src/styles/*.css', async (req, res) => {
      try {
        const result = await viteServer!.transformRequest(req.path.substring(1))
        if (!result) {
          return res.status(404).send('Not found')
        }
        res.set('Content-Type', 'text/css')
        res.send(result.code)
      } catch (err) {
        logger.error('CSS transform error', { path: req.path, error: err })
        res.status(500).send('Transform error')
      }
    })
    
    // Static files that Vite doesn't handle (after Vite middleware)
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
    
    // SPA fallback for non-API routes (must be last)
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
    
    // Serve static assets with proper caching
    app.use('/assets', express.static(join(distWebDir, 'assets'), {
      setHeaders: (res, filepath) => {
        if (filepath.endsWith('.css')) {
          res.set('Content-Type', 'text/css')
        }
      }
    }))
    
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
  const wss = createWebSocketServer(httpServer, config, getLLMClient, toolRegistry, sessionManager)

  // Return the handle with start/close methods
  return {
    httpServer,
    ctx: { config, sessionManager, llmClient: getLLMClient(), toolRegistry, providerManager },
    
    start: (port?: number) => new Promise((resolve, reject) => {
      const listenPort = port ?? config.server.port
      const host = config.server.host
      
      httpServer.listen(listenPort, host, () => {
        const addr = httpServer.address()
        const actualPort = typeof addr === 'object' && addr ? addr.port : listenPort
        const client = getLLMClient()
        logger.info(`OpenFox server running at http://${host}:${actualPort}`)
        logger.info(`WebSocket available at ws://${host}:${actualPort}/ws`)
        logger.info(`LLM backend: ${client.getBackend()}, model: ${client.getModel()}, url: ${config.llm.baseUrl}`)
        resolve({ port: actualPort })
      })
      
      httpServer.on('error', reject)
    }),
    
    close: () => new Promise<void>((resolve) => {
      logger.info('Shutting down...')
      viteServer?.close()
      closeDatabase()
      // Terminate all WebSocket connections to allow clean shutdown
      for (const client of wss.clients) {
        client.terminate()
      }
      wss.close()
      httpServer.close(() => resolve())
    }),
  }
}

/**
 * Create and start a server (convenience function for CLI).
 * Starts listening immediately on the configured port.
 * Sets up SIGINT/SIGTERM handlers.
 */
export async function createServer(config: Config): Promise<void> {
  const handle = await createServerHandle(config)
  await handle.start()
  
  // Graceful shutdown with force exit timeout
  const shutdown = () => {
    // Force exit after 3 seconds if graceful shutdown hangs
    const forceExitTimer = setTimeout(() => {
      logger.warn('Forcing exit after timeout')
      process.exit(1)
    }, 3000)
    forceExitTimer.unref() // Don't keep process alive just for this timer
    
    handle.close().then(() => process.exit(0))
  }
  
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

function basename(path: string): string {
  return path.split('/').pop() || path.split('\\').pop() || path
}
