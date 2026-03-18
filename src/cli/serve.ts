import { createServer } from '../server/index.js'
import { loadConfig } from '../server/config.js'
import { logger } from '../server/utils/logger.js'
import { mergeConfigs } from './config.js'
import { getDatabasePath, ensureDataDirExists } from './paths.js'
import open from 'open'
import type { Mode } from './main.js'

export interface ServeOptions {
  mode: Mode
  port?: number
  openBrowser?: boolean
}

export async function runServe(options: ServeOptions): Promise<void> {
  const { mode, port, openBrowser } = options
  
  // Ensure data directory exists before starting server
  await ensureDataDirExists(mode)
  
  const global = await import('./config.js').then(m => m.loadGlobalConfig(mode))
  const env = loadConfig()
  
  const merged = {
    ...env,
    llm: { 
      ...env.llm, 
      baseUrl: global.llm.url ?? env.llm.baseUrl,
      model: global.llm.model ?? env.llm.model,
      backend: (global.llm.backend as any) ?? env.llm.backend,
    },
    server: { 
      ...env.server, 
      port: port ?? env.server.port,  // Use same port for dev and prod (10369)
      host: '127.0.0.1',
      openBrowser: openBrowser ?? global.server.openBrowser,
    },
    database: {
      path: getDatabasePath(mode),
    },
    logging: {
      level: global.logging?.level ?? 'info' as const,
    },
    mode,
  }
  
  await createServer(merged)
  
  const displayHost = merged.server.host === '127.0.0.1' ? 'localhost' : merged.server.host
  const url = `http://${displayHost}:${merged.server.port}`
  
  logger.info(`OpenFox ${mode === 'development' ? '[DEV]' : 'v0.1.0'}`, {
    url,
    mode,
    database: merged.database.path,
  })
  
  if (merged.server.openBrowser) {
    open(url).catch(() => {
      logger.warn('Could not open browser automatically')
    })
  }
}
