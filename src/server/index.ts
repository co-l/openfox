import express from 'express'
import cors from 'cors'
import { createServer as createHttpServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createServer as createViteServer, type ViteDevServer } from 'vite'

import type { Config } from '../shared/types.js'
import type { ServerHandle } from './context.js'
import { initDatabase } from './db/index.js'
import { initEventStore } from './events/index.js'
import { detectModel, getLlmStatus, detectBackend, getBackendDisplayName, type Backend } from './llm/index.js'
import { createMockLLMClient } from './llm/mock.js'
import { createProviderManager, parseDefaultModelSelection } from './provider-manager.js'
import { createToolRegistry } from './tools/index.js'
import { createWebSocketServer } from './ws/index.js'
import { SessionManager } from './session/manager.js'
import { setRuntimeConfig } from './runtime-config.js'
import { ensureDefaultSkills } from './skills/registry.js'
import { ensureDefaultCommands } from './commands/registry.js'
import { ensureDefaultAgents } from './agents/registry.js'
import { ensureDefaultWorkflows } from './workflows/registry.js'
import { createSkillRoutes } from './routes/skills.js'
import { createCommandRoutes } from './routes/commands.js'
import { createAgentRoutes } from './routes/agents.js'
import { createWorkflowRoutes } from './routes/workflows.js'
import { createDevServerRoutes } from './routes/dev-server.js'
import { createTerminalRoutes } from './routes/terminals.js'
import { devServerManager } from './dev-server/manager.js'
import { getGlobalConfigDir } from '../cli/paths.js'
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
  await ensureDefaultAgents(configDir)
  await ensureDefaultWorkflows(configDir)

  // Create Provider Manager (handles LLM client lifecycle)
  const providerManager = createProviderManager(config)

  // Create SessionManager instance (not singleton!)
  const sessionManager = new SessionManager(providerManager)

  // Create LLM client - use mock if OPENFOX_MOCK_LLM is set
  const useMock = process.env['OPENFOX_MOCK_LLM'] === 'true'
  // For mock mode, we bypass the provider manager
  const getMockClient = useMock ? createMockLLMClient : null
  const getLLMClient = () => (getMockClient ? getMockClient() : providerManager.getLLMClient())

  if (useMock) {
    logger.info('Using MOCK LLM client - deterministic responses for testing')
  }

  // Auto-detect backend and model from LLM server
  async function initLLM(): Promise<void> {
    const llmClient = getLLMClient()
    let backend: Backend
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

    // Refetch models with context windows on startup
    const activeProvider = providerManager.getActiveProvider()
    if (activeProvider) {
      await providerManager.refreshProviderModels(activeProvider.id).catch((err) => {
        logger.debug('Startup model refetch failed', {
          providerId: activeProvider.id,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }
  }

  initLLM().catch((err) =>
    logger.error('LLM initialization failed', { error: err instanceof Error ? err.message : String(err) }),
  )

  const toolRegistry = createToolRegistry()

  const app = express()

  // Middleware
  app.use(cors())
  app.use(express.json())

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // Available tools with action metadata for granular permissions
  app.get('/api/tools', (_req, res) => {
    const tools = toolRegistry.tools.map((t) => ({
      name: t.name,
      actions: t.permittedActions || [],
    }))
    res.json({ tools })
  })

  // Project endpoints (REST)
  app.get('/api/projects', async (_req, res) => {
    const { listProjects } = await import('./db/projects.js')
    const projects = listProjects()
    res.json({ projects })
  })

  app.post('/api/projects', async (req, res) => {
    const { name, workdir } = req.body
    if (!name || !workdir) {
      return res.status(400).json({ error: 'name and workdir are required' })
    }
    const { createDirectoryWithGit } = await import('./utils/project-creator.js')
    const project = await createDirectoryWithGit(name, workdir)
    res.status(201).json({ project })
  })

  app.get('/api/projects/:id', async (req, res) => {
    const { getProject } = await import('./db/projects.js')
    const project = getProject(req.params.id)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }
    res.json({ project })
  })

  app.put('/api/projects/:id', async (req, res) => {
    const { updateProject } = await import('./db/projects.js')
    const { name, customInstructions } = req.body
    const updates: { name?: string; customInstructions?: string | null } = {}
    if (name !== undefined) updates.name = name
    if (customInstructions !== undefined) updates.customInstructions = customInstructions
    const updated = updateProject(req.params.id, updates)
    if (!updated) {
      return res.status(404).json({ error: 'Project not found' })
    }
    res.json({ project: updated })
  })

  app.delete('/api/projects/:id', async (req, res) => {
    const { getProject, deleteProject } = await import('./db/projects.js')
    const project = getProject(req.params.id)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }
    deleteProject(req.params.id)
    res.json({ success: true })
  })

  // Session endpoints (REST)

  app.get('/api/sessions', async (req, res) => {
    const { getRecentUserPromptsForSession } = await import('./events/index.js')

    const projectId = req.query['projectId'] as string | undefined
    const limit = Math.min(parseInt(req.query['limit'] as string) || 20, 100)
    const offset = parseInt(req.query['offset'] as string) || 0

    let sessions: ReturnType<typeof sessionManager.listSessions>
    let hasMore = false

    if (projectId) {
      const result = sessionManager.listSessionsByProject(projectId, limit, offset)
      sessions = result.sessions
      hasMore = result.hasMore
    } else {
      sessions = sessionManager.listSessions()
    }

    const sessionsWithPrompts = sessions.map((session) => ({
      ...session,
      recentUserPrompts: getRecentUserPromptsForSession(session.id, 10),
    }))

    res.json({ sessions: sessionsWithPrompts, hasMore })
  })

  app.post('/api/sessions', async (req, res) => {
    const { projectId, title } = req.body
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' })
    }

    const project = sessionManager.getProject(projectId)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    // Inherit provider/model from defaultModelSelection config
    const { providerId, model } = parseDefaultModelSelection(config.defaultModelSelection)

    // maxTokens is no longer passed - it comes from providerManager.getCurrentModelContext() at query time
    const session = sessionManager.createSession(projectId, title, providerId ?? null, model ?? null)
    res.status(201).json({ session })
  })

  app.get('/api/sessions/:id', async (req, res) => {
    const { getEventStore } = await import('./events/index.js')
    const { buildMessagesFromStoredEvents } = await import('./events/folding.js')

    const session = sessionManager.getSession(req.params.id)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const eventStore = getEventStore()
    const events = eventStore.getEvents(req.params.id)
    const messages = buildMessagesFromStoredEvents(events)
    const contextState = sessionManager.getContextState(req.params.id)
    const queueState = sessionManager.getQueueState(req.params.id)

    res.json({ session, messages, contextState, queueState })
  })

  app.delete('/api/sessions/:id', (req, res) => {
    const session = sessionManager.getSession(req.params['id'] as string)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }
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

  // Session provider configuration
  app.post('/api/sessions/:id/provider', async (req, res) => {
    const { getEventStore } = await import('./events/index.js')
    const { buildMessagesFromStoredEvents } = await import('./events/folding.js')

    const sessionId = req.params.id
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { providerId, model } = req.body
    if (!providerId) {
      return res.status(400).json({ error: 'providerId is required' })
    }

    // Set provider for session
    sessionManager.setSessionProvider(sessionId, providerId, model ?? 'auto')

    // Persist to global config as defaultModelSelection
    const { loadGlobalConfig, saveGlobalConfig, setDefaultModelSelection } = await import('../cli/config.js')
    const globalConfig = await loadGlobalConfig(config.mode ?? 'production')
    const updatedConfig = setDefaultModelSelection(globalConfig, providerId, model ?? 'auto')
    await saveGlobalConfig(config.mode ?? 'production', updatedConfig)
    
    // Update in-memory config so new sessions inherit the selection
    config.defaultModelSelection = updatedConfig.defaultModelSelection

    // Invalidate session LLM client cache (handled internally by setSessionProvider)

    // Get updated context state
    const contextState = sessionManager.getContextState(sessionId)

    // Get updated session with messages
    const eventStore = getEventStore()
    const events = eventStore.getEvents(sessionId)
    const messages = buildMessagesFromStoredEvents(events)
    const updatedSession = sessionManager.getSession(sessionId)

    res.json({ session: updatedSession, messages, contextState })
  })

  // Session criteria (REST)
  app.put('/api/sessions/:id/criteria', async (req, res) => {
    const sessionId = req.params.id
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { criteria } = req.body
    if (!Array.isArray(criteria)) {
      return res.status(400).json({ error: 'criteria is required and must be an array' })
    }

    sessionManager.setCriteria(sessionId, criteria)
    res.json({ success: true })
  })

  // Session mode (REST)
  app.put('/api/sessions/:id/mode', async (req, res) => {
    const { getEventStore } = await import('./events/index.js')
    const { buildMessagesFromStoredEvents } = await import('./events/folding.js')

    const sessionId = req.params.id
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { mode } = req.body
    if (!mode || !['planner', 'builder'].includes(mode)) {
      return res.status(400).json({ error: 'mode is required and must be "planner" or "builder"' })
    }

    sessionManager.setMode(sessionId, mode)

    const eventStore = getEventStore()
    eventStore.append(sessionId, { type: 'mode.changed', data: { mode, auto: false } })

    const events = eventStore.getEvents(sessionId)
    const messages = buildMessagesFromStoredEvents(events)
    const updatedSession = sessionManager.getSession(sessionId)

    res.json({ session: updatedSession, messages })
  })

  // Danger level (REST)
  app.put('/api/sessions/:id/danger-level', async (req, res) => {
    const sessionId = req.params.id
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { dangerLevel } = req.body
    if (!dangerLevel || !['normal', 'dangerous'].includes(dangerLevel)) {
      return res.status(400).json({ error: 'dangerLevel is required and must be "normal" or "dangerous"' })
    }

    sessionManager.setDangerLevel(sessionId, dangerLevel)
    const updatedSession = sessionManager.getSession(sessionId)

    res.json({ session: updatedSession })
  })

  // Path confirmation (REST)
  app.post('/api/sessions/:id/confirm-path', async (req, res) => {
    const sessionId = req.params.id
    const { callId, approved, alwaysAllow } = req.body

    if (!callId || approved === undefined) {
      return res.status(400).json({ error: 'callId and approved are required' })
    }

    const { providePathConfirmation } = await import('./tools/index.js')
    const result = providePathConfirmation(callId, approved, alwaysAllow)

    if (!result.found) {
      return res.status(404).json({ error: 'No pending path confirmation with that ID' })
    }

    // Broadcast updated session state so all clients see the confirmation removed
    const { getEventStore } = await import('./events/index.js')
    const { buildMessagesFromStoredEvents, foldPendingConfirmations } = await import('./events/folding.js')
    const { createSessionStateMessage } = await import('./ws/protocol.js')
    const eventStore = getEventStore()
    const events = eventStore.getEvents(sessionId)
    const messages = buildMessagesFromStoredEvents(events)
    const pendingConfirmations = foldPendingConfirmations(events)
    const session = sessionManager.getSession(sessionId)
    if (session) {
      const stateMsg = createSessionStateMessage(session, messages, pendingConfirmations)
      wssExports.broadcastForSession(sessionId, { ...stateMsg, sessionId })
    }

    res.json({ success: true })
  })

  // Ask user answer (REST)
  app.post('/api/sessions/:id/answer', async (req, res) => {
    const sessionId = req.params.id
    const { callId, answer } = req.body

    if (!callId || !answer) {
      return res.status(400).json({ error: 'callId and answer are required' })
    }

    const { provideAnswer } = await import('./tools/index.js')
    const found = provideAnswer(callId, answer)

    if (!found) {
      return res.status(404).json({ error: 'No pending question with that ID' })
    }

    res.json({ success: true })
  })

  // Unified message endpoint - queues message, QueueProcessor handles processing
  app.post('/api/sessions/:id/message', (req, res) => {
    const sessionId = req.params.id
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { content, attachments, messageKind } = req.body
    if (!content?.trim()) {
      return res.status(400).json({ error: 'content is required' })
    }

    sessionManager.queueMessage(sessionId, 'asap', content, attachments, messageKind)

    res.json({ success: true, queueState: sessionManager.getQueueState(sessionId) })
  })

  // Delete queued message (cancel)
  app.delete('/api/sessions/:id/queue/:queueId', (req, res) => {
    const sessionId = req.params.id
    const { queueId } = req.params
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    sessionManager.cancelQueuedMessage(sessionId, queueId)
    res.json({ success: true, queueState: sessionManager.getQueueState(sessionId) })
  })

  // Chat stop (REST)
  app.post('/api/sessions/:id/stop', async (req, res) => {
    const sessionId = req.params.id
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { stopSessionExecution } = await import('./session/chat-handler.js')
    const { cancelQuestionsForSession, cancelPathConfirmationsForSession } = await import('./tools/index.js')

    // Abort both plan mode (WS) and build mode (chat-handler) controllers + QueueProcessor
    stopSessionExecution(sessionId, sessionManager)
    abortSession(sessionId)

    cancelQuestionsForSession(sessionId, 'Session stopped by user')
    cancelPathConfirmationsForSession(sessionId, 'Session stopped by user')
    sessionManager.clearMessageQueue(sessionId)

    const eventStore = (await import('./events/index.js')).getEventStore()
    eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: false } })

    res.json({ success: true })
  })

  // Chat operations (REST)
  app.post('/api/sessions/:id/chat', async (req, res) => {
    const sessionId = req.params.id
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { content, attachments, messageKind, isSystemGenerated } = req.body
    if (!content) {
      return res.status(400).json({ error: 'content is required' })
    }

    if (session.isRunning) {
      return res.status(409).json({ error: 'Session is already running' })
    }

    res.json({ accepted: true, sessionId })
  })

  app.post('/api/sessions/:id/continue', async (req, res) => {
    const sessionId = req.params.id
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    if (session.isRunning) {
      return res.status(409).json({ error: 'Session is already running' })
    }

    res.json({ accepted: true })
  })

  // Settings endpoints (REST)
  app.get('/api/settings/:key', async (req, res) => {
    const { getSetting } = await import('./db/settings.js')
    const key = req.params.key
    const value = getSetting(key)
    res.json({ key, value })
  })

  app.put('/api/settings/:key', async (req, res) => {
    const { setSetting } = await import('./db/settings.js')
    const key = req.params.key
    const { value } = req.body
    if (value === undefined) {
      return res.status(400).json({ error: 'value is required' })
    }
    setSetting(key, value)
    res.json({ key, value })
  })

  // Config endpoint
  app.get('/api/config', (_req, res) => {
    const llmClient = getLLMClient()
    const activeProvider = providerManager.getActiveProvider()
    res.json({
      model: llmClient.getModel(),
      maxContext: providerManager.getCurrentModelContext(),
      llmUrl: activeProvider?.url ?? config.llm.baseUrl,
      llmStatus: getLlmStatus(),
      backend: llmClient.getBackend(),
      workdir: config.workdir,
      // Include provider info
      providers: providerManager.getProviders(),
      activeProviderId: providerManager.getActiveProviderId(),
      defaultModelSelection: config.defaultModelSelection,
    })
  })

  // Model refresh endpoint
  app.post('/api/model/refresh', async (_req, res) => {
    const llmClient = getLLMClient()
    const currentModel = providerManager.getCurrentModel()

    // Only auto-detect if the current model is 'auto'
    // Otherwise, preserve the explicitly selected model
    if (currentModel === 'auto') {
      const activeProvider = providerManager.getActiveProvider()
      const baseUrl = activeProvider?.url ?? config.llm.baseUrl
      const detected = await detectModel(baseUrl)
      if (detected) {
        llmClient.setModel(detected)
        return res.json({
          model: detected,
          source: 'detected',
          llmStatus: getLlmStatus(),
          backend: llmClient.getBackend(),
        })
      }
    }

    // Return current model without overwriting
    res.json({
      model: llmClient.getModel(),
      source: 'cached',
      llmStatus: getLlmStatus(),
      backend: llmClient.getBackend(),
    })
  })

  // Provider endpoints
  app.get('/api/providers', (_req, res) => {
    const providers = providerManager.getProviders().map((p) => ({
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

    // Persist the model selection to config
    const llmClient = getLLMClient()
    const { loadGlobalConfig, saveGlobalConfig, setDefaultModelSelection } = await import('../cli/config.js')
    const globalConfig = await loadGlobalConfig(config.mode ?? 'production')
    const updatedConfig = setDefaultModelSelection(globalConfig, id as string, llmClient.getModel())
    await saveGlobalConfig(config.mode ?? 'production', updatedConfig)

    res.json({
      success: true,
      activeProviderId: id,
      model: llmClient.getModel(),
      backend: llmClient.getBackend(),
    })
  })

  app.post('/api/providers/:id/models/:modelId', async (req, res) => {
    const { id, modelId } = req.params
    const body = req.body as { contextWindow?: number }

    if (!body.contextWindow) {
      return res.status(400).json({ error: 'contextWindow is required' })
    }

    const result = await providerManager.updateModelContext(id as string, modelId as string, body.contextWindow)
    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    // Persist to config.json
    const { loadGlobalConfig, saveGlobalConfig } = await import('../cli/config.js')
    const globalConfig = await loadGlobalConfig(config.mode ?? 'production')
    const updatedProviders = providerManager.getProviders()
    const updatedConfig = {
      ...globalConfig,
      providers: updatedProviders,
      activeProviderId: providerManager.getActiveProviderId(),
      defaultModelSelection: providerManager.getActiveProviderId()
        ? `${providerManager.getActiveProviderId()}/${providerManager.getCurrentModel()}`
        : undefined,
    }
    await saveGlobalConfig(config.mode ?? 'production', updatedConfig)

    // Return updated context state for sessions using this provider/model
    // This allows the frontend to update the session header immediately via REST
    let contextState = null
    const sessions = sessionManager.listSessions()
    if (sessions.length > 0) {
      // Check if any session is using this provider
      // Session uses this provider if: explicit providerId matches, OR uses global and global matches
      for (const session of sessions) {
        const sessionProviderId = session.providerId || providerManager.getActiveProviderId()
        if (sessionProviderId === id) {
          contextState = sessionManager.getContextState(session.id)
          break
        }
      }
    }

    res.json({ 
      success: true, 
      providerId: id, 
      modelId, 
      contextWindow: body.contextWindow,
      contextState,
    })
  })

  app.post('/api/providers/:id/refresh', async (req, res) => {
    const { id } = req.params
    const result = await providerManager.refreshProviderModels(id as string)
    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    const updatedProvider = providerManager.getProviders().find((p) => p.id === id)
    res.json({
      success: true,
      providerId: id,
      models: updatedProvider?.models ?? [],
    })
  })

  // CRUD routes (extracted to routes/)
  app.use('/api/skills', createSkillRoutes(configDir))
  app.use('/api/commands', createCommandRoutes(configDir))
  app.use('/api/agents', createAgentRoutes(configDir))
  app.use('/api/workflows', createWorkflowRoutes(configDir, config))
  app.use('/api/dev-server', createDevServerRoutes())
  app.use('/api/terminals', createTerminalRoutes())

  // Branch API endpoint
  const { getCurrentBranch } = await import('./branch.api.js')

  app.get('/api/branch', async (req, res) => {
    await getCurrentBranch(req, res)
  })

  // Directory browser endpoint
  const DEFAULT_BASE_PATH = process.cwd()

  app.get('/api/directories', async (req, res) => {
    const path = (req.query['path'] as string) || DEFAULT_BASE_PATH

    try {
      const resolvedPath = resolve(path)

      const entries = await import('node:fs/promises').then((m) => m.readdir(resolvedPath, { withFileTypes: true }))
      const directories = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => ({
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
    app.get('/src/styles/*path', async (req, res) => {
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
      readFile(join(webDir, 'fox.svg'))
        .then((content) => {
          res.set('Content-Type', 'image/svg+xml')
          res.send(content)
        })
        .catch(() => {
          res.status(404).send('Not found')
        })
    })

    app.use(
      '/sounds',
      express.static(join(webDir, 'public', 'sounds'), {
        setHeaders: (res) => {
          res.set('Content-Type', 'audio/mpeg')
        },
      }),
    )

    // SPA fallback for non-API routes (must be last)
    app.get('/*path', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return
      }
      readFile(join(webDir, 'index.html'), 'utf-8')
        .then((indexHtml) => viteServer!.transformIndexHtml(req.originalUrl, indexHtml))
        .then((transformed) => res.send(transformed))
        .catch((err) => {
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
    app.use(
      '/assets',
      express.static(join(distWebDir, 'assets'), {
        setHeaders: (res, filepath) => {
          if (filepath.endsWith('.css')) {
            res.set('Content-Type', 'text/css')
          }
        },
      }),
    )

    // Static files
    app.get('/fox.svg', (_req, res) => {
      readFile(join(distWebDir, 'fox.svg'))
        .then((content) => {
          res.set('Content-Type', 'image/svg+xml')
          res.send(content)
        })
        .catch(() => {
          res.status(404).send('Not found')
        })
    })

    app.use(
      '/sounds',
      express.static(join(distWebDir, 'sounds'), {
        setHeaders: (res) => {
          res.set('Content-Type', 'audio/mpeg')
        },
      }),
    )

    // Root serves index.html
    app.get('/', (_req, res) => {
      readFile(join(distWebDir, 'index.html'), 'utf-8')
        .then((content) => res.send(content))
        .catch(() => {
          res.status(404).send('Web UI not built. Run `npm run build:web`')
        })
    })

    // SPA fallback - serve index.html for any unmatched path
    app.get('/*path', (req, res) => {
      if (
        req.path.startsWith('/api/') ||
        req.path.startsWith('/assets/') ||
        req.path.startsWith('/sounds/') ||
        req.path === '/fox.svg'
      ) {
        return
      }
      readFile(join(distWebDir, 'index.html'), 'utf-8')
        .then((content) => res.send(content))
        .catch(() => {
          res.status(404).send('Web UI not built')
        })
    })
  }

  // Create HTTP server from Express app
  const httpServer = createHttpServer(app)

  // Create WebSocket server attached to HTTP server
  const wssExports = createWebSocketServer(
    httpServer,
    config,
    getLLMClient,
    () => providerManager.getActiveProvider(),
    sessionManager,
    providerManager,
  )
  const wss = wssExports.wss

  // Wire up QueueProcessor - listens for queue events and starts turns
  const { QueueProcessor } = await import('./queue/processor.js')
  const queueProcessor = new QueueProcessor({
    sessionManager,
    providerManager,
    getLLMClient,
    getActiveProvider: () => providerManager.getActiveProvider(),
    broadcastForSession: wssExports.broadcastForSession,
  })
  queueProcessor.start()

  const abortSession = (sessionId: string) => {
    const aborted = wssExports.abortSession(sessionId) || queueProcessor.abortSession(sessionId)
    if (aborted) {
      sessionManager.setRunning(sessionId, false)
      wssExports.broadcastForSession(sessionId, { type: 'session.running', payload: { isRunning: false } })
    }
    return aborted
  }

  // Note: /stop endpoint uses abortSession below

  // Return the handle with start/close methods
  return {
    httpServer,
    ctx: { config, sessionManager, llmClient: getLLMClient(), toolRegistry, providerManager },

    start: (port?: number) =>
      new Promise((resolve, reject) => {
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

    close: () =>
      new Promise<void>((resolve) => {
        logger.info('Shutting down...')
        void (async () => {
          await devServerManager.stopAll()
          viteServer?.close()

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
