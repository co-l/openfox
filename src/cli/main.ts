import { parseArgs } from 'node:util'

export type Mode = 'production' | 'development'

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

export async function runCli(options: { mode: Mode }): Promise<void> {
  const { mode } = options
  
  const { values, positionals } = parseArgs({
    options: {
      port: { type: 'string', short: 'p' },
      'no-browser': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    allowPositionals: true,
    strict: true,
  })

  if (values.help) {
    printHelp()
    process.exit(0)
  }

  if (values.version) {
    console.log('0.1.0')
    process.exit(0)
  }

  const [command] = positionals

  switch (command) {
    case 'init': {
      const { runInit } = await import('./init.js')
      await runInit(mode)
      break
    }
    case 'config': {
      await runConfig(mode)
      break
    }
    default: {
      const { runServe } = await import('./serve.js')
      await runServe({
        mode,
        port: values.port ? parseInt(values.port) : undefined,
        openBrowser: !values['no-browser'],
      })
    }
  }
}
