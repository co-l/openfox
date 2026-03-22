import { readFile, writeFile, existsSync, mkdir } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const readFileAsync = promisify(readFile)
const writeFileAsync = promisify(writeFile)
const mkdirAsync = promisify(mkdir)

// ============================================================================
// Types
// ============================================================================

export interface HistoryConfig {
  retentionDays: number
  maxSizeMB: number
  excludePatterns: string[]
}

const DEFAULT_CONFIG: HistoryConfig = {
  retentionDays: 30,
  maxSizeMB: 100,
  excludePatterns: ['.openfox/**'],
}

// ============================================================================
// Config Operations
// ============================================================================

/**
 * Get the config file path for a workdir
 */
export function getConfigPath(workdir: string): string {
  return join(workdir, '.openfox', 'config.json')
}

/**
 * Load or create config file
 */
export async function loadConfig(workdir: string): Promise<HistoryConfig> {
  const configPath = getConfigPath(workdir)
  
  if (!existsSync(configPath)) {
    // Create default config
    await saveConfig(workdir, DEFAULT_CONFIG)
    return DEFAULT_CONFIG
  }
  
  try {
    const content = await readFileAsync(configPath, 'utf-8')
    const config = JSON.parse(content) as HistoryConfig
    
    // Validate and merge with defaults
    return {
      ...DEFAULT_CONFIG,
      ...config,
    }
  } catch (error) {
    console.error('Error loading history config:', error)
    return DEFAULT_CONFIG
  }
}

/**
 * Save config file
 */
export async function saveConfig(workdir: string, config: HistoryConfig): Promise<void> {
  const configPath = getConfigPath(workdir)
  const openfoxDir = join(workdir, '.openfox')
  
  // Create .openfox directory if it doesn't exist
  await mkdirAsync(openfoxDir, { recursive: true })
  
  // Write config
  await writeFileAsync(configPath, JSON.stringify(config, null, 2))
}
