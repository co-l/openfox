import { parseArgs } from 'node:util'
import type { Mode } from './main.js'

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
  -p, --port <number>     Specify port (default: 3000 for prod, 3100 for dev)
  --no-browser            Don't open browser on start
  -h, --help              Show this help message
  -v, --version           Show version number
`)
}

export async function runConfig(mode: Mode): Promise<void> {
  const { loadGlobalConfig } = await import('./config.js')
  const { getGlobalConfigPath } = await import('./paths.js')
  
  const config = await loadGlobalConfig(mode)
  const configPath = getGlobalConfigPath(mode)
  
  console.log(`Configuration (${mode}):`)
  console.log(`  Location: ${configPath}`)
  console.log(`  LLM URL: ${config.llm.url}`)
  console.log(`  Model: ${config.llm.model}`)
  console.log(`  Backend: ${config.llm.backend}`)
  console.log(`  Port: ${config.server.port}`)
}
