import express from 'express'
import cors from 'cors'
import { createServer as createHttpServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createServer as createViteServer, type ViteDevServer } from 'vite'

import type { Config, ModelConfig, ProviderBackend } from '../shared/types.js'
import type { ServerHandle } from './context.js'
import type { VisionBackend } from './llm/vision-fallback.js'
import { initDatabase } from './db/index.js'
import { initEventStore } from './events/index.js'
import { detectModel, getLlmStatus, getBackendDisplayName } from './llm/index.js'
import { buildModelsUrl } from './llm/url-utils.js'
import { createMockLLMClient } from './llm/mock.js'
import { createProviderManager, parseDefaultModelSelection } from './provider-manager.js'
import { createToolRegistry, setMcpTools } from './tools/index.js'
import { ALWAYS_ALLOWED, ALWAYS_ALLOWED_FOR_SUBAGENTS, TOP_LEVEL_ONLY_TOOLS } from './tools/tool-policy.js'
import { McpManager, createMcpTools } from './mcp/index.js'
import {
  setMcpManagerForTools,
  setMcpConfigMode,
  setMcpConfigPath,
  setNotifyMcpServersChanged,
} from './tools/mcp-config.js'
import { createServerMessage } from '../shared/protocol.js'
import { createContextStateMessage } from './ws/protocol.js'
import { createWebSocketServer } from './ws/index.js'
import { SessionManager } from './session/manager.js'
import { setRuntimeConfig } from './runtime-config.js'
import { createSkillRoutes } from './routes/skills.js'
import { createCommandRoutes } from './routes/commands.js'
import { createAgentRoutes } from './routes/agents.js'
import { loadAllAgentsDefault, getTopLevelAgents } from './agents/registry.js'
import { createWorkflowRoutes } from './routes/workflows.js'
import { createDevServerRoutes } from './routes/dev-server.js'
import { createWorkspaceConfigRoutes } from './routes/workspace-config.js'
import { createTerminalRoutes } from './routes/terminals.js'
import { createDirectoryRoutes } from './routes/directories.js'
import { createFileSearchRoutes } from './routes/file-search.js'
import { createAutoUpdateRoutes } from './routes/auto-update.js'
import { createProviderAuthRoutes } from './routes/provider-auth.js'
import { devServerManager } from './dev-server/manager.js'
import { getGlobalConfigDir } from '../cli/paths.js'
import { ProviderRegistry, loadProviderPlugins } from './providers/plugins/index.js'
import { createPluginRoutes } from './routes/plugins.js'
import { logger, setLogLevel } from './utils/logger.js'
import { VERSION } from '../constants.js'
import {
  loadServerAuthConfig,
  requiresAuth,
  hasPassword,
  getAuthConfig,
  verifyPassword,
  isValidToken,
  tokenFromPassword,
} from './auth.js'
import { detectWsl, type WslInfo } from './utils/wsl.js'
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

  // Load auth config
  await loadServerAuthConfig()

  // Initialize database
  const db = initDatabase(config)

  // Initialize event store
  initEventStore(db)

  // Get config directory for loading user items
  const configDir = getGlobalConfigDir(config.mode ?? 'production')

  // Discover provider plugins before creating transport-aware clients.
  const providerAdapters = new ProviderRegistry({
    mode: config.mode === 'development' ? 'development' : 'production',
    configDirectory: configDir,
  })
  const pluginDiagnostics = await loadProviderPlugins({ registry: providerAdapters, configDirectory: configDir })
  for (const diagnostic of pluginDiagnostics) {
    if (!diagnostic.loaded) logger.warn('Provider plugin failed to load', { ...diagnostic })
  }

  // Hydrate concise preset-backed provider entries after plugins are loaded.
  config.providers = providerAdapters.resolveProviders(config.providers ?? [])

  // Create Provider Manager (handles LLM client lifecycle)
  const providerManager = createProviderManager(config, { adapters: providerAdapters })

  // Create SessionManager instance (not singleton!)
  const sessionManager = new SessionManager(providerManager)

  // Wire sessionManager to devServerManager for inspect proxy feedback
  devServerManager.setSessionManager(sessionManager)

  // Create LLM client - use mock if OPENFOX_MOCK_LLM is set
  const useMock = process.env['OPENFOX_MOCK_LLM'] === 'true'
  // For mock mode, we bypass the provider manager
  const getMockClient = useMock ? createMockLLMClient : null
  const getLLMClient = () => (getMockClient ? getMockClient() : providerManager.getLLMClient())
  const getLLMClientForProvider = (providerId: string, model: string) =>
    getMockClient ? getMockClient() : providerManager.createClient(providerId, model)

  if (useMock) {
    logger.info('Using MOCK LLM client - deterministic responses for testing')
  }

  // Detect WSL platform eagerly (reads /proc and env vars, cached after first call)
  const platformInfo: WslInfo = detectWsl()

  // Auto-detect backend and model from LLM server
  async function initLLM(): Promise<void> {
    const llmClient = getLLMClient()
    const backend = config.llm.backend
    llmClient.setBackend(backend)
    if (!useMock) {
      logger.info('Using configured LLM backend', { backend: getBackendDisplayName(backend) })
    }

    const detected = await detectModel(config.llm.baseUrl)
    if (detected && !config.defaultModelSelection) {
      llmClient.setModel(detected)
      if (!useMock) {
        logger.info('Auto-detected LLM model', { model: detected, backend: getBackendDisplayName(backend) })
      }
    } else if (detected && config.defaultModelSelection) {
      if (!useMock) {
        logger.debug('Skipping auto-detect, using configured model', { model: config.llm.model })
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

  // Initialize MCP manager and connect to configured servers
  const mcpManager = new McpManager({
    onToolsDiscovered: async (name, tools) => {
      try {
        const { loadGlobalConfig, saveGlobalConfig } = await import('../cli/config.js')
        const mode = config.mode ?? 'production'
        const globalConfig = await loadGlobalConfig(mode, config.globalConfigPath)
        const mcpServers = {
          ...((globalConfig.mcpServers ?? {}) as Record<string, import('./mcp/types.js').McpServerConfig>),
        }
        if (mcpServers[name]) {
          mcpServers[name] = { ...mcpServers[name], cachedTools: tools }
          await saveGlobalConfig(mode, { ...globalConfig, mcpServers }, config.globalConfigPath)
        }
      } catch (err) {
        logger.warn('Failed to persist MCP tool cache', { name, error: String(err) })
      }
    },
  })
  setMcpManagerForTools(mcpManager)
  setMcpConfigMode(config.mode ?? 'production')
  setMcpConfigPath(config.globalConfigPath)
  const mcpServers = (config.mcpServers ?? {}) as Record<string, import('./mcp/types.js').McpServerConfig>
  Promise.all(
    Object.entries(mcpServers).map(([name, serverConfig]) =>
      mcpManager.addServer(name, serverConfig).catch((err) => {
        logger.warn('Failed to connect MCP server on startup', { name, error: String(err) })
      }),
    ),
  ).then(async () => {
    const mcpTools = createMcpTools(mcpManager)
    if (mcpTools.length > 0) {
      setMcpTools(mcpTools)
      logger.info('MCP tools registered', { count: mcpTools.length })
    }
    const { signalMcpReady } = await import('./ws/server.js')
    signalMcpReady()
  })

  const app = express()

  // Middleware: auth FIRST (checks headers only, no body needed),
  // then body parser (only after auth passes).
  // This prevents unauthenticated DoS via large payloads.
  app.use(cors())

  // Auth middleware for all /api routes (except /api/health and /api/auth/login)
  const authMiddleware = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const path = req.path
    const publicPaths = ['/health', '/auth', '/auth/login', '/auto-update/check']
    if (publicPaths.includes(path)) {
      return next()
    }
    const authConfig = getAuthConfig()
    if (authConfig?.strategy === 'network' && authConfig.encryptedPassword) {
      const token = req.headers['x-session-token'] as string
      if (!token || !(await isValidToken(token))) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
    }
    next()
  }

  app.use('/api', authMiddleware)
  app.use(express.json({ limit: '75mb' }))

  // Health check (public)
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // Auth status (public - tells frontend if auth is required)
  app.get('/api/auth', (_req, res) => {
    const authRequired = requiresAuth()
    const hasPwd = hasPassword()
    res.json({
      requiresAuth: authRequired && hasPwd,
      hasPassword: hasPwd,
    })
  })

  // Login endpoint - exchange password for session token
  app.post('/api/auth/login', async (req, res) => {
    const authConfig = getAuthConfig()
    if (authConfig?.strategy !== 'network' || !authConfig.encryptedPassword) {
      res.status(400).json({ error: 'Auth not configured' })
      return
    }
    const password = req.body.password
    if (!password || typeof password !== 'string') {
      res.status(401).json({ error: 'Password required' })
      return
    }
    if (!(await verifyPassword(password))) {
      res.status(401).json({ error: 'Invalid password' })
      return
    }
    const token = await tokenFromPassword(password)
    res.json({ token })
  })

  // Available tools with action metadata for granular permissions
  app.get('/api/tools', (_req, res) => {
    const tools = toolRegistry.tools.map((t) => ({
      name: t.name,
      actions: t.permittedActions || [],
      alwaysAllowed: ALWAYS_ALLOWED.has(t.name) || ALWAYS_ALLOWED_FOR_SUBAGENTS.has(t.name),
      topLevelOnly: TOP_LEVEL_ONLY_TOOLS.has(t.name),
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
    try {
      const project = await createDirectoryWithGit(name, workdir)
      res.status(201).json({ project })
    } catch (err) {
      const eaccError = err as Error & { code?: string; cause?: unknown }
      return res.status(403).json({
        error: eaccError.message || 'Unknown error',
        code: eaccError.code || 'UNKNOWN',
        path: workdir,
      })
    }
  })

  app.post('/api/projects/check-permissions', async (req, res) => {
    const { path: targetPath } = req.body
    if (!targetPath) {
      return res.status(400).json({ error: 'path is required' })
    }

    const { checkPermissions } = await import('./utils/permissions.js')
    const result = await checkPermissions(targetPath)

    if (result.success) {
      res.json(result)
    } else {
      const status = (result as { status?: number }).status ?? 500
      res.status(status).json({ error: result.error })
    }
  })

  app.post('/api/projects/fix-permissions', async (req, res) => {
    const { path: targetPath, action } = req.body
    if (!targetPath) {
      return res.status(400).json({ error: 'path is required' })
    }
    if (!['group', 'ownership', 'join_group', 'join_group_and_group'].includes(action)) {
      return res
        .status(400)
        .json({ error: 'action must be "group", "ownership", "join_group", or "join_group_and_group"' })
    }

    const { fixPermissions } = await import('./utils/permissions.js')
    const result = await fixPermissions(targetPath, action)

    if (result.success) {
      res.json(result)
    } else {
      const status = (result as { status?: number }).status ?? 500
      res.status(status).json(result)
    }
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
    const { name, customInstructions, dangerLevel } = req.body
    const updates: { name?: string; customInstructions?: string | null; dangerLevel?: 'normal' | 'dangerous' | null } =
      {}
    if (name !== undefined) updates.name = name
    if (customInstructions !== undefined) updates.customInstructions = customInstructions
    if (dangerLevel !== undefined) updates.dangerLevel = dangerLevel as 'normal' | 'dangerous' | null
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

  app.put('/api/projects/:id/star', async (req, res) => {
    const { toggleStar } = await import('./db/projects.js')
    const { isStarred } = req.body
    if (typeof isStarred !== 'boolean') {
      return res.status(400).json({ error: 'isStarred is required and must be a boolean' })
    }
    const project = toggleStar(req.params.id, isStarred)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }
    res.json({ project })
  })

  // Branch management endpoints (project-scoped, repo operations)

  /** List local git branches */
  app.get('/api/projects/:id/branches', async (req, res) => {
    const { getProject } = await import('./db/projects.js')
    const project = getProject(req.params.id)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const { listBranches } = await import('./git/workspace.js')
    const branches = await listBranches(project.workdir)
    res.json({ branches })
  })

  /** Switch to an existing branch */
  app.post('/api/projects/:id/checkout', async (req, res) => {
    const { getProject } = await import('./db/projects.js')
    const project = getProject(req.params.id)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const { branch } = req.body
    if (!branch || typeof branch !== 'string') return res.status(400).json({ error: 'branch is required' })
    const { checkoutBranch } = await import('./git/workspace.js')
    try {
      await checkoutBranch(project.workdir, branch)
      res.json({ branch })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to checkout branch' })
    }
  })

  /** Create and switch to a new branch */
  app.post('/api/projects/:id/checkout-new', async (req, res) => {
    const { getProject } = await import('./db/projects.js')
    const project = getProject(req.params.id)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const { name } = req.body
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' })
    const { createBranch } = await import('./git/workspace.js')
    try {
      await createBranch(project.workdir, name)
      res.json({ branch: name })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create branch' })
    }
  })

  // Session-scoped branch endpoints (operate on session's effective workdir)

  /** List local git branches for the session's effective workdir */
  app.get('/api/sessions/:id/branches', async (req, res) => {
    const session = sessionManager.getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    const effectiveWorkdir = session.workspace ?? session.workdir
    const { listBranches } = await import('./git/workspace.js')
    const branches = await listBranches(effectiveWorkdir)
    res.json({ branches })
  })

  /** Switch to an existing branch in the session's effective workdir */
  app.post('/api/sessions/:id/checkout', async (req, res) => {
    const session = sessionManager.getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    const { branch } = req.body
    if (!branch || typeof branch !== 'string') return res.status(400).json({ error: 'branch is required' })
    const effectiveWorkdir = session.workspace ?? session.workdir
    const { checkoutBranch, validateRef } = await import('./git/workspace.js')
    try {
      await validateRef(effectiveWorkdir, branch)
      await checkoutBranch(effectiveWorkdir, branch)
      res.json({ branch })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to checkout branch' })
    }
  })

  /** Create and switch to a new branch in the session's effective workdir */
  app.post('/api/sessions/:id/checkout-new', async (req, res) => {
    const session = sessionManager.getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    const { name } = req.body
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' })
    const effectiveWorkdir = session.workspace ?? session.workdir
    const { createBranch, validateRef } = await import('./git/workspace.js')
    try {
      await validateRef(effectiveWorkdir, name)
      await createBranch(effectiveWorkdir, name)
      res.json({ branch: name })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create branch' })
    }
  })

  /** List existing workspaces for a project (excluding the main repo) */
  app.get('/api/projects/:id/workspaces', async (req, res) => {
    const { getProject } = await import('./db/projects.js')
    const project = getProject(req.params.id)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const { listWorkspaces } = await import('./git/workspace.js')
    const all = await listWorkspaces(project.name)
    // Filter out the main workspace (the repo itself) — only show linked workspaces
    const workspacesList = all.filter((ws) => ws.path !== project.workdir)
    res.json({ workspaces: workspacesList })
  })

  // Session endpoints (REST)

  app.get('/api/sessions', async (req, res) => {
    const { getRecentUserPromptsForSession } = await import('./events/index.js')
    const { getPendingConfirmationsBySession } = await import('./tools/path-security.js')

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

    // Collect pending confirmations for returned sessions
    const allPending = getPendingConfirmationsBySession()
    const pendingConfirmationsBySession: Record<
      string,
      Array<{
        callId: string
        tool: string
        paths: string[]
        workdir: string
        reason: 'outside_workdir' | 'sensitive_file' | 'both' | 'dangerous_command' | 'git_no_verify'
      }>
    > = {}
    for (const s of sessions) {
      const confs = allPending[s.id]
      if (confs) {
        pendingConfirmationsBySession[s.id] = confs
      }
    }

    res.json({ sessions: sessionsWithPrompts, hasMore, pendingConfirmationsBySession })
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
    wssExports.broadcastAll({
      type: 'session.created',
      sessionId: session.id,
      payload: {
        session: {
          id: session.id,
          projectId: session.projectId,
          title: session.metadata.title,
          workdir: session.workdir,
          workspace: session.workspace,
          mode: session.mode,
          phase: session.phase,
          isRunning: session.isRunning,
          providerId: session.providerId,
          providerModel: session.providerModel,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          criteriaCount: session.criteria.length,
          criteriaCompleted: session.criteria.filter((c) => c.status.type === 'passed').length,
          messageCount: session.messageCount ?? session.messages.length,
        },
      },
    })
    res.status(201).json({ session })
  })

  /** Switch to a workspace — target is "original" or a workspace name */
  app.post('/api/sessions/:id/switch-workspace', async (req, res) => {
    const session = sessionManager.getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Session not found' })

    const { target, branch } = req.body
    if (!target || typeof target !== 'string') return res.status(400).json({ error: 'target is required' })

    try {
      const updated = await sessionManager.switchWorkspace(req.params.id, target, branch)
      res.json({ session: updated })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to switch workspace' })
    }
  })

  /** Delete a workspace */
  app.post('/api/sessions/:id/delete-workspace', async (req, res) => {
    const session = sessionManager.getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Session not found' })

    const { target } = req.body
    if (!target || typeof target !== 'string') return res.status(400).json({ error: 'target is required' })

    try {
      const updated = await sessionManager.deleteWorkspace(req.params.id, target)
      res.json({ session: updated })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete workspace' })
    }
  })

  app.get('/api/sessions/:id', async (req, res) => {
    const { getEventStore } = await import('./events/index.js')
    const { buildMessagesFromStoredEvents, foldPendingConfirmations } = await import('./events/folding.js')
    const { getPendingQuestionsForSession } = await import('./tools/index.js')

    const session = sessionManager.getSession(req.params.id)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const eventStore = getEventStore()
    const events = eventStore.getEvents(req.params.id)
    const messages = buildMessagesFromStoredEvents(events)
    const contextState = sessionManager.getContextState(req.params.id)
    const queueState = sessionManager.getQueueState(req.params.id)
    const pendingQuestions = getPendingQuestionsForSession(req.params.id)
    const pendingConfirmations = foldPendingConfirmations(events)

    res.json({ session, messages, contextState, queueState, pendingQuestions, pendingConfirmations })
  })

  app.delete('/api/sessions/:id', async (req, res) => {
    const sessionId = req.params['id'] as string
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    // Cancel any active execution before deleting — mirrors /stop endpoint
    const { stopSessionExecution } = await import('./session/chat-handler.js')
    const { cancelQuestionsForSession, cancelPathConfirmationsForSession } = await import('./tools/index.js')

    sessionManager.clearMessageQueue(sessionId)
    stopSessionExecution(sessionId, sessionManager)
    abortSession(sessionId)
    cancelQuestionsForSession(sessionId, 'Session deleted')
    cancelPathConfirmationsForSession(sessionId, 'Session deleted')

    sessionManager.deleteSession(sessionId)
    wssExports.broadcastAll({
      type: 'session.deleted',
      sessionId,
      payload: { sessionId },
    })
    res.json({ success: true })
  })

  app.delete('/api/projects/:projectId/sessions', (req, res) => {
    const projectId = req.params['projectId'] as string
    const project = sessionManager.getProject(projectId)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }
    sessionManager.deleteAllSessions(projectId, project.workdir)
    wssExports.broadcastAll({
      type: 'session.deletedAll',
      sessionId: projectId,
      payload: {},
    })
    res.json({ success: true })
  })

  // Session provider configuration (session-scoped only, does NOT update global default)
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

    // Resolve model: use provided model, or first model from provider, or fallback
    const provider = providerManager.getProviders().find((p) => p.id === providerId)
    const resolvedModel = model ?? provider?.models?.[0]?.id ?? 'auto'

    // Set provider for session only — does NOT touch global defaultModelSelection
    sessionManager.setSessionProvider(sessionId, providerId, resolvedModel)

    // Get updated context state
    const contextState = sessionManager.getContextState(sessionId)

    // Get updated session with messages
    const eventStore = getEventStore()
    const events = eventStore.getEvents(sessionId)
    const messages = buildMessagesFromStoredEvents(events)
    const updatedSession = sessionManager.getSession(sessionId)

    res.json({ session: updatedSession, messages, contextState })
  })

  // Set global default model (persisted to config, used for new sessions)
  app.post('/api/default-model', async (req, res) => {
    const { providerId, model } = req.body
    if (!providerId || !model) {
      return res.status(400).json({ error: 'providerId and model are required' })
    }

    // Validate provider exists
    const provider = providerManager.getProviders().find((p) => p.id === providerId)
    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' })
    }

    // Set default via providerManager
    const result = await providerManager.setDefaultModelSelection(providerId, model)
    if (!result.success) {
      return res.status(500).json({ error: result.error ?? 'Failed to set default model' })
    }

    // Persist to global config
    const { loadGlobalConfig, saveGlobalConfig, setDefaultModelSelection } = await import('../cli/config.js')
    const globalConfig = await loadGlobalConfig(config.mode ?? 'production', config.globalConfigPath)
    const updatedConfig = setDefaultModelSelection(globalConfig, providerId, model)
    await saveGlobalConfig(config.mode ?? 'production', updatedConfig, config.globalConfigPath)

    // Update in-memory config
    config.defaultModelSelection = updatedConfig.defaultModelSelection

    res.json({ success: true, defaultModelSelection: config.defaultModelSelection })
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

    const entries = criteria.map((c: { id?: string; description: string; status?: string }, i: number) => ({
      id: c.id ?? String(i),
      description: c.description,
      status: c.status ?? 'pending',
    }))
    sessionManager.setMetadataEntries(sessionId, 'criteria', entries)
    res.json({ success: true })
  })

  // Session review findings (REST)
  app.put('/api/sessions/:id/review-findings', async (req, res) => {
    const sessionId = req.params.id
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { review_findings } = req.body
    if (!Array.isArray(review_findings)) {
      return res.status(400).json({ error: 'review_findings is required and must be an array' })
    }

    const entries = review_findings.map((c: { id?: string; description: string; status?: string }, i: number) => ({
      id: c.id ?? String(i),
      description: c.description,
      status: c.status ?? 'open',
    }))
    sessionManager.setMetadataEntries(sessionId, 'review_findings', entries)
    res.json({ success: true })
  })

  app.put('/api/sessions/:id/metadata/:key', async (req, res) => {
    const sessionId = req.params.id
    const key = req.params.key
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { entries } = req.body
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: 'entries is required and must be an array' })
    }

    for (let i = 0; i < entries.length; i++) {
      const c = entries[i]
      if (c === null || typeof c !== 'object' || Array.isArray(c)) {
        return res.status(400).json({ error: `entries[${i}] must be an object` })
      }
      if (c.description !== undefined && typeof c.description !== 'string') {
        return res.status(400).json({ error: `entries[${i}].description must be a string` })
      }
      if (c.status !== undefined && typeof c.status !== 'string') {
        return res.status(400).json({ error: `entries[${i}].status must be a string` })
      }
    }

    const mapped = entries.map(
      (c: { id?: string; description?: string; status?: string; [key: string]: unknown }, i: number) => ({
        ...c,
        id: c.id != null ? String(c.id) : String(i),
        description: c.description ?? '',
        status: c.status ?? 'open',
      }),
    )
    sessionManager.setMetadataEntries(sessionId, key, mapped)
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
    if (!mode) {
      return res.status(400).json({ error: 'mode is required' })
    }
    const allAgents = await loadAllAgentsDefault()
    const topLevelIds = getTopLevelAgents(allAgents).map((a) => a.metadata.id)
    if (!topLevelIds.includes(mode)) {
      return res.status(400).json({ error: `Invalid mode. Must be one of: ${topLevelIds.join(', ')}` })
    }

    sessionManager.setMode(sessionId, mode)

    const eventStore = getEventStore()
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

  // Rename session (REST)
  app.put('/api/sessions/:id/title', async (req, res) => {
    const sessionId = req.params.id
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { title } = req.body
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'title is required' })
    }

    sessionManager.renameSession(sessionId, title.slice(0, 100))
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
    const { getPendingQuestionsForSession } = await import('./tools/index.js')
    const eventStore = getEventStore()
    const events = eventStore.getEvents(sessionId)
    const messages = buildMessagesFromStoredEvents(events)
    const pendingConfirmations = foldPendingConfirmations(events)
    const pendingQuestions = getPendingQuestionsForSession(sessionId)
    const session = sessionManager.getSession(sessionId)
    if (session) {
      const stateMsg = createSessionStateMessage(session, messages, pendingConfirmations, pendingQuestions)
      wssExports.broadcastForSession(sessionId, { ...stateMsg, sessionId })
    }

    // Broadcast to all clients that the confirmation was resolved
    wssExports.broadcastAll({
      type: 'session.confirmation_resolved',
      sessionId,
      payload: { sessionId, callId },
    })

    res.json({ success: true })
  })

  // Ask user answer (REST)
  app.post('/api/sessions/:id/answer', async (req, res) => {
    const { callId, answer, skip } = req.body

    if (!callId) {
      return res.status(400).json({ error: 'callId is required' })
    }
    if (!skip && typeof answer !== 'string') {
      return res.status(400).json({ error: 'answer is required when not skipping' })
    }

    const { provideAnswer } = await import('./tools/index.js')
    const found = provideAnswer(callId, answer ?? '', skip ?? false)

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
    const hasContent = content?.trim()
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0
    if (!hasContent && !hasAttachments) {
      return res.status(400).json({ error: 'content or attachments is required' })
    }

    sessionManager.queueMessage(sessionId, 'asap', content, attachments, messageKind)

    res.json({ success: true, queueState: sessionManager.getQueueState(sessionId) })
  })

  // Warmup endpoint: prefills the LLM KV cache with system prompt + tools
  // so the first real message has a lower time-to-first-token.
  // Disabled by default — enable via Settings > Advanced > Speculative Cache Warming.
  app.post('/api/sessions/:id/warmup', async (req, res) => {
    const sessionId = req.params.id
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { getSetting, SETTINGS_KEYS } = await import('./db/settings.js')
    if (getSetting(SETTINGS_KEYS.CACHE_WARMING) !== 'true') {
      return res.json({ success: false, reason: 'disabled' })
    }

    if (session.messages.length > 0) {
      return res.json({ success: false, reason: 'not_empty' })
    }

    if (sessionManager.isWarmedUp(sessionId)) {
      return res.json({ success: false, reason: 'already_warmed' })
    }

    // Activate session provider if configured (same pattern as queue processor)
    if (session.providerId && session.providerModel) {
      const currentActiveProviderId = providerManager.getActiveProviderId()
      const currentModel = providerManager.getCurrentModel()

      if (currentActiveProviderId !== session.providerId || currentModel !== session.providerModel) {
        const result = await providerManager.activateProvider(session.providerId, { model: session.providerModel })
        if (!result.success) {
          logger.error('Failed to activate session provider for warmup', {
            sessionId,
            providerId: session.providerId,
            error: result.error,
          })
        }
      }
    }

    const llmClient = getLLMClient()
    const activeProvider = providerManager.getActiveProvider()
    const statsIdentity = {
      providerId: activeProvider?.id ?? `provider:${llmClient.getModel()}`,
      providerName: activeProvider?.name ?? 'Unknown Provider',
      backend: (activeProvider?.backend ?? llmClient.getBackend()) as import('../shared/types.js').ProviderBackend,
      model: llmClient.getModel(),
    }

    const { runAgentTurn, TurnMetrics } = await import('./chat/orchestrator.js')

    runAgentTurn(
      {
        sessionManager,
        sessionId,
        llmClient,
        statsIdentity,
        onMessage: () => {},
        warmup: true,
      },
      new TurnMetrics(),
      session.mode,
      () => {},
    )
      .then(() => {
        sessionManager.markWarmedUp(sessionId)
      })
      .catch((err) => {
        logger.debug('Warmup failed (expected)', { sessionId, error: err instanceof Error ? err.message : String(err) })
      })

    res.json({ success: true })
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

    // Drain queued messages BEFORE stopping execution, so the QueueProcessor
    // doesn't pick them up when running_changed fires from setRunning(false)
    const queuedMessages = sessionManager.getQueueState(sessionId)
    sessionManager.clearMessageQueue(sessionId)

    // Abort both plan mode (WS) and build mode (chat-handler) controllers + QueueProcessor
    stopSessionExecution(sessionId, sessionManager)
    abortSession(sessionId)

    cancelQuestionsForSession(sessionId, 'Session stopped by user')
    cancelPathConfirmationsForSession(sessionId, 'Session stopped by user')

    const eventStore = (await import('./events/index.js')).getEventStore()
    eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: false } })

    res.json({ success: true, queuedMessages })
  })

  // Truncate session messages at a given index
  app.post('/api/sessions/:id/truncate', async (req, res) => {
    const sessionId = req.params.id as string
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { messageIndex } = req.body
    if (typeof messageIndex !== 'number' || messageIndex < 0) {
      return res.status(400).json({ error: 'messageIndex must be a non-negative number' })
    }

    const { truncateSessionMessages } = await import('./events/index.js')
    truncateSessionMessages(sessionId, messageIndex)

    res.json({ success: true })
  })

  // Replay: truncate at the replayed message and re-queue it
  app.post('/api/sessions/:id/replay', async (req, res) => {
    const sessionId = req.params.id as string
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { messageId, content } = req.body
    if (typeof messageId !== 'string' || !messageId) {
      return res.status(400).json({ error: 'messageId is required' })
    }
    if (content !== undefined && (typeof content !== 'string' || !content.trim())) {
      return res.status(400).json({ error: 'content must be a non-empty string if provided' })
    }

    const { getEventStore } = await import('./events/index.js')
    const { buildMessagesFromStoredEvents } = await import('./events/folding.js')
    const eventStore = getEventStore()
    const events = eventStore.getEvents(sessionId)
    const messages = buildMessagesFromStoredEvents(events)

    const msgIndex = messages.findIndex((m) => m.id === messageId)
    if (msgIndex === -1) {
      return res.status(400).json({ error: 'Message not found' })
    }

    const msg = messages[msgIndex]!
    if (msg.role !== 'user' || msg.isSystemGenerated) {
      return res.status(400).json({ error: 'Can only replay user messages' })
    }

    const { truncateSessionMessages } = await import('./events/index.js')
    truncateSessionMessages(sessionId, msgIndex - 1)

    sessionManager.queueMessage(sessionId, 'asap', content ?? msg.content, msg.attachments, msg.messageKind)

    res.json({ success: true })
  })

  // Chat operations (REST)
  app.post('/api/sessions/:id/chat', async (req, res) => {
    const sessionId = req.params.id
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { content } = req.body
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
  // Batch endpoint: GET /api/settings?keys=key1,key2,key3
  app.get('/api/settings', async (req, res) => {
    const { getSetting, SETTINGS_DEFAULTS } = await import('./db/settings.js')
    const keysParam = req.query['keys'] as string
    if (!keysParam) {
      return res.status(400).json({ error: 'keys query parameter is required' })
    }
    const keys = keysParam.split(',').map((k) => k.trim())
    const result: Record<string, string> = {}
    for (const key of keys) {
      result[key] = getSetting(key) ?? SETTINGS_DEFAULTS[key] ?? ''
    }
    res.json(result)
  })

  app.get('/api/settings/:key', async (req, res) => {
    const { getSetting, SETTINGS_DEFAULTS } = await import('./db/settings.js')
    const key = req.params.key
    const value = getSetting(key) ?? SETTINGS_DEFAULTS[key] ?? null
    res.json({ key, value })
  })

  app.get('/api/settings/:key', async (req, res) => {
    const { getSetting, SETTINGS_DEFAULTS } = await import('./db/settings.js')
    const key = req.params.key
    const value = getSetting(key) ?? SETTINGS_DEFAULTS[key] ?? null
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

  // RTK availability check
  app.get('/api/tools/rtk-check', async (_req, res) => {
    const { spawn } = await import('node:child_process')
    try {
      const available = await new Promise<boolean>((resolve) => {
        const proc = spawn('rtk', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
        let out = ''
        proc.stdout?.on('data', (d: Buffer) => {
          out += d.toString()
        })
        proc.on('error', () => resolve(false))
        proc.on('close', (code) => resolve(code === 0 && out.startsWith('rtk ')))
      })
      res.json({ available })
    } catch {
      res.json({ available: false })
    }
  })

  // Shells available for the tools.shell setting (Windows only; empty elsewhere)
  app.get('/api/tools/shells', async (_req, res) => {
    const { listAvailableShells } = await import('./utils/platform.js')
    res.json({ shells: listAvailableShells() })
  })

  // Config endpoint
  app.get('/api/config', async (_req, res) => {
    const llmClient = getLLMClient()
    const activeProvider = providerManager.getActiveProvider()

    let visionFallback:
      | { enabled: boolean; url: string; model: string; timeout: number; backend: VisionBackend }
      | undefined
    let globalWorkdir: string | undefined
    try {
      const { loadGlobalConfig, getVisionFallback } = await import('../cli/config.js')
      const globalConfig = await loadGlobalConfig(config.mode ?? 'production', config.globalConfigPath)
      const fallback = getVisionFallback(globalConfig)
      if (fallback) {
        visionFallback = {
          enabled: fallback.enabled ?? false,
          url: fallback.url ?? 'http://localhost:11434',
          model: fallback.model ?? 'qwen3.5:0.8b',
          timeout: fallback.timeout ?? 120,
          backend: fallback.backend ?? 'ollama',
        }
      }
      globalWorkdir = globalConfig.workspace?.workdir
    } catch {
      // Global config not available, skip visionFallback
    }

    res.json({
      version: VERSION,
      model: llmClient.getModel(),
      maxContext: providerManager.getCurrentModelContext(),
      llmUrl: activeProvider?.url ?? config.llm.baseUrl,
      llmStatus: getLlmStatus(),
      backend: llmClient.getBackend(),
      workdir: globalWorkdir ?? config.workdir,
      providers: providerManager.getProviders(),
      activeProviderId: providerManager.getActiveProviderId(),
      defaultModelSelection: config.defaultModelSelection,
      visionFallback,
      platform: platformInfo,
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

  // Shared helper: convert raw model array to ModelConfig[] with all fields passed through
  type ModelConfigInput = Pick<ModelConfig, 'id'> & Partial<Omit<ModelConfig, 'id' | 'source'>>

  function buildModelConfigs(models: ModelConfigInput[]): ModelConfig[] {
    return models.map((m) => ({
      id: m.id,
      contextWindow: m.contextWindow ?? 200000,
      source: 'user' as const,
      ...(m.name !== undefined && { name: m.name }),
      ...(m.apiModelId !== undefined && { apiModelId: m.apiModelId }),
      ...(m.requestBody !== undefined && { requestBody: m.requestBody }),
      ...(m.reasoningEfforts !== undefined && { reasoningEfforts: m.reasoningEfforts }),
      ...(m.supportsVision !== undefined && { supportsVision: m.supportsVision }),
      ...(m.thinkingEnabled !== undefined && { thinkingEnabled: m.thinkingEnabled }),
      ...(m.thinkingLevel !== undefined && { thinkingLevel: m.thinkingLevel }),
      ...(m.nonThinkingEnabled !== undefined && { nonThinkingEnabled: m.nonThinkingEnabled }),
      ...(m.thinkingExtraKwargs !== undefined && { thinkingExtraKwargs: m.thinkingExtraKwargs }),
      ...(m.nonThinkingExtraKwargs !== undefined && { nonThinkingExtraKwargs: m.nonThinkingExtraKwargs }),
      ...(m.thinkingQueryParams !== undefined && { thinkingQueryParams: m.thinkingQueryParams }),
      ...(m.nonThinkingQueryParams !== undefined && { nonThinkingQueryParams: m.nonThinkingQueryParams }),
      ...(m.temperature !== undefined && { temperature: m.temperature }),
      ...(m.topP !== undefined && { topP: m.topP }),
      ...(m.topK !== undefined && { topK: m.topK }),
      ...(m.maxTokens !== undefined && { maxTokens: m.maxTokens }),
      ...(m.selected !== undefined && { selected: m.selected }),
    }))
  }

  // Onboarding: test LLM connection without adding provider
  app.post('/api/providers/test', async (req, res) => {
    const { url, backend: reqBackend } = req.body as { url: string; backend?: string }
    if (!url) {
      return res.status(400).json({ error: 'url is required' })
    }

    try {
      const model = await detectModel(url)
      res.json({
        success: true,
        url,
        backend: reqBackend || 'unknown',
        model,
      })
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      })
    }
  })

  // Test search engine connection
  app.post('/api/search/test', async (req, res) => {
    const { engine, tavilyApiKey, searxngUrl, searxngApiKey } = req.body as {
      engine?: string
      tavilyApiKey?: string
      searxngUrl?: string
      searxngApiKey?: string
    }

    try {
      if (engine === 'tavily') {
        const key = tavilyApiKey || process.env['TAVILY_API_KEY']
        if (!key) {
          return res.status(400).json({ success: false, error: 'Tavily API key is required' })
        }
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: key, query: 'test', max_results: 1 }),
          signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) {
          const body = await response.text().catch(() => '')
          return res.status(400).json({ success: false, error: `Tavily error (${response.status}): ${body}` })
        }
        return res.json({ success: true, message: 'Tavily connection OK' })
      }

      if (engine === 'searxng') {
        const url = searxngUrl || process.env['SEARXNG_URL']
        if (!url) {
          return res.status(400).json({ success: false, error: 'SearXNG URL is required' })
        }
        const searchUrl = new URL(`${url.replace(/\/+$/, '')}/search`)
        searchUrl.searchParams.set('format', 'json')
        searchUrl.searchParams.set('q', 'test')
        const apiKey = searxngApiKey || process.env['SEARXNG_API_KEY'] || undefined
        const headers: Record<string, string> = {}
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

        const response = await fetch(searchUrl.toString(), {
          headers,
          signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) {
          const body = await response.text().catch(() => '')
          return res.status(400).json({ success: false, error: `SearXNG error (${response.status}): ${body}` })
        }
        return res.json({ success: true, message: 'SearXNG connection OK' })
      }

      return res.status(400).json({ success: false, error: 'Invalid engine' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      if (error instanceof DOMException && error.name === 'AbortError') {
        return res.status(400).json({ success: false, error: 'Connection timed out' })
      }
      return res.status(400).json({ success: false, error: message })
    }
  })

  // Onboarding: fetch models by URL (before provider is saved)
  app.get('/api/providers/models', async (req, res) => {
    const url = req.query['url'] as string | undefined
    const apiKey = req.query['apiKey'] as string | undefined
    const backend = req.query['backend'] as string | undefined
    if (!url) return res.status(400).json({ error: 'url is required' })
    try {
      const { fetchModelsWithContext } = await import('./provider-manager.js')
      const { getModelProfile } = await import('./llm/profiles.js')
      const models = await fetchModelsWithContext(
        url,
        apiKey,
        backend as 'ollama' | 'vllm' | 'sglang' | 'llamacpp' | 'lmstudio' | 'unknown' | undefined,
      )
      if (models.length === 0) {
        return res.status(404).json({ error: `No models found at ${buildModelsUrl(url)}`, url })
      }
      res.json({
        models: models.map((m) => {
          const profile = getModelProfile(m.id)
          return {
            id: m.id,
            contextWindow: m.contextWindow,
            defaultTemperature: profile.temperature,
            defaultTopP: profile.topP,
            defaultTopK: profile.topK,
            defaultMaxTokens: profile.defaultMaxTokens,
          }
        }),
        url,
      })
    } catch (error) {
      res.status(400).json({
        error: `Failed to fetch models from ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        url,
      })
    }
  })

  // Auto-config: probe a provider's models to discover working thinking/non-thinking params and context windows
  app.post('/api/providers/auto-config', async (req, res) => {
    const { url, apiKey, backend, models } = req.body as {
      url: string
      apiKey?: string
      backend: string
      models: Array<{ id: string }>
    }
    if (!url) return res.status(400).json({ error: 'url is required' })
    if (!models?.length) return res.status(400).json({ error: 'models is required' })

    try {
      const { autoConfig } = await import('./providers/auto-config.js')
      const result = await autoConfig({
        url,
        ...(apiKey ? { apiKey } : {}),
        backend: backend || 'unknown',
        models,
      })
      res.json(result)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Auto-config failed' })
    }
  })

  // Test params: probe a model with the exact same param-building pipeline as the agentic loop
  app.post('/api/providers/test-params', async (req, res) => {
    const { url, providerId, transportAdapter, model, apiKey, backend, thinkingField, mode, modelConfig } =
      req.body as {
        url: string
        providerId?: string
        transportAdapter?: string
        model: string
        apiKey?: string
        backend?: string
        thinkingField?: string
        mode: 'thinking' | 'non-thinking'
        modelConfig?: {
          temperature?: number
          topP?: number
          topK?: number
          maxTokens?: number
          supportsVision?: boolean
          thinkingEnabled?: boolean
          thinkingLevel?: string
          nonThinkingEnabled?: boolean
          thinkingQueryParams?: string
          nonThinkingQueryParams?: string
        }
      }
    if (!url) return res.status(400).json({ error: 'url is required' })
    if (!model) return res.status(400).json({ error: 'model is required' })
    if (!mode) return res.status(400).json({ error: 'mode is required' })

    try {
      if (transportAdapter && providerId) {
        const provider = providerManager.getProviders().find((item) => item.id === providerId)
        if (!provider) return res.status(404).json({ error: 'Provider not found' })
        const client = providerManager.createClient(providerId, model)
        if (!client) return res.status(424).json({ error: `Missing provider transport plugin: ${transportAdapter}` })
        const response = await client.complete({
          messages: [{ role: 'user', content: 'say hi in one word' }],
          tools: [],
          ...(mode === 'thinking'
            ? { reasoningEffort: (modelConfig?.thinkingLevel ?? 'medium') as import('./llm/types.js').ReasoningEffort }
            : {}),
          ...(modelConfig?.maxTokens ? { maxTokens: modelConfig.maxTokens } : {}),
          signal: AbortSignal.timeout(30_000),
        })
        return res.json({ success: true, message: { content: response.content }, raw: response })
      }

      const { getModelProfile } = await import('./llm/profiles.js')
      const { getBackendCapabilities } = await import('./llm/backend.js')
      const { buildNonStreamingCreateParams } = await import('./llm/client-pure.js')
      const { OpenAIHttpClient } = await import('./llm/http-client.js')
      const { ensureVersionPrefix } = await import('./llm/url-utils.js')

      const profile = getModelProfile(model)
      const capabilities = getBackendCapabilities((backend || 'unknown') as import('./llm/backend.js').Backend)

      // Build modelSettings the same way getModelSettings does
      const modelSettings: Record<string, unknown> = {}
      if (modelConfig?.temperature !== undefined) modelSettings['temperature'] = modelConfig.temperature
      if (modelConfig?.topP !== undefined) modelSettings['topP'] = modelConfig.topP
      if (modelConfig?.topK !== undefined) modelSettings['topK'] = modelConfig.topK
      if (modelConfig?.maxTokens !== undefined) modelSettings['maxTokens'] = modelConfig.maxTokens
      if (modelConfig?.supportsVision !== undefined) modelSettings['supportsVision'] = modelConfig.supportsVision

      const rawQP = mode === 'thinking' ? modelConfig?.thinkingQueryParams : modelConfig?.nonThinkingQueryParams
      if (rawQP) {
        modelSettings['queryParams'] = JSON.parse(rawQP) as Record<string, unknown>
      } else {
        const modeEnabled = mode === 'thinking' ? modelConfig?.thinkingEnabled : modelConfig?.nonThinkingEnabled
        if (modeEnabled) {
          modelSettings['chatTemplateKwargs'] =
            mode === 'thinking' ? { enable_thinking: true } : { enable_thinking: false }
        }
      }

      // Resolve reasoningEffort the same way the client does
      let reasoningEffort: string | undefined
      if (mode === 'thinking' && modelConfig?.thinkingEnabled && modelConfig?.thinkingLevel) {
        reasoningEffort = modelConfig.thinkingLevel
      }

      const hasModelSettings = Object.keys(modelSettings).length > 0
      const { params } = await buildNonStreamingCreateParams({
        model,
        request: {
          messages: [{ role: 'user' as const, content: 'say hi in one word' }],
          tools: [],
          ...(hasModelSettings ? { modelSettings: modelSettings as never } : {}),
          ...(reasoningEffort ? { reasoningEffort: reasoningEffort as never } : {}),
        },
        profile,
        capabilities,
        ...(thinkingField ? { thinkingField } : {}),
      })

      const httpClient = new OpenAIHttpClient({
        baseURL: ensureVersionPrefix(url),
        apiKey: apiKey ?? 'not-needed',
      })

      const response = await httpClient.createChatCompletion(params, { signal: AbortSignal.timeout(15000) }, true)

      res.json({
        success: true,
        message: response.choices?.[0]?.message ?? {},
        raw: response.raw,
      })
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Test failed',
      })
    }
  })

  // Onboarding: create provider
  app.post('/api/providers', async (req, res) => {
    const {
      name,
      url,
      backend,
      apiKey,
      model,
      isLocal,
      thinkingField,
      models: modelConfigs,
      authAdapter,
      transportAdapter,
    } = req.body as {
      name: string
      url: string
      backend: string
      apiKey?: string
      model?: string
      isLocal?: boolean
      thinkingField?: string
      models?: Record<string, unknown>[]
      authAdapter?: string
      transportAdapter?: string
    }

    if (!name || !url || !backend) {
      return res.status(400).json({ error: 'name, url, and backend are required' })
    }

    try {
      const { loadGlobalConfig, saveGlobalConfig, addProvider, setDefaultModelSelection } =
        await import('../cli/config.js')
      const globalConfig = await loadGlobalConfig(config.mode ?? 'production', config.globalConfigPath)

      const providerBackend = backend as ProviderBackend

      const providerModels: ModelConfig[] = modelConfigs?.length
        ? buildModelConfigs(modelConfigs as ModelConfigInput[])
        : model
          ? [{ id: model, contextWindow: 200000, source: 'user' as const }]
          : []

      const configWithProvider = addProvider(globalConfig, {
        name,
        url,
        backend: providerBackend,
        apiKey,
        ...(isLocal !== undefined ? { isLocal } : {}),
        ...(thinkingField ? { thinkingField } : {}),
        ...(authAdapter ? { authAdapter } : {}),
        ...(transportAdapter ? { transportAdapter } : {}),
        models: providerModels,
        isActive: true,
      })

      const firstModelId = model ?? providerModels.find((m) => m.selected)?.id ?? providerModels[0]?.id ?? 'auto'
      // Only set default if no existing default
      const finalConfig = configWithProvider.defaultModelSelection
        ? configWithProvider
        : setDefaultModelSelection(
            configWithProvider,
            configWithProvider.providers[configWithProvider.providers.length - 1]!.id,
            firstModelId,
          )

      await saveGlobalConfig(config.mode ?? 'production', finalConfig, config.globalConfigPath)

      providerManager.setProviders(finalConfig.providers, finalConfig.defaultModelSelection ?? undefined)
      config.defaultModelSelection = finalConfig.defaultModelSelection

      const newProvider = finalConfig.providers[finalConfig.providers.length - 1]

      res.status(201).json({
        success: true,
        provider: newProvider,
      })
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create provider',
      })
    }
  })

  // Onboarding: save full config (workspace, vision fallback)
  app.post('/api/init/config', async (req, res) => {
    const { workdir, visionFallback } = req.body as {
      workdir?: string
      visionFallback?: { enabled: boolean; url: string; model: string; timeout: number; backend: VisionBackend }
    }

    try {
      const { loadGlobalConfig, saveGlobalConfig } = await import('../cli/config.js')
      const globalConfig = await loadGlobalConfig(config.mode ?? 'production', config.globalConfigPath)

      const updatedConfig = {
        ...globalConfig,
        workspace: workdir ? { workdir } : globalConfig.workspace,
        visionFallback: visionFallback ?? globalConfig.visionFallback,
      }

      await saveGlobalConfig(config.mode ?? 'production', updatedConfig, config.globalConfigPath)

      res.json({ success: true })
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save config',
      })
    }
  })

  app.use('/api/plugins', createPluginRoutes({ config, providerAdapters, pluginDiagnostics, logger }))
  app.get('/api/plugins', (_req, res) => res.json({ plugins: pluginDiagnostics }))
  app.get('/api/provider-presets', (_req, res) => res.json({ presets: providerAdapters.getPresets() }))
  app.get('/api/provider-adapters', (_req, res) =>
    res.json({
      authAdapters: providerAdapters.listAuthAdapters(),
      transportAdapters: providerAdapters.listTransportAdapters(),
    }),
  )
  app.use('/api/provider-auth', createProviderAuthRoutes(config, providerManager, providerAdapters))

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

  app.delete('/api/providers/:id', async (req, res) => {
    const { id } = req.params
    const { loadGlobalConfig, saveGlobalConfig, removeProvider } = await import('../cli/config.js')
    const globalConfig = await loadGlobalConfig(config.mode ?? 'production', config.globalConfigPath)
    const updatedConfig = removeProvider(globalConfig, id)
    await saveGlobalConfig(config.mode ?? 'production', updatedConfig, config.globalConfigPath)

    providerManager.setProviders(updatedConfig.providers, updatedConfig.defaultModelSelection ?? undefined)
    config.defaultModelSelection = updatedConfig.defaultModelSelection

    res.json({ success: true })
  })

  app.patch('/api/providers/:id', async (req, res) => {
    const { id } = req.params
    const { isLocal } = req.body as { isLocal?: boolean }
    try {
      const { loadGlobalConfig, saveGlobalConfig, updateProvider } = await import('../cli/config.js')
      const globalConfig = await loadGlobalConfig(config.mode ?? 'production', config.globalConfigPath)
      const provider = globalConfig.providers.find((p) => p.id === id)
      if (!provider) {
        return res.status(404).json({ error: 'Provider not found' })
      }
      const updates: Record<string, unknown> = {}
      if (isLocal !== undefined) updates['isLocal'] = isLocal
      const updatedConfig = updateProvider(globalConfig, id, updates)
      await saveGlobalConfig(config.mode ?? 'production', updatedConfig, config.globalConfigPath)
      providerManager.setProviders(updatedConfig.providers, updatedConfig.defaultModelSelection ?? undefined)
      config.defaultModelSelection = updatedConfig.defaultModelSelection
      res.json({ success: true, provider: updatedConfig.providers.find((p) => p.id === id) })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update provider' })
    }
  })

  // PUT endpoint for full provider update (including models and thinking config)
  app.put('/api/providers/:id', async (req, res) => {
    const { id } = req.params
    const {
      name,
      url,
      backend,
      apiKey,
      isLocal,
      thinkingField,
      models: modelConfigs,
      authAdapter,
      transportAdapter,
    } = req.body as {
      name?: string
      url?: string
      backend?: string
      apiKey?: string | null
      isLocal?: boolean
      thinkingField?: string | null
      models?: Record<string, unknown>[]
      authAdapter?: string | null
      transportAdapter?: string | null
    }
    try {
      const { loadGlobalConfig, saveGlobalConfig, updateProvider } = await import('../cli/config.js')
      const globalConfig = await loadGlobalConfig(config.mode ?? 'production', config.globalConfigPath)
      const provider = globalConfig.providers.find((p) => p.id === id)
      if (!provider) {
        return res.status(404).json({ error: 'Provider not found' })
      }
      const updates: Record<string, unknown> = {}
      if (name !== undefined) updates['name'] = name
      if (url !== undefined) updates['url'] = url
      if (backend !== undefined) updates['backend'] = backend
      if (apiKey !== undefined) updates['apiKey'] = apiKey || undefined
      if (isLocal !== undefined) updates['isLocal'] = isLocal
      if (thinkingField !== undefined) updates['thinkingField'] = thinkingField || undefined
      if (authAdapter !== undefined) updates['authAdapter'] = authAdapter || undefined
      if (transportAdapter !== undefined) updates['transportAdapter'] = transportAdapter || undefined
      if (modelConfigs !== undefined) {
        updates['models'] = buildModelConfigs(modelConfigs as ModelConfigInput[])
      }
      const updatedConfig = updateProvider(globalConfig, id, updates)
      await saveGlobalConfig(config.mode ?? 'production', updatedConfig, config.globalConfigPath)
      providerManager.setProviders(updatedConfig.providers, updatedConfig.defaultModelSelection ?? undefined)
      config.defaultModelSelection = updatedConfig.defaultModelSelection
      res.json({ success: true, provider: updatedConfig.providers.find((p) => p.id === id) })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update provider' })
    }
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
    const globalConfig = await loadGlobalConfig(config.mode ?? 'production', config.globalConfigPath)
    const updatedConfig = setDefaultModelSelection(globalConfig, id as string, llmClient.getModel())
    await saveGlobalConfig(config.mode ?? 'production', updatedConfig, config.globalConfigPath)

    res.json({
      success: true,
      activeProviderId: id,
      model: llmClient.getModel(),
      backend: llmClient.getBackend(),
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
      status: updatedProvider?.status ?? 'unknown',
    })
  })

  // MCP Server endpoints
  async function rebuildMcpTools(): Promise<void> {
    const { createMcpTools } = await import('./mcp/tool-adapter.js')
    const { setMcpTools } = await import('./tools/index.js')
    const mcpTools = createMcpTools(mcpManager)
    setMcpTools(mcpTools)
  }

  app.get('/api/mcp/servers', (_req, res) => {
    const servers = mcpManager.getAllServers()
    res.json({ servers })
  })

  app.post('/api/mcp/servers/test', async (req, res) => {
    const { name, transport, command, args, env, url, headers } = req.body as {
      name?: string
      transport?: string
      command?: string
      args?: string[]
      env?: Record<string, string>
      url?: string
      headers?: Record<string, string>
    }
    if (transport !== undefined && transport !== 'stdio' && transport !== 'http') {
      return res.status(400).json({ error: `Invalid transport '${transport}'. Must be 'stdio' or 'http'.` })
    }
    if (transport !== 'http' && !command) {
      return res.status(400).json({ error: 'command is required for stdio transport' })
    }
    if (transport === 'http' && !url) {
      return res.status(400).json({ error: 'url is required for http transport' })
    }
    try {
      const testManager = new McpManager()
      const resolvedTransport: 'stdio' | 'http' = transport === 'http' ? 'http' : 'stdio'
      const testConfig: import('./mcp/types.js').McpServerConfig = {
        transport: resolvedTransport,
        ...(command ? { command } : {}),
        ...(args && args.length > 0 ? { args } : {}),
        ...(env && Object.keys(env).length > 0 ? { env } : {}),
        ...(url ? { url } : {}),
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      }
      await testManager.addServer(name ?? 'test', testConfig)
      const server = testManager.getServer(name ?? 'test')
      await testManager.disconnectAll()
      if (server?.status === 'connected') {
        res.json({ success: true, tools: server.tools.map((t) => t.name) })
      } else {
        res.json({ success: false, error: server?.error ?? 'Connection failed' })
      }
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.post('/api/mcp/servers', async (req, res) => {
    const { name, transport, command, args, env, url, headers } = req.body as {
      name?: string
      transport?: string
      command?: string
      args?: string[]
      env?: Record<string, string>
      url?: string
      headers?: Record<string, string>
    }
    if (!name) {
      return res.status(400).json({ error: 'name is required' })
    }
    if (transport !== undefined && transport !== 'stdio' && transport !== 'http') {
      return res.status(400).json({ error: `Invalid transport '${transport}'. Must be 'stdio' or 'http'.` })
    }
    try {
      const resolvedTransport: 'stdio' | 'http' = transport === 'http' ? 'http' : 'stdio'
      const serverCfg: import('./mcp/types.js').McpServerConfig = {
        transport: resolvedTransport,
        ...(command ? { command } : {}),
        ...(args && args.length > 0 ? { args } : {}),
        ...(env && Object.keys(env).length > 0 ? { env } : {}),
        ...(url ? { url } : {}),
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      }
      await mcpManager.addServer(name, serverCfg)
      const server = mcpManager.getServer(name)

      // Persist to global config
      const { loadGlobalConfig, saveGlobalConfig } = await import('../cli/config.js')
      const globalConfig = await loadGlobalConfig(config.mode ?? 'production', config.globalConfigPath)
      const updatedMcpServers = { ...(globalConfig.mcpServers ?? {}), [name]: serverCfg }
      await saveGlobalConfig(
        config.mode ?? 'production',
        {
          ...globalConfig,
          mcpServers: updatedMcpServers as Record<string, import('./mcp/types.js').McpServerConfig>,
        },
        config.globalConfigPath,
      )

      await rebuildMcpTools()

      // Set dynamic context changed so user sees "Update system prompt" banner
      if (server) {
        const sessions = sessionManager.listSessions()
        for (const s of sessions) {
          sessionManager.setDynamicContextChanged(s.id, true)
        }
      }

      res.status(201).json({ server })
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.put('/api/mcp/servers/:name', async (req, res) => {
    const { name } = req.params
    const existing = mcpManager.getServer(name)
    if (!existing) {
      return res.status(404).json({ error: `MCP server '${name}' not found` })
    }

    const body = req.body as Record<string, unknown>
    const { transport: rawTransport, command, args, env, url, headers } = body

    if (rawTransport !== undefined && rawTransport !== 'stdio' && rawTransport !== 'http') {
      return res.status(400).json({ error: `Invalid transport '${String(rawTransport)}'. Must be 'stdio' or 'http'.` })
    }
    if (command !== undefined && typeof command !== 'string') {
      return res.status(400).json({ error: 'command must be a string' })
    }
    if (args !== undefined && (!Array.isArray(args) || args.some((a) => typeof a !== 'string'))) {
      return res.status(400).json({ error: 'args must be an array of strings' })
    }
    if (
      env !== undefined &&
      (typeof env !== 'object' ||
        env === null ||
        Array.isArray(env) ||
        Object.values(env as object).some((v) => typeof v !== 'string'))
    ) {
      return res.status(400).json({ error: 'env must be a string/string object' })
    }
    if (url !== undefined && typeof url !== 'string') {
      return res.status(400).json({ error: 'url must be a string' })
    }
    if (
      headers !== undefined &&
      (typeof headers !== 'object' ||
        headers === null ||
        Array.isArray(headers) ||
        Object.values(headers as object).some((v) => typeof v !== 'string'))
    ) {
      return res.status(400).json({ error: 'headers must be a string/string object' })
    }

    try {
      const { loadGlobalConfig, saveGlobalConfig } = await import('../cli/config.js')
      const { applyMcpServerUpdate } = await import('./mcp/update-server.js')

      const globalConfig = await loadGlobalConfig(config.mode ?? 'production', config.globalConfigPath)
      const mcpServers = { ...(globalConfig.mcpServers ?? {}) } as Record<
        string,
        import('./mcp/types.js').McpServerConfig
      >

      const patch = {
        ...(rawTransport !== undefined ? { transport: rawTransport as 'stdio' | 'http' } : {}),
        ...(command !== undefined ? { command: command as string } : {}),
        ...(args !== undefined ? { args: args as string[] } : {}),
        ...(env !== undefined ? { env: env as Record<string, string> } : {}),
        ...(url !== undefined ? { url: url as string } : {}),
        ...(headers !== undefined ? { headers: headers as Record<string, string> } : {}),
      }

      const { error: updateError } = await applyMcpServerUpdate({
        name,
        patch,
        existing,
        persistedCfg: mcpServers[name],
        mcpManager,
        save: async (cfg) => {
          mcpServers[name] = cfg
          await saveGlobalConfig(config.mode ?? 'production', { ...globalConfig, mcpServers }, config.globalConfigPath)
        },
      })

      if (updateError) {
        return res.status(400).json({ error: updateError })
      }

      await rebuildMcpTools()
      const sessions = sessionManager.listSessions()
      for (const s of sessions) {
        sessionManager.setDynamicContextChanged(s.id, true)
      }
      res.json({ server: mcpManager.getServer(name) })
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.delete('/api/mcp/servers/:name', async (req, res) => {
    const { name } = req.params
    const server = mcpManager.getServer(name)
    if (!server) {
      return res.status(404).json({ error: `MCP server '${name}' not found` })
    }
    mcpManager.removeServer(name)

    // Persist to global config
    const { loadGlobalConfig, saveGlobalConfig } = await import('../cli/config.js')
    const globalConfig = await loadGlobalConfig(config.mode ?? 'production', config.globalConfigPath)
    const updatedMcpServers = { ...(globalConfig.mcpServers ?? {}) }
    delete updatedMcpServers[name]
    await saveGlobalConfig(
      config.mode ?? 'production',
      {
        ...globalConfig,
        mcpServers: updatedMcpServers as Record<string, import('./mcp/types.js').McpServerConfig>,
      },
      config.globalConfigPath,
    )

    await rebuildMcpTools()

    // Set dynamic context changed
    const sessions = sessionManager.listSessions()
    for (const s of sessions) {
      sessionManager.setDynamicContextChanged(s.id, true)
    }

    res.json({ success: true })
  })

  app.put('/api/mcp/servers/:name/tools/:toolName', async (req, res) => {
    const { name, toolName } = req.params
    const { enabled } = req.body as { enabled?: boolean }
    if (enabled === undefined) {
      return res.status(400).json({ error: 'enabled is required' })
    }
    try {
      await mcpManager.setToolEnabled(name, toolName, enabled)

      // Persist disabledTools to global config
      const server = mcpManager.getServer(name)
      if (server) {
        const { loadGlobalConfig, saveGlobalConfig } = await import('../cli/config.js')
        const globalConfig = await loadGlobalConfig(config.mode ?? 'production', config.globalConfigPath)
        const mcpServers = { ...(globalConfig.mcpServers ?? {}) }
        const serverCfg = mcpServers[name]
        if (serverCfg) {
          const disabledTools = server.tools.filter((t) => !t.enabled).map((t) => t.name)
          const cfg = { ...serverCfg, ...(disabledTools.length > 0 ? { disabledTools } : { disabledTools: undefined }) }
          mcpServers[name] = cfg
          await saveGlobalConfig(
            config.mode ?? 'production',
            {
              ...globalConfig,
              mcpServers: mcpServers as Record<string, import('./mcp/types.js').McpServerConfig>,
            },
            config.globalConfigPath,
          )
        }
      }

      await rebuildMcpTools()

      // Set dynamic context changed
      const sessions = sessionManager.listSessions()
      for (const s of sessions) {
        sessionManager.setDynamicContextChanged(s.id, true)
      }

      res.json({ success: true })
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  // CRUD routes (extracted to routes/)
  const projectDir = config.workdir
  app.use('/api/skills', createSkillRoutes(configDir, projectDir))
  app.use('/api/commands', createCommandRoutes(configDir, projectDir))
  app.use('/api/agents', createAgentRoutes(configDir, projectDir))
  app.use('/api/workflows', createWorkflowRoutes(configDir, config, projectDir))
  app.use('/api/dev-server', createDevServerRoutes())
  app.use('/api/workspace', createWorkspaceConfigRoutes())
  app.use('/api/terminals', createTerminalRoutes())
  app.use(
    '/api/auto-update',
    createAutoUpdateRoutes({
      requireAuth: async (req) => {
        const authConfig = getAuthConfig()
        if (authConfig?.strategy !== 'network' || !authConfig?.encryptedPassword) {
          return true
        }
        const token = req.headers['x-session-token'] as string
        if (!token) return false
        return Boolean(await isValidToken(token))
      },
    }),
  )

  // Background process routes
  app.get('/api/sessions/:id/background-processes', async (req, res) => {
    const { getSessionProcesses } = await import('./tools/background-process/manager.js')
    const sessionId = req.params.id
    const processes = getSessionProcesses(sessionId)
    res.json({ processes })
  })

  app.post('/api/sessions/:id/background-process/:processId/stop', async (req, res) => {
    const { stopProcess } = await import('./tools/background-process/manager.js')
    const sessionId = req.params.id
    const processId = req.params.processId
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }
    try {
      await stopProcess(processId, sessionId)
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to stop process' })
    }
  })

  // Branch API endpoint
  const { getCurrentBranch } = await import('./branch.api.js')

  app.get('/api/branch', async (req, res) => {
    await getCurrentBranch(req, res)
  })

  app.use('/api/directories', createDirectoryRoutes())
  app.use('/api/files', createFileSearchRoutes())

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

    // Inspect tool: serve injection script with CORS so proxied dev servers can load it
    app.use('/__inspect__.js', (_req, res) => {
      res.set('Access-Control-Allow-Origin', '*')
      res.set('Content-Type', 'application/javascript')
      readFile(join(webDir, 'public', '__inspect__.js'))
        .then((content) => res.send(content))
        .catch(() => res.status(404).send('Not found'))
    })

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

    // PWA assets
    app.use('/manifest.webmanifest', express.static(join(distWebDir, 'manifest.webmanifest')))
    app.use('/registerSW.js', express.static(join(distWebDir, 'registerSW.js')))
    app.use('/sw.js', express.static(join(distWebDir, 'sw.js')))

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

    // Inspect tool: serve injection script with CORS so proxied dev servers can load it
    app.use('/__inspect__.js', (_req, res) => {
      res.set('Access-Control-Allow-Origin', '*')
      res.set('Content-Type', 'application/javascript')
      readFile(join(distWebDir, '__inspect__.js'))
        .then((content) => res.send(content))
        .catch(() => res.status(404).send('Not found'))
    })

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
        req.path.startsWith('/manifest.webmanifest') ||
        req.path.startsWith('/registerSW.js') ||
        req.path.startsWith('/sw.js') ||
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

  // Wire MCP config tool to broadcast changes to all connected UIs
  setNotifyMcpServersChanged((sessionId: string) => {
    wssExports.broadcastAll(createServerMessage('mcp.servers.changed', {}))
    const state = sessionManager.getContextState(sessionId)
    wssExports.broadcastForSession(sessionId, createContextStateMessage(state))
  })

  // Wire up QueueProcessor - listens for queue events and starts turns
  const { QueueProcessor } = await import('./queue/processor.js')
  const queueProcessor = new QueueProcessor({
    sessionManager,
    providerManager,
    getLLMClient,
    getLLMClientForProvider,
    getActiveProvider: () => providerManager.getActiveProvider(),
    broadcastForSession: wssExports.broadcastForSession,
  })
  queueProcessor.start()

  const abortSession = (sessionId: string) => {
    const wsAborted = wssExports.abortSession(sessionId)
    const qpAborted = queueProcessor.abortSession(sessionId)
    const aborted = wsAborted || qpAborted
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
          await mcpManager.disconnectAll()
          const { stopAllInspectProxies } = await import('./dev-server/inspect-proxy.js')
          stopAllInspectProxies()
          const { cleanupAllProcesses } = await import('./tools/background-process/store.js')
          cleanupAllProcesses()
          viteServer?.close()

          // Clean up isolated config file if one was created
          if (config.globalConfigPath) {
            const { unlink } = await import('node:fs/promises')
            unlink(config.globalConfigPath).catch(() => {})
          }

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
