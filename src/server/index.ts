import express from 'express'
import cors from 'cors'
import { spawn, type ChildProcess } from 'node:child_process'
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
import { setRuntimeConfig, getRuntimeConfig } from './runtime-config.js'
import { ensureDefaultSkills, loadAllSkills, isSkillEnabled, setSkillEnabled, findSkillById, saveSkill, deleteSkill, skillExists } from './skills/registry.js'
import type { SkillDefinition } from './skills/types.js'
import { ensureDefaultCommands, loadAllCommands, findCommandById, saveCommand, deleteCommand, commandExists } from './commands/registry.js'
import type { CommandDefinition } from './commands/types.js'
import { getGlobalConfigDir } from '../cli/paths.js'
import { logger, setLogLevel } from './utils/logger.js'
import { terminateProcessTree } from './utils/process-tree.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HISTORY_PROCESS_ENTRYPOINT = getHistoryProcessEntrypoint()

/**
 * Create a server handle that can be started on any port.
 * Returns a ServerHandle with start() and close() methods.
 * 
 * Use this for:
 * - In-process testing with isolated instances
 * - Programmatic server control
 */
export async function createServerHandle(config: Config): Promise<ServerHandle> {
  setRuntimeConfig(config)

  // Set log level
  setLogLevel(config.logging?.level ?? undefined, config.mode)

  // Initialize database
  const db = initDatabase(config)

  // Initialize event store
  initEventStore(db)

  // Initialize skills and commands (copy defaults to config dir)
  const configDir = getGlobalConfigDir(config.mode ?? 'production')
  await ensureDefaultSkills(configDir)
  await ensureDefaultCommands(configDir)

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

  type HistoryService = {
    process: ChildProcess
    stopping: boolean
    stopPromise: Promise<void> | null
  }

  const historyServices = new Map<string, HistoryService>()
  const pendingHistoryStarts = new Map<string, Promise<void>>()
  const sessionWorkdirs = new Map(sessionManager.listSessions().map(session => [session.id, session.workdir]))
  const pinnedHistoryWorkdirs = new Set<string>()

  // Skip history watcher if disabled (useful for tests)
  const skipHistory = process.env['OPENFOX_HISTORY'] === 'false'

  async function initHistoryForWorkdir(workdir: string): Promise<void> {
    if (skipHistory) {
      return
    }

    const pendingStart = pendingHistoryStarts.get(workdir)
    if (pendingStart) {
      await pendingStart
      return
    }

    const existingService = historyServices.get(workdir)
    if (existingService) {
      if (!existingService.stopping) {
        return
      }

      await existingService.stopPromise
    }

    const startup = (async () => {
      // Use npx to resolve tsx, avoiding hardcoded paths that break on global installation
      const child = spawn(
        'npx',
        ['tsx', HISTORY_PROCESS_ENTRYPOINT, workdir],
        {
          cwd: process.cwd(), // Don't use workdir - test projects get deleted
          env: process.env,
          stdio: ['ignore', 'inherit', 'inherit'],
        }
      )

      const service: HistoryService = {
        process: child,
        stopping: false,
        stopPromise: null,
      }

      historyServices.set(workdir, service)

      child.on('error', (error) => {
        handleHistoryProcessError(workdir, child, error)
      })

      child.on('exit', (code, signal) => {
        handleHistoryProcessExit(workdir, child, code, signal)
      })

      logger.info('History watcher started', { workdir, pid: child.pid })
    })()

    pendingHistoryStarts.set(workdir, startup)

    try {
      await startup
    } catch (error) {
      logger.error('Failed to start history watcher', {
        workdir,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      pendingHistoryStarts.delete(workdir)
    }
  }

  async function stopHistoryForWorkdir(workdir: string): Promise<void> {
    const service = historyServices.get(workdir)
    if (!service) {
      return
    }

    if (service.stopping) {
      await service.stopPromise
      return
    }

    service.stopping = true
    service.stopPromise = terminateProcessTree(service.process, {
      exited: () => service.process.exitCode !== null || service.process.signalCode !== null,
    })
      .catch((error) => {
        logger.error('Failed to stop history watcher', {
          workdir,
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        const current = historyServices.get(workdir)
        if (current?.process === service.process) {
          historyServices.delete(workdir)
        }

        logger.info('History watcher stopped', { workdir, pid: service.process.pid })
      })

    await service.stopPromise
  }

  function maybeStopHistoryForWorkdir(workdir: string): void {
    if (pinnedHistoryWorkdirs.has(workdir)) {
      return
    }

    const hasRemainingSessions = sessionManager.listSessions().some(session => session.workdir === workdir)
    if (hasRemainingSessions) {
      return
    }

    void stopHistoryForWorkdir(workdir)
  }

  function handleHistoryProcessError(workdir: string, proc: ChildProcess, error: unknown): void {
    const service = historyServices.get(workdir)
    if (service?.process === proc && !service.stopping) {
      historyServices.delete(workdir)
      logger.error('History watcher process failed', {
        workdir,
        pid: proc.pid,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function handleHistoryProcessExit(
    workdir: string,
    proc: ChildProcess,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    const service = historyServices.get(workdir)
    if (service?.process === proc && !service.stopping) {
      historyServices.delete(workdir)
      logger.warn('History watcher process exited', { workdir, pid: proc.pid, code, signal })
    }
  }

  const defaultWorkdir = process.cwd()

  pinnedHistoryWorkdirs.add(defaultWorkdir)

  const unsubscribeSessionEvents = sessionManager.subscribe((event) => {
    if (event.type === 'session_created') {
      sessionWorkdirs.set(event.session.id, event.session.workdir)
      void initHistoryForWorkdir(event.session.workdir)
      return
    }

    if (event.type === 'session_deleted') {
      const workdir = sessionWorkdirs.get(event.sessionId)
      sessionWorkdirs.delete(event.sessionId)

      if (workdir) {
        maybeStopHistoryForWorkdir(workdir)
      }
    }
  })

  if (!historyServices.has(defaultWorkdir)) {
    await initHistoryForWorkdir(defaultWorkdir)
  }

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

  app.delete('/api/projects/:projectId/sessions', (req, res) => {
    const projectId = req.params['projectId'] as string
    const project = sessionManager.getProject(projectId)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }
    sessionManager.deleteAllSessions(projectId, project.workdir)
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
      workdir: config.workdir,
      // Include provider info
      providers: providerManager.getProviders(),
      activeProviderId: providerManager.getActiveProviderId(),
    })
  })

  // Model refresh endpoint
  app.post('/api/model/refresh', async (_req, res) => {
    const llmClient = getLLMClient()
    const activeProvider = providerManager.getActiveProvider()
    
    // Only auto-detect if the provider has model: 'auto'
    // Otherwise, preserve the explicitly selected model
    if (activeProvider?.model === 'auto') {
      const baseUrl = activeProvider.url ?? config.llm.baseUrl
      const detected = await detectModel(baseUrl)
      if (detected) {
        llmClient.setModel(detected)
        return res.json({ model: detected, source: 'detected', llmStatus: getLlmStatus(), backend: llmClient.getBackend() })
      }
    }
    
    // Return current model without overwriting
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

  // Skills endpoints
  app.get('/api/skills', async (_req, res) => {
    const skills = await loadAllSkills(configDir)
    res.json({
      skills: skills.map(s => ({
        ...s.metadata,
        enabled: isSkillEnabled(s.metadata.id),
      })),
    })
  })

  app.post('/api/skills/:id/toggle', (req, res) => {
    const { id } = req.params
    const currentlyEnabled = isSkillEnabled(id as string)
    setSkillEnabled(id as string, !currentlyEnabled)
    res.json({ id, enabled: !currentlyEnabled })
  })

  app.get('/api/skills/:id', async (req, res) => {
    const { id } = req.params
    const skills = await loadAllSkills(configDir)
    const skill = findSkillById(id as string, skills)
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' })
    }
    res.json(skill)
  })

  app.post('/api/skills', async (req, res) => {
    const body = req.body as SkillDefinition
    if (!body.metadata?.id || !body.metadata?.name || !body.prompt) {
      return res.status(400).json({ error: 'Missing required fields: metadata.id, metadata.name, prompt' })
    }
    if (!/^[a-z0-9-]+$/.test(body.metadata.id)) {
      return res.status(400).json({ error: 'Skill ID must be lowercase alphanumeric with hyphens only' })
    }
    if (await skillExists(configDir, body.metadata.id)) {
      return res.status(409).json({ error: 'A skill with this ID already exists' })
    }
    await saveSkill(configDir, body)
    res.status(201).json(body)
  })

  app.put('/api/skills/:id', async (req, res) => {
    const { id } = req.params
    if (!await skillExists(configDir, id as string)) {
      return res.status(404).json({ error: 'Skill not found' })
    }
    const body = req.body as Partial<SkillDefinition>
    const skills = await loadAllSkills(configDir)
    const existing = findSkillById(id as string, skills)
    if (!existing) {
      return res.status(404).json({ error: 'Skill not found' })
    }
    const updated: SkillDefinition = {
      metadata: { ...existing.metadata, ...body.metadata, id: id as string },
      prompt: body.prompt ?? existing.prompt,
    }
    await saveSkill(configDir, updated)
    res.json(updated)
  })

  app.delete('/api/skills/:id', async (req, res) => {
    const { id } = req.params
    const deleted = await deleteSkill(configDir, id as string)
    if (!deleted) {
      return res.status(404).json({ error: 'Skill not found' })
    }
    res.json({ success: true })
  })

  // Commands endpoints
  app.get('/api/commands', async (_req, res) => {
    const commands = await loadAllCommands(configDir)
    res.json({
      commands: commands.map(c => c.metadata),
    })
  })

  app.get('/api/commands/:id', async (req, res) => {
    const { id } = req.params
    const commands = await loadAllCommands(configDir)
    const command = findCommandById(id as string, commands)
    if (!command) {
      return res.status(404).json({ error: 'Command not found' })
    }
    res.json(command)
  })

  app.post('/api/commands', async (req, res) => {
    const body = req.body as CommandDefinition
    if (!body.metadata?.id || !body.metadata?.name || !body.prompt) {
      return res.status(400).json({ error: 'Missing required fields: metadata.id, metadata.name, prompt' })
    }
    if (!/^[a-z0-9-]+$/.test(body.metadata.id)) {
      return res.status(400).json({ error: 'Command ID must be lowercase alphanumeric with hyphens only' })
    }
    if (await commandExists(configDir, body.metadata.id)) {
      return res.status(409).json({ error: 'A command with this ID already exists' })
    }
    await saveCommand(configDir, body)
    res.status(201).json(body)
  })

  app.put('/api/commands/:id', async (req, res) => {
    const { id } = req.params
    if (!await commandExists(configDir, id as string)) {
      return res.status(404).json({ error: 'Command not found' })
    }
    const body = req.body as Partial<CommandDefinition>
    const commands = await loadAllCommands(configDir)
    const existing = findCommandById(id as string, commands)
    if (!existing) {
      return res.status(404).json({ error: 'Command not found' })
    }
    const updated: CommandDefinition = {
      metadata: { ...existing.metadata, ...body.metadata, id: id as string },
      prompt: body.prompt ?? existing.prompt,
    }
    await saveCommand(configDir, updated)
    res.json(updated)
  })

  app.delete('/api/commands/:id', async (req, res) => {
    const { id } = req.params
    const deleted = await deleteCommand(configDir, id as string)
    if (!deleted) {
      return res.status(404).json({ error: 'Command not found' })
    }
    res.json({ success: true })
  })

  // Branch API endpoint
  const { getCurrentBranch } = await import('./branch.api.js')

  app.get('/api/branch', async (req, res) => {
    await getCurrentBranch(req, res)
  })

  // History API endpoints
  const { getHistory, getHistorySnapshot } = await import('./history/history.api.js')

  app.get('/api/history', async (req, res) => {
    await getHistory(req, res)
  })

  app.get('/api/history/:snapshotId', async (req, res) => {
    await getHistorySnapshot(req, res)
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
  const wss = createWebSocketServer(httpServer, config, getLLMClient, () => providerManager.getActiveProvider(), toolRegistry, sessionManager, providerManager)

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
      void (async () => {
        viteServer?.close()
        unsubscribeSessionEvents()

        await Promise.all([...historyServices.keys()].map(async (workdir) => stopHistoryForWorkdir(workdir)))

        // Note: Not closing database here - it's a singleton shared across servers.
        // Database should only be closed when the application exits.
        // Terminate all WebSocket connections to allow clean shutdown
        for (const client of wss.clients) {
          client.terminate()
        }
        wss.close()
        httpServer.close(() => resolve())
      })()
    }),
  }
}

function getHistoryProcessEntrypoint(): string {
  const currentFile = fileURLToPath(import.meta.url)
  const extension = currentFile.endsWith('.ts') ? 'ts' : 'js'
  
  // Detect if we're in dev mode (src/) or prod mode (dist/)
  const isDevMode = currentFile.includes('/src/')
  
  if (isDevMode) {
    // In dev mode, __dirname is src/server/, so resolve directly
    return resolve(__dirname, 'history', `process-entry.${extension}`)
  } else {
    // In prod mode, chunks are in dist/, so we need to go into dist/server/history/
    return resolve(__dirname, 'server', 'history', `process-entry.${extension}`)
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
