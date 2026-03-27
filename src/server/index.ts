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
import { setRuntimeConfig, getRuntimeConfig } from './runtime-config.js'
import { ensureDefaultSkills, loadAllSkills, isSkillEnabled, setSkillEnabled, findSkillById, saveSkill, deleteSkill, skillExists, getDefaultSkillIds, getModifiedDefaultSkillIds, restoreDefaultSkill, restoreAllDefaultSkills } from './skills/registry.js'
import type { SkillDefinition } from './skills/types.js'
import { ensureDefaultCommands, loadAllCommands, findCommandById, saveCommand, deleteCommand, commandExists, getDefaultCommandIds, getModifiedDefaultCommandIds, restoreDefaultCommand, restoreAllDefaultCommands } from './commands/registry.js'
import type { CommandDefinition } from './commands/types.js'
import { ensureDefaultAgents, loadAllAgents, findAgentById, getSubAgents, getTopLevelAgents, saveAgent, deleteAgent, agentExists, getDefaultAgentIds, getModifiedDefaultAgentIds, restoreDefaultAgent, restoreAllDefaultAgents } from './agents/registry.js'
import type { AgentDefinition } from './agents/types.js'
import { ensureDefaultWorkflows, loadAllWorkflows, findWorkflowById, saveWorkflow, deleteWorkflow, workflowExists, getDefaultWorkflowIds, getModifiedDefaultWorkflowIds, restoreDefaultWorkflow, restoreAllDefaultWorkflows } from './workflows/registry.js'
import type { WorkflowDefinition } from './workflows/types.js'
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

  // Skills endpoints
  app.get('/api/skills', async (_req, res) => {
    const [skills, defaultIds, modifiedIds] = await Promise.all([
      loadAllSkills(configDir),
      getDefaultSkillIds(),
      getModifiedDefaultSkillIds(configDir),
    ])
    res.json({
      skills: skills.map(s => ({
        ...s.metadata,
        enabled: isSkillEnabled(s.metadata.id),
      })),
      defaultIds,
      modifiedIds,
    })
  })

  app.get('/api/skills/default-ids', async (_req, res) => {
    const ids = await getDefaultSkillIds()
    res.json({ ids })
  })

  app.post('/api/skills/restore-all-defaults', async (_req, res) => {
    const count = await restoreAllDefaultSkills(configDir)
    res.json({ success: true, count })
  })

  app.post('/api/skills/:id/restore-default', async (req, res) => {
    const { id } = req.params
    const restored = await restoreDefaultSkill(configDir, id as string)
    if (!restored) {
      return res.status(404).json({ error: 'No bundled default found for this skill' })
    }
    res.json({ success: true })
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
    const [commands, defaultIds, modifiedIds] = await Promise.all([
      loadAllCommands(configDir),
      getDefaultCommandIds(),
      getModifiedDefaultCommandIds(configDir),
    ])
    res.json({
      commands: commands.map(c => c.metadata),
      defaultIds,
      modifiedIds,
    })
  })

  app.get('/api/commands/default-ids', async (_req, res) => {
    const ids = await getDefaultCommandIds()
    res.json({ ids })
  })

  app.post('/api/commands/restore-all-defaults', async (_req, res) => {
    const count = await restoreAllDefaultCommands(configDir)
    res.json({ success: true, count })
  })

  app.post('/api/commands/:id/restore-default', async (req, res) => {
    const { id } = req.params
    const restored = await restoreDefaultCommand(configDir, id as string)
    if (!restored) {
      return res.status(404).json({ error: 'No bundled default found for this command' })
    }
    res.json({ success: true })
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

  // Agents endpoints
  app.get('/api/agents', async (_req, res) => {
    const [agents, defaultIds, modifiedIds] = await Promise.all([
      loadAllAgents(configDir),
      getDefaultAgentIds(),
      getModifiedDefaultAgentIds(configDir),
    ])
    res.json({
      agents: agents.map(a => a.metadata),
      defaultIds,
      modifiedIds,
    })
  })

  app.get('/api/agents/default-ids', async (_req, res) => {
    const ids = await getDefaultAgentIds()
    res.json({ ids })
  })

  app.post('/api/agents/restore-all-defaults', async (_req, res) => {
    const count = await restoreAllDefaultAgents(configDir)
    res.json({ success: true, count })
  })

  app.post('/api/agents/:id/restore-default', async (req, res) => {
    const { id } = req.params
    const restored = await restoreDefaultAgent(configDir, id as string)
    if (!restored) {
      return res.status(404).json({ error: 'No bundled default found for this agent' })
    }
    res.json({ success: true })
  })

  app.get('/api/agents/:id', async (req, res) => {
    const { id } = req.params
    const agents = await loadAllAgents(configDir)
    const agent = findAgentById(id as string, agents)
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    res.json(agent)
  })

  app.post('/api/agents', async (req, res) => {
    const body = req.body as AgentDefinition
    if (!body?.metadata?.id || !body?.prompt) {
      return res.status(400).json({ error: 'Missing required fields: metadata.id, prompt' })
    }
    if (await agentExists(configDir, body.metadata.id)) {
      return res.status(409).json({ error: 'An agent with this ID already exists' })
    }
    await saveAgent(configDir, body)
    res.status(201).json(body)
  })

  app.put('/api/agents/:id', async (req, res) => {
    const { id } = req.params
    if (!id) {
      return res.status(400).json({ error: 'Missing agent ID' })
    }
    const body = req.body as Partial<AgentDefinition>
    const agents = await loadAllAgents(configDir)
    const existing = findAgentById(id as string, agents)
    if (!existing) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    const updated: AgentDefinition = {
      metadata: { ...existing.metadata, ...body.metadata, id: id as string },
      prompt: body.prompt ?? existing.prompt,
    }
    await saveAgent(configDir, updated)
    res.json(updated)
  })

  app.delete('/api/agents/:id', async (req, res) => {
    const { id } = req.params
    const deleted = await deleteAgent(configDir, id as string)
    if (!deleted) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    res.json({ success: true })
  })

  // Workflows endpoints
  app.get('/api/workflows', async (_req, res) => {
    const [workflows, defaultIds, modifiedIds] = await Promise.all([
      loadAllWorkflows(configDir),
      getDefaultWorkflowIds(),
      getModifiedDefaultWorkflowIds(configDir),
    ])
    res.json({
      workflows: workflows.map(p => p.metadata),
      activeWorkflowId: config.activeWorkflowId ?? 'default',
      defaultIds,
      modifiedIds,
    })
  })

  app.get('/api/workflows/default-ids', async (_req, res) => {
    const ids = await getDefaultWorkflowIds()
    res.json({ ids })
  })

  app.post('/api/workflows/restore-all-defaults', async (_req, res) => {
    const count = await restoreAllDefaultWorkflows(configDir)
    res.json({ success: true, count })
  })

  app.post('/api/workflows/:id/restore-default', async (req, res) => {
    const { id } = req.params
    const restored = await restoreDefaultWorkflow(configDir, id as string)
    if (!restored) {
      return res.status(404).json({ error: 'No bundled default found for this workflow' })
    }
    res.json({ success: true })
  })

  app.get('/api/workflows/:id', async (req, res) => {
    const { id } = req.params
    const workflows = await loadAllWorkflows(configDir)
    const workflow = findWorkflowById(id as string, workflows)
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' })
    }
    res.json(workflow)
  })

  app.post('/api/workflows', async (req, res) => {
    const body = req.body as WorkflowDefinition
    if (!body?.metadata?.id || !body?.steps?.length) {
      return res.status(400).json({ error: 'Missing required fields: metadata.id, steps' })
    }
    if (await workflowExists(configDir, body.metadata.id)) {
      return res.status(409).json({ error: 'A workflow with this ID already exists' })
    }
    await saveWorkflow(configDir, body)
    res.status(201).json(body)
  })

  app.put('/api/workflows/:id', async (req, res) => {
    const { id } = req.params
    if (!await workflowExists(configDir, id as string)) {
      return res.status(404).json({ error: 'Workflow not found' })
    }
    const body = req.body as WorkflowDefinition
    // Ensure the ID matches the URL parameter
    const updated: WorkflowDefinition = {
      ...body,
      metadata: { ...body.metadata, id: id as string },
    }
    await saveWorkflow(configDir, updated)
    res.json(updated)
  })

  app.delete('/api/workflows/:id', async (req, res) => {
    const { id } = req.params
    if (id === 'default') {
      return res.status(400).json({ error: 'Cannot delete the default workflow' })
    }
    const deleted = await deleteWorkflow(configDir, id as string)
    if (!deleted) {
      return res.status(404).json({ error: 'Workflow not found' })
    }
    res.json({ success: true })
  })


  // Branch API endpoint
  const { getCurrentBranch } = await import('./branch.api.js')

  app.get('/api/branch', async (req, res) => {
    await getCurrentBranch(req, res)
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
