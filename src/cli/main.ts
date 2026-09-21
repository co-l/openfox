import { parseArgs } from 'node:util'
import { select, password, isCancel, cancel } from '@clack/prompts'
import { generateKeyPairSync } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { cliT, setCliMode } from './i18n.js'

export type Mode = 'production' | 'development' | 'test'

export function printHelp(): void {
  console.log(
    cliT({
      en: `
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
  mcp              Print a paste-ready MCP client config for this server (asks for the password if set)
  install          Install a persistent OpenFox launcher (use --check to inspect)
  update           Update OpenFox to the latest version

Options:
  -p, --port <number>     Specify port (default: 10369 for prod, 10469 for dev)
  --no-browser            Don't open browser on start
  -h, --help              Show this help message
  -v, --version           Show version number
`,
      fr: `
OpenFox - Assistant de codage LLM local

Utilisation :
  openfox [commande] [options]

Commandes :
  (aucune)        Démarrer le serveur pour le projet courant
  config          Afficher la configuration actuelle
  provider add    Ajouter un nouveau fournisseur LLM
  provider list   Lister les fournisseurs configurés
  provider use    Changer de fournisseur actif
  provider remove Supprimer un fournisseur
  service         Gérer le service systemd (install, start, stop, status, logs, uninstall)
  pwa             Gérer l’installation PWA (install, uninstall, launch, update, status)
  mcp             Afficher une configuration MCP prête à coller pour ce serveur (demande le mot de passe s’il est défini)
  install         Installer un lanceur OpenFox persistant (utiliser --check pour inspecter)
  update          Mettre OpenFox à jour vers la dernière version

Options :
  -p, --port <nombre>    Spécifier le port (défaut : 10369 pour prod, 10469 pour dev)
  --no-browser           Ne pas ouvrir le navigateur au démarrage
  -h, --help             Afficher ce message d’aide
  -v, --version          Afficher le numéro de version
`,
    }),
  )
}

async function runNetworkSetup(mode: Mode): Promise<void> {
  const { loadAuthConfig, saveAuthConfig, encryptPassword } = await import('./auth.js')
  const { saveGlobalConfig } = await import('./config.js')
  const { getAuthKeyPath } = await import('./paths.js')

  const existingAuth = await loadAuthConfig(mode)
  if (existingAuth) {
    return
  }

  console.log(cliT({ en: '\nOpenFox Setup\n', fr: '\nConfiguration d’OpenFox\n' }))

  const networkChoice = await select({
    message: cliT({ en: 'How should OpenFox be accessible?', fr: 'Comment OpenFox doit-il être accessible ?' }),
    options: [
      { value: 'localhost', label: cliT({ en: 'Secure (localhost only)', fr: 'Sécurisé (localhost uniquement)' }) },
      {
        value: 'network',
        label: cliT({ en: 'Accessible from local network', fr: 'Accessible depuis le réseau local' }),
      },
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
      message: cliT({
        en: 'Set a password? (optional, press Enter to skip)',
        fr: 'Définir un mot de passe ? (facultatif, Entrée pour ignorer)',
      }),
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

    const encryptedPassword = encryptPassword(passwordValue, publicKey)

    await saveAuthConfig(mode, {
      strategy: 'network',
      encryptedPassword,
    })

    const keyPath = getAuthKeyPath(mode)
    await writeFile(keyPath, privateKey, { mode: 0o600 })
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
    visionFallback: {
      enabled: false,
      url: 'http://localhost:11434',
      model: 'qwen3.5:0.8b',
      timeout: 120,
      backend: 'ollama' as const,
    },
  })

  console.log(cliT({ en: '✓ Configuration saved!\n', fr: '✓ Configuration enregistrée !\n' }))
}

export async function runConfig(mode: Mode): Promise<void> {
  const { loadGlobalConfig, getActiveProvider, getDefaultModel } = await import('./config.js')
  const { getGlobalConfigPath } = await import('./paths.js')

  const config = await loadGlobalConfig(mode)
  const configPath = getGlobalConfigPath(mode)
  const activeProvider = getActiveProvider(config)
  const defaultModel = getDefaultModel(config)

  console.log(cliT({ en: `Configuration (${mode}):`, fr: `Configuration (${mode}) :` }))
  console.log(cliT({ en: `  Location: ${configPath}`, fr: `  Emplacement : ${configPath}` }))
  console.log(
    cliT({ en: `  Providers: ${config.providers.length}`, fr: `  Fournisseurs : ${config.providers.length}` }),
  )
  if (activeProvider) {
    console.log(cliT({ en: `  Active: ${activeProvider.name}`, fr: `  Actif : ${activeProvider.name}` }))
    console.log(cliT({ en: `    URL: ${activeProvider.url}`, fr: `    URL : ${activeProvider.url}` }))
    console.log(cliT({ en: `    Model: ${defaultModel ?? 'auto'}`, fr: `    Modèle : ${defaultModel ?? 'auto'}` }))
    console.log(cliT({ en: `    Backend: ${activeProvider.backend}`, fr: `    Backend : ${activeProvider.backend}` }))
  } else {
    console.log(cliT({ en: `  Active: (none configured)`, fr: `  Actif : (aucun configuré)` }))
  }

  // Display server host with human-readable description
  const host = config.server.host ?? '127.0.0.1'
  const hostDisplay =
    host === '0.0.0.0'
      ? cliT({ en: `${host} (accessible from local network)`, fr: `${host} (accessible depuis le réseau local)` })
      : cliT({ en: `${host} (localhost only)`, fr: `${host} (localhost uniquement)` })
  console.log(cliT({ en: `  Server: ${hostDisplay}`, fr: `  Serveur : ${hostDisplay}` }))
  console.log(cliT({ en: `  Port: ${config.server.port}`, fr: `  Port : ${config.server.port}` }))
}

export async function runCli(options: { mode: Mode }): Promise<void> {
  const { mode } = options
  setCliMode(mode)

  const { values, positionals } = parseArgs({
    options: {
      port: { type: 'string', short: 'p' },
      password: { type: 'string' },
      'no-browser': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      service: { type: 'boolean' },
      follow: { type: 'boolean', short: 'f' },
      check: { type: 'boolean' },
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
      const [, subcommand, ...serviceArgs] = positionals
      if (values.follow) {
        serviceArgs.push('-f')
      }
      if (subcommand === '--help' || subcommand === '-h' || values.help) {
        runServiceCommand(mode, undefined)
      } else {
        await runServiceCommand(mode, subcommand, ...serviceArgs)
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
    case 'mcp': {
      const { runMcpCommand } = await import('./mcp.js')
      const mcpOptions: { password?: string; port?: number } = {}
      if (values.password) mcpOptions.password = values.password
      if (values.port) mcpOptions.port = parseInt(values.port)
      await runMcpCommand(mode, mcpOptions)
      break
    }
    case 'install': {
      const { runInstall } = await import('./install.js')
      const code = await runInstall({ check: values.check === true })
      if (code !== 0) {
        process.exit(code)
      }
      break
    }
    case 'update': {
      const { runUpdate } = await import('./update.js')
      const code = await runUpdate()
      if (code !== 0) {
        process.exit(code)
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
      const serveOptions: { mode: Mode; port?: number; openBrowser?: boolean } = { mode }
      if (values.port) serveOptions.port = parseInt(values.port)
      if (values['no-browser'] === true) serveOptions.openBrowser = false
      await runServe(serveOptions)
    }
  }
}
