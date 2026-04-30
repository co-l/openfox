import { parseArgs } from 'node:util'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { select, password, isCancel, cancel } from '@clack/prompts'
import { generateKeyPairSync } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

export type Mode = 'production' | 'development' | 'test'

export function printHelp(): void {
  console.log(`
OpenFox - Local LLM coding assistant

Usage:
  openfox [command] [options]

Commands:
  (none)           Start server for current project
  config           Show current configuration
  provider add     Add a new LLM provider
  provider list    List configured providers
  provider use     Switch active provider
  provider remove  Remove a provider
  service          Manage the systemd service (install, start, stop, status, logs, uninstall)
  pwa              Manage the PWA installation (install, uninstall, launch, update, status)
  update           Update OpenFox to the latest version (see update.sh)

Options:
  -p, --port <number>     Specify port (default: 10369 for prod, 10469 for dev)
  --no-browser            Don't open browser on start
  -h, --help              Show this help message
  -v, --version           Show version number
`)
}

async function runNetworkSetup(mode: Mode): Promise<void> {
  const { loadAuthConfig, saveAuthConfig, encryptPassword } = await import('./auth.js')
  const { saveGlobalConfig } = await import('./config.js')
  const { getAuthKeyPath } = await import('./paths.js')

  const existingAuth = await loadAuthConfig(mode)
  if (existingAuth) {
    return
  }

  console.log('\nOpenFox Setup\n')

  const networkChoice = await select({
    message: 'How should OpenFox be accessible?',
    options: [
      { value: 'localhost', label: 'Secure (localhost only)' },
      { value: 'network', label: 'Accessible from local network' },
    ],
  })

  if (isCancel(networkChoice)) {
    cancel()
    process.exit(1)
  }

  const isNetwork = networkChoice === 'network'
  const host = isNetwork ? '0.0.0.0' : '127.0.0.1'

  let passwordValue: string | undefined

  if (isNetwork) {
    const pwd = await password({
      message: 'Set a password? (optional, press Enter to skip)',
    })

    if (isCancel(pwd)) {
      cancel()
      process.exit(1)
    }

    passwordValue = typeof pwd === 'string' ? pwd : undefined
  }

  if (passwordValue && passwordValue.length > 0) {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })

    const keyPath = getAuthKeyPath(mode)
    await writeFile(keyPath, privateKey, { mode: 0o600 })

    const encryptedPassword = encryptPassword(passwordValue, publicKey)

    await saveAuthConfig(mode, {
      strategy: 'network',
      encryptedPassword,
    })
  } else {
    await saveAuthConfig(mode, {
      strategy: isNetwork ? 'network' : 'local',
      encryptedPassword: null,
    })
  }

  await saveGlobalConfig(mode, {
    providers: [],
    server: { port: mode === 'development' ? 10469 : 10369, host, openBrowser: true },
    logging: { level: 'error' },
    database: { path: '' },
    workspace: { workdir: process.cwd() },
    visionFallback: { enabled: false, url: 'http://localhost:11434', model: 'qwen3-vl:2b', timeout: 120 },
  })

  console.log('✓ Configuration saved!\n')
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

  const [command] = positionals

  if (values.version && !command) {
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

  if (values.help && !command) {
    printHelp()
    process.exit(0)
  }

  switch (command) {
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
    case 'service': {
      const { runServiceCommand } = await import('./service.js')
      const [, subcommand] = positionals
      if (subcommand === '--help' || subcommand === '-h' || values.help) {
        runServiceCommand(mode, undefined)
      } else {
        await runServiceCommand(mode, subcommand)
      }
      break
    }
    case 'pwa': {
      const { runPwaCommand, printPwaHelp } = await import('./pwa.js')
      const [, subcommand] = positionals
      if (subcommand === '--help' || subcommand === '-h' || values.help) {
        printPwaHelp()
      } else {
        await runPwaCommand(mode, subcommand)
      }
      break
    }
    case 'update': {
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      const updateScriptPath = join(__dirname, 'cli', 'update.sh')
      const result = spawnSync(updateScriptPath, [], { shell: true, stdio: 'inherit' })
      if (result.status !== 0) {
        process.exit(result.status ?? 1)
      }
      break
    }
    
    default: {
      // Check if config exists - only prompt network setup on first install
      const { configFileExists } = await import('./config.js')
      const configExists = await configFileExists(mode)

      if (!configExists) {
        await runNetworkSetup(mode)
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
