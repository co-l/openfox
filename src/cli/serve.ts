import { createServer } from '../server/index.js'
import { loadConfig } from '../server/config.js'
import { logger } from '../server/utils/logger.js'
import { displayStartupBanner } from '../server/utils/network.js'
import { loadGlobalConfig, getActiveProvider } from './config.js'
import { getDatabasePath, getGlobalConfigPath, ensureDataDirExists } from './paths.js'
import open from 'open'
import type { Mode } from './main.js'
import type { LlmBackend } from '../shared/types.js'

export interface ServeOptions {
  mode: Mode
  port?: number
  openBrowser?: boolean
}

export async function runServe(options: ServeOptions): Promise<void> {
  const { mode, port, openBrowser } = options
  
  // Ensure data directory exists before starting server
  await ensureDataDirExists(mode)
  
  const globalConfig = await loadGlobalConfig(mode)
  const activeProvider = getActiveProvider(globalConfig)
  const env = loadConfig()
  
  // Environment variables take precedence over global config file
  // This allows CLI overrides and e2e test configuration to work properly
  const envBackend = env.llm.backend
  const envModel = env.llm.model
  const envUrl = env.llm.baseUrl
  
  // Only use env values if they're not the defaults (meaning they were explicitly set)
  const isEnvBackendExplicit = envBackend !== 'auto'
  const isEnvModelExplicit = envModel !== 'qwen3.5-122b-int4-autoround' // default in config.ts
  const isEnvUrlExplicit = envUrl !== 'http://localhost:8000/v1' // default in config.ts
  
  // Get provider values with fallbacks
  const providerUrl = activeProvider?.url ?? envUrl
  const providerModel = activeProvider?.model ?? envModel
  const providerBackend = (activeProvider?.backend ?? envBackend) as LlmBackend | 'auto'
  
  const merged = {
    ...env,
    llm: { 
      ...env.llm, 
      baseUrl: isEnvUrlExplicit ? envUrl : providerUrl,
      model: isEnvModelExplicit ? envModel : providerModel,
      backend: isEnvBackendExplicit ? envBackend : providerBackend,
    },
    server: { 
      ...env.server, 
      port: port ?? (mode === 'development' ? 10469 : env.server.port),
      host: env.server.host ?? globalConfig.server.host ?? '127.0.0.1',
      openBrowser: openBrowser ?? globalConfig.server.openBrowser,
    },
    database: {
      // Use env OPENFOX_DB_PATH if explicitly set (e.g., ":memory:" for tests), otherwise use standard path
      path: env.database.path !== './openfox.db' ? env.database.path : getDatabasePath(mode),
    },
    logging: {
      level: globalConfig.logging?.level ?? 'info' as const,
    },
    mode,
    // Pass providers for the server to use
    providers: globalConfig.providers,
    activeProviderId: globalConfig.activeProviderId,
    activePipelineId: globalConfig.activePipelineId,
    // Workdir precedence: .env override → global config → process.cwd()
    // Normalize: remove trailing slash to prevent double slashes in paths
    workdir: (process.env['OPENFOX_WORKDIR'] ?? globalConfig.workspace?.workdir ?? process.cwd()).replace(/\/$/, ''),
  }
  
  await createServer(merged)
  
  // Display startup banner
  displayStartupBanner({
    host: merged.server.host,
    port: merged.server.port,
    databasePath: merged.database.path,
    configPath: getGlobalConfigPath(mode),
  })
  
  if (merged.server.openBrowser) {
    open(`http://${merged.server.host === '127.0.0.1' ? 'localhost' : merged.server.host}:${merged.server.port}`).catch(() => {
      logger.warn('Could not open browser automatically')
    })
  }
}
