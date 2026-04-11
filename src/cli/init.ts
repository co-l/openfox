import { select, text, password, spinner, outro, confirm } from '@clack/prompts'
import { writeFile } from 'node:fs/promises'
import { detectBackend, detectModel } from '../server/llm/index.js'
import { saveGlobalConfig, addProvider, type GlobalConfig } from './config.js'
import { saveAuthConfig, hashPassword, loadAuthConfig, encryptPassword, type AuthConfig } from './auth.js'
import { generateKeyPairSync } from 'node:crypto'
import { getAuthKeyPath } from './paths.js'
import type { Mode } from './main.js'
import type { ProviderBackend } from '../shared/types.js'

const LLM_OPTIONS = [
  { value: 'http://localhost:8000', label: 'http://localhost:8000' },
  { value: 'http://localhost:11434', label: 'http://localhost:11434' },
  { value: 'http://localhost:8080', label: 'http://localhost:8080' },
  { value: 'other', label: 'Other...' },
]

function createBaseConfig() {
  return {
    providers: [],
    defaultModelSelection: undefined,
    activeProviderId: undefined,
    activeWorkflowId: undefined,
    server: { port: 10369, host: '127.0.0.1', openBrowser: true },
    logging: { level: 'error' as const },
    database: { path: '' },
    workspace: { workdir: process.cwd() },
    visionFallback: { enabled: false, url: 'http://localhost:11434', model: 'qwen3-vl:2b', timeout: 120 },
  }
}

/**
 * Prompt user for network accessibility preference
 * Returns '127.0.0.1' for localhost only, '0.0.0.0' for network access
 */
async function promptNetworkAccessibility(mode: Mode): Promise<{ host: string; strategy: 'local' | 'network' }> {
  const networkChoice = await select({
    message: 'How should OpenFox be accessible?',
    options: [
      { value: 'localhost', label: 'Secure (localhost only)' },
      { value: 'network', label: 'Accessible from local network (phone, tablet, etc.)' },
    ],
  })

  // Default to secure if user skips
  if (networkChoice === Symbol.for('clack:cancel')) {
    return { host: '127.0.0.1', strategy: 'local' }
  }

  const isNetwork = networkChoice === 'network'
  const host = isNetwork ? '0.0.0.0' : '127.0.0.1'

  if (isNetwork) {
    const existingAuth = await loadAuthConfig(mode)
    const existingPassword = !!existingAuth?.encryptedPassword

    if (existingPassword) {
      const keepChoice = await confirm({
        message: 'Keep existing password?',
        initialValue: true,
      })

      if (keepChoice === true) {
        return { host, strategy: 'network' }
      }
    }

    const passwordResult = await password({
      message: 'Set a password (optional, press Enter to skip)',
    })

    const pwd = typeof passwordResult === 'string' ? passwordResult : ''

    if (pwd.length > 0) {
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      })

      const keyPath = getAuthKeyPath(mode)
      await writeFile(keyPath, privateKey, { mode: 0o600 })

      const encryptedPassword = encryptPassword(pwd, publicKey)

      await saveAuthConfig(mode, {
        strategy: 'network',
        encryptedPassword,
      })
    } else {
      await saveAuthConfig(mode, {
        strategy: 'network',
        encryptedPassword: null,
      })
    }
  } else {
    await saveAuthConfig(mode, {
      strategy: 'local',
      encryptedPassword: null,
    })
  }

  return { host, strategy: isNetwork ? 'network' : 'local' }
}

/**
 * Run the init wizard with optional existing config
 * If existingConfig is provided, offer to preserve providers
 */
export async function runInitWithSelect(mode: Mode, existingConfig?: GlobalConfig): Promise<void> {
  // If existing config, ask about preserving providers
  let preserveProviders = false
  let config: GlobalConfig
  
  if (existingConfig && existingConfig.providers.length > 0) {
    console.log('\nCurrent configuration detected:')
    console.log(`  Providers: ${existingConfig.providers.length}`)
    existingConfig.providers.forEach((p, i) => {
      console.log(`    ${i + 1}. ${p.name} (${p.url}) - ${p.model}`)
    })
    console.log(`  Server: ${existingConfig.server.host}`)
    
    const keepChoice = await confirm({
      message: 'Keep existing providers?',
      initialValue: true,
    })
    
    if (keepChoice === true) {
      preserveProviders = true
      config = {
        ...existingConfig,
        server: { ...existingConfig.server }, // Copy server settings
      }
      console.log('\nPreserving existing providers...\n')
    } else {
      console.log('\nStarting fresh configuration...\n')
      config = createBaseConfig()
    }
  } else {
    config = createBaseConfig()
  }
  
  // Only run LLM setup if not preserving providers
  if (!preserveProviders) {
    const s = spinner()
    s.start('Searching for local LLM...')
    
    // Try smart defaults in parallel while showing spinner
    const detected = await Promise.all(
      LLM_OPTIONS.filter(o => o.value !== 'other').map(async ({ value: url }) => {
        try {
          const [backend, model] = await Promise.all([
            detectBackend(url, undefined, true),
            detectModel(url, 1, true),
          ])
          if (backend !== 'unknown' && model) {
            return { url, backend, model }
          }
        } catch {
          // Silent fail
        }
        return null
      })
    )
    
    const found = detected.find(r => r !== null)
    if (found) {
      s.stop(`✓ Found ${found.backend} (${found.model})`)
      config = addProvider(config, {
        name: 'Default',
        url: found.url,

        backend: found.backend as ProviderBackend,
        models: [],
        isActive: true,
      })
    } else {
      s.stop('✗ No LLM server detected')
      
      const selection = await select({
        message: 'Select your LLM server:',
        options: LLM_OPTIONS,
      })
      
      let url: string
      if (String(selection) === 'other') {
        const textValue = await text({
          message: 'LLM Server URL (don\'t include /v1)',
          placeholder: 'http://localhost:8000',
          initialValue: 'http://localhost:8000',
          validate: (value) => {
            if (!value || value.length === 0) return 'URL is required'
            if (!value.startsWith('http')) return 'Must start with http://'
          },
        })
        url = String(textValue)
      } else {
        url = String(selection)
      }
      
      // Test connection
      const s2 = spinner()
      s2.start(`Testing connection to ${url}...`)
      
      try {
        const backend = await detectBackend(url)
        const model = await detectModel(url)
        
        s2.stop(`Connected to ${backend}${model ? ' (' + model + ')' : ''}`)
        
        config = addProvider(config, {
          name: 'Default',
          url,
          backend: backend as ProviderBackend,
          models: [],
          isActive: true,
        })
        // Set the default model selection
        const { setDefaultModelSelection } = await import('./config.js')
        config = setDefaultModelSelection(config, config.providers[config.providers.length - 1]!.id, model ?? 'auto')
      } catch {
        s2.stop('Server isn\'t available')
        
        const choice = await select({
          message: 'Continue with this URL or retry?',
          options: [
            { value: 'continue', label: 'Continue' },
            { value: 'retry', label: 'Retry' },
            { value: 'change', label: 'Select different server' },
          ],
        })
        
        if (choice === 'retry') {
          return runInitWithSelect(mode, existingConfig)  // Recurse to retry
        } else if (choice === 'change') {
          return runInitWithSelect(mode, existingConfig)  // Recurse to change selection
        }
        // choice === 'continue' - save anyway with auto backend
        config = addProvider(config, {
          name: 'Default',
          url,
          backend: 'auto',
          models: [],
          isActive: true,
        })
        // Set the default model selection
        const { setDefaultModelSelection } = await import('./config.js')
        config = setDefaultModelSelection(config, config.providers[config.providers.length - 1]!.id, 'auto')
      }
    }
  }
  
  // Ask about network accessibility
  const { host } = await promptNetworkAccessibility(mode)
  config.server.host = host
  
  // Ask about workspace directory
  const workdirChoice = await text({
    message: 'Workspace directory for new projects',
    placeholder: 'Directory where new projects will be created',
    initialValue: config.workspace?.workdir || process.cwd(),
    validate: (value) => {
      if (!value || value.length === 0) return 'Workspace directory is required'
    },
  })
  // Normalize: remove trailing slash to prevent double slashes in paths
  config.workspace = { workdir: String(workdirChoice).replace(/\/$/, '') }

  // Ask about vision fallback for non-vision models
  const visionChoice = await confirm({
    message: 'Configure vision fallback for non-vision models?',
    initialValue: false,
  })

  if (visionChoice === true) {
    // Ask for fallback URL
    const visionUrl = await text({
      message: 'Vision fallback server URL',
      placeholder: 'http://localhost:11434',
      initialValue: config.visionFallback?.url || 'http://localhost:11434',
      validate: (value) => {
        if (!value || value.length === 0) return 'URL is required'
        if (!value.startsWith('http')) return 'Must start with http://'
      },
    })

    // Ask for fallback model
    const visionModel = await text({
      message: 'Vision fallback model name',
      placeholder: 'qwen3-vl:2b',
      initialValue: config.visionFallback?.model || 'qwen3-vl:2b',
      validate: (value) => {
        if (!value || value.length === 0) return 'Model name is required'
      },
    })

    config.visionFallback = {
      enabled: true,
      url: String(visionUrl),
      model: String(visionModel),
      timeout: 120,
    }
  }

  // If a provider was added and no default model selection exists, set it
  if (config.providers.length > 0 && !config.defaultModelSelection) {
    const { setDefaultModelSelection } = await import('./config.js')
    config = setDefaultModelSelection(config, config.providers[0]!.id, 'auto')
  }
  
  // Save the configuration
  await saveGlobalConfig(mode, config)
  
  outro('Configuration saved!')
}
