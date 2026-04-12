import { parseArgs } from 'node:util'

export type Mode = 'production' | 'development' | 'test'

export function printHelp(): void {
  console.log(`
OpenFox - Local LLM coding assistant

Usage:
  openfox [command] [options]

Commands:
  (none)           Start server for current project
  init             Interactive configuration setup
  config           Show current configuration
  provider add     Add a new LLM provider
  provider list    List configured providers
  provider use     Switch active provider
  provider remove  Remove a provider

Options:
  -p, --port <number>     Specify port (default: 10369 for prod, 10469 for dev)
  --no-browser            Don't open browser on start
  -h, --help              Show this help message
  -v, --version           Show version number
`)
}

export async function runConfig(mode: Mode): Promise<void> {
  const { loadGlobalConfig, getActiveProvider, getDefaultModel } = await import('./config.js')
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
  
  // Display server host with human-readable description
  const hostDisplay = config.server.host === '0.0.0.0' 
    ? `${config.server.host} (accessible from local network)`
    : `${config.server.host} (localhost only)`
  console.log(`  Server: ${hostDisplay}`)
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
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const packageJsonPath = join(__dirname, '../package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
    console.log(packageJson.version)
    process.exit(0)
  }

  const [command] = positionals

  switch (command) {
    case 'init': {
      const { runInitWithSelect } = await import('./init.js')
      const { loadGlobalConfig, getActiveProvider } = await import('./config.js')
      const config = await loadGlobalConfig(mode)
      const activeProvider = getActiveProvider(config)
      if (activeProvider) {
        console.log(`Current provider: ${activeProvider.name} (${activeProvider.url})\n`)
      }
      // Pass existing config to init for potential preservation
      await runInitWithSelect(mode, config)
      break
    }
    case 'config': {
      await runConfig(mode)
      break
    }
    case 'provider': {
      const { runProviderCommand } = await import('./provider.js')
      const [, subcommand] = positionals
      await runProviderCommand(mode, subcommand)
      break
    }
    default: {
      // Check if config exists - only run wizard on first install
      const { configFileExists } = await import('./config.js')
      const configExists = await configFileExists(mode)
      
      if (!configExists) {
        // First run - show welcome message
        console.log('Welcome to OpenFox!\n')
        
        // Try smart defaults in parallel (silent - no logs)
        const { trySmartDefaults, saveGlobalConfig, addProvider } = await import('./config.js')
        const detected = await trySmartDefaults(mode)
        
        if (detected) {
          console.log(`✓ Found ${detected.backend} (${detected.model}) at ${detected.url}`)
          const baseConfig = {
            providers: [],
            server: { port: 10369, host: '127.0.0.1', openBrowser: true },
            logging: { level: 'error' as const },
            database: { path: '' },
            workspace: { workdir: process.cwd() },
          }
          const configWithProvider = addProvider(baseConfig, {
            name: 'Default',
            url: detected.url,
            backend: detected.backend as 'auto' | 'vllm' | 'sglang' | 'ollama' | 'llamacpp',
            models: [],
            isActive: true,
          })
          // Set the default model selection after adding provider
          const { setDefaultModelSelection } = await import('./config.js')
          const finalConfig = setDefaultModelSelection(configWithProvider, configWithProvider.providers[0]!.id, detected.model)
          await saveGlobalConfig(mode, finalConfig)
          console.log('Configuration saved!\n')
        } else {
          console.log('✗ No LLM server detected\n')
          const { runInitWithSelect } = await import('./init.js')
          await runInitWithSelect(mode)
        }
      }
      
      const { runServe } = await import('./serve.js')
      await runServe({
        mode,
        port: values.port ? parseInt(values.port) : undefined,
        openBrowser: values['no-browser'] === true ? false : undefined,
      } as any)
    }
  }
}
