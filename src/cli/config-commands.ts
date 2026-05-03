import type { Mode } from './main.js'
import { getDefaultModel } from './config.js'

export function printHelp(): void {
  console.log(`
OpenFox - Local LLM coding assistant

Usage:
  openfox [command] [options]

Commands:
  (none)    Start server for current project
  init      Interactive configuration setup
  config    Show current configuration

Options:
  -p, --port <number>     Specify port (default: 10369 for prod, 10469 for dev)
  --no-browser            Don't open browser on start
  -h, --help              Show this help message
  -v, --version           Show version number
`)
}

export async function runConfig(mode: Mode): Promise<void> {
  const { loadGlobalConfig, getActiveProvider } = await import('./config.js')
  const { getGlobalConfigPath } = await import('./paths.js')

  const config = await loadGlobalConfig(mode)
  const configPath = getGlobalConfigPath(mode)
  const activeProvider = getActiveProvider(config)
  const defaultModel = getDefaultModel(config)

  console.log(`Configuration (${mode}):`)
  console.log(`  Location: ${configPath}`)
  console.log(`  Providers: ${config.providers.length}`)
  if (activeProvider) {
    console.log(`  Active: ${activeProvider.name}`)
    console.log(`    URL: ${activeProvider.url}`)
    console.log(`    Model: ${defaultModel ?? 'auto'}`)
    console.log(`    Backend: ${activeProvider.backend}`)
  } else {
    console.log(`  Active: (none configured)`)
  }
  console.log(`  Port: ${config.server.port}`)
}
