import { select, text, password, spinner, log, outro, isCancel, cancel } from '@clack/prompts'
import { detectBackend, detectModel } from '../server/llm/index.js'
import { fetchAvailableModelsFromBackend } from '../server/provider-manager.js'
import {
  loadGlobalConfig,
  saveGlobalConfig,
  addProvider,
  removeProvider,
  activateProvider,
  getActiveProvider,
} from './config.js'
import type { Mode } from './main.js'
import type { ProviderBackend } from '../shared/types.js'

const BACKEND_OPTIONS = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'vllm', label: 'vLLM' },
  { value: 'sglang', label: 'SGLang' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'llamacpp', label: 'llama.cpp' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
]

export function printProviderHelp(): void {
  console.log(`
Provider Management Commands:

  openfox provider add       Add a new provider
  openfox provider list      List all configured providers
  openfox provider use       Switch to a different provider
  openfox provider remove    Remove a provider
`)
}

export async function runProviderAdd(mode: Mode): Promise<void> {
  const config = await loadGlobalConfig(mode)

  // Provider name
  const name = await text({
    message: 'Provider name:',
    placeholder: 'My Local vLLM',
    validate: (value) => {
      if (!value || value.length === 0) return 'Name is required'
      if (config.providers.some((p) => p.name === value)) return 'Provider with this name already exists'
    },
  })
  if (isCancel(name)) {
    cancel('Cancelled')
    return
  }

  // URL with examples
  log.info(`URL examples:
  vLLM/SGLang:  http://localhost:8000
  Ollama:       http://localhost:11434
  llama.cpp:    http://localhost:8080
  OpenAI:       https://api.openai.com
  Anthropic:    https://api.anthropic.com
  
  (Don't include /v1 - it's added automatically)`)

  const url = await text({
    message: 'API URL:',
    placeholder: 'http://localhost:8000',
    initialValue: 'http://localhost:8000',
    validate: (value) => {
      if (!value || value.length === 0) return 'URL is required'
      if (!value.startsWith('http')) return 'Must start with http:// or https://'
    },
  })
  if (isCancel(url)) {
    cancel('Cancelled')
    return
  }

  // Backend
  const backend = await select({
    message: 'Backend type:',
    options: BACKEND_OPTIONS,
  })
  if (isCancel(backend)) {
    cancel('Cancelled')
    return
  }

  // Model selection - fetch available models from backend
  let selectedModel: string
  const s = spinner()
  s.start(`Fetching available models from ${url}...`)

  let availableModels: string[] = []
  try {
    // Detect backend first if needed
    if (backend === 'auto') {
      await detectBackend(url as string)
    }

    // Fetch available models
    availableModels = await fetchAvailableModelsFromBackend(url as string)
    s.stop(`Found ${availableModels.length} model(s)`)
  } catch {
    s.stop('⚠ Could not fetch models, will use auto-detect')
  }

  if (availableModels.length > 0) {
    // Show dropdown of available models
    const modelChoice = await select({
      message: 'Select model:',
      options: availableModels.map((m) => ({
        value: m,
        label: m.split('/').pop() ?? m,
        hint: m,
      })),
    })
    if (isCancel(modelChoice)) {
      cancel('Cancelled')
      return
    }
    selectedModel = modelChoice as string
  } else {
    // Fall back to text input
    const model = await text({
      message: 'Model name (or "auto" to detect):',
      placeholder: 'auto',
      initialValue: 'auto',
    })
    if (isCancel(model)) {
      cancel('Cancelled')
      return
    }
    selectedModel = model as string

    // Try to detect model if auto
    if (selectedModel === 'auto') {
      const detectSpinner = spinner()
      detectSpinner.start('Detecting model...')
      let detectedModel: string | null
      try {
        detectedModel = await detectModel(url as string)
        if (detectedModel) {
          selectedModel = detectedModel
          detectSpinner.stop(`Detected: ${detectedModel}`)
        } else {
          detectSpinner.stop('Could not detect model, will use auto')
        }
      } catch {
        detectSpinner.stop('Detection failed, will use auto')
      }
    }
  }

  // API Key (optional)
  let apiKey: string | undefined
  if (backend === 'openai' || backend === 'anthropic') {
    const key = await password({
      message: 'API Key:',
    })
    if (isCancel(key)) {
      cancel('Cancelled')
      return
    }
    apiKey = key || undefined
  } else {
    const needsKey = await select({
      message: 'Does this provider require an API key?',
      options: [
        { value: 'no', label: 'No' },
        { value: 'yes', label: 'Yes' },
      ],
    })
    if (isCancel(needsKey)) {
      cancel('Cancelled')
      return
    }
    if (needsKey === 'yes') {
      const key = await password({
        message: 'API Key:',
      })
      if (isCancel(key)) {
        cancel('Cancelled')
        return
      }
      apiKey = key || undefined
    }
  }

  // Test connection
  const testSpinner = spinner()
  testSpinner.start(`Testing connection to ${url}...`)

  let finalBackend = backend as string
  let finalDetectedModel: string | null = null

  try {
    if (backend === 'auto') {
      finalBackend = await detectBackend(url as string)
    }
    if (selectedModel === 'auto') {
      finalDetectedModel = (await detectModel(url as string)) ?? 'auto'
    }
    testSpinner.stop(`✓ Connected to ${finalBackend}${finalDetectedModel !== 'auto' ? ` (${finalDetectedModel})` : ''}`)
  } catch {
    testSpinner.stop('⚠ Could not connect to provider')
    const continueAnyway = await select({
      message: 'Provider is not reachable. Save anyway?',
      options: [
        { value: 'yes', label: 'Yes, save anyway' },
        { value: 'no', label: 'No, cancel' },
      ],
    })
    if (isCancel(continueAnyway) || continueAnyway === 'no') {
      cancel('Cancelled')
      return
    }
  }

  // Make active?
  const makeActive =
    config.providers.length === 0 ||
    (await (async () => {
      const choice = await select({
        message: 'Make this the active provider?',
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
      })
      if (isCancel(choice)) return false
      return choice === 'yes'
    })())

  // Fetch models with context windows
  const modelsWithContent: Array<{ id: string; contextWindow: number; source: 'backend' | 'user' | 'default' }> = []
  if (availableModels.length > 0) {
    const modelFetchSpinner = spinner()
    modelFetchSpinner.start('Fetching model metadata...')
    try {
      const urlWithV1 = url.includes('/v1') ? url : `${url}/v1`
      const response = await fetch(`${urlWithV1}/models`, {
        signal: AbortSignal.timeout(10000),
      })
      if (response.ok) {
        const data = (await response.json()) as { data?: Array<{ id: string; max_model_len?: number }> }
        if (data.data && Array.isArray(data.data)) {
          for (const modelData of data.data) {
            modelsWithContent.push({
              id: modelData.id,
              contextWindow: modelData.max_model_len ?? 200000,
              source: modelData.max_model_len ? 'backend' : 'default',
            })
          }
          modelFetchSpinner.stop(`✓ Fetched ${modelsWithContent.length} model(s) with context windows`)
        } else {
          modelFetchSpinner.stop('⚠ No models in response')
        }
      } else {
        modelFetchSpinner.stop('⚠ Could not fetch model metadata')
      }
    } catch {
      modelFetchSpinner.stop('⚠ Failed to fetch model metadata')
    }
  }

  // If no models fetched, create empty array (will be populated on first switch)
  const models = modelsWithContent.length > 0 ? modelsWithContent : []

  let newConfig = addProvider(config, {
    name: name as string,
    url: url as string,
    backend: finalBackend as ProviderBackend,
    apiKey,
    models,
    isActive: makeActive as boolean,
  })

  // If making active, set the default model selection
  if (makeActive) {
    const { setDefaultModelSelection } = await import('./config.js')
    newConfig = setDefaultModelSelection(
      newConfig,
      newConfig.providers[newConfig.providers.length - 1]!.id,
      selectedModel,
    )
  }

  await saveGlobalConfig(mode, newConfig)
  outro(`✓ Provider "${name}" added${makeActive ? ' and activated' : ''}`)
}

export async function runProviderList(mode: Mode): Promise<void> {
  const config = await loadGlobalConfig(mode)

  if (config.providers.length === 0) {
    log.warn('No providers configured. Run `openfox provider add` to add one.')
    return
  }

  console.log('\nConfigured providers:\n')
  console.log('  NAME                URL                              MODEL              BACKEND')
  console.log('  ────────────────────────────────────────────────────────────────────────────────')

  for (const provider of config.providers) {
    const marker = provider.isActive ? '▸' : ' '
    const name = provider.name.padEnd(18)
    const url = provider.url.padEnd(32)
    const model = (provider.model || 'auto').padEnd(18)
    const backend = provider.backend

    console.log(`${marker} ${name} ${url} ${model} ${backend}`)
  }

  console.log('')
}

export async function runProviderUse(mode: Mode): Promise<void> {
  const config = await loadGlobalConfig(mode)

  if (config.providers.length === 0) {
    log.warn('No providers configured. Run `openfox provider add` to add one.')
    return
  }

  if (config.providers.length === 1) {
    log.info('Only one provider configured, already active.')
    return
  }

  const activeProvider = getActiveProvider(config)

  const choice = await select({
    message: 'Select provider to activate:',
    options: config.providers.map((p) => ({
      value: p.id,
      label: `${p.name}${p.isActive ? ' (current)' : ''}`,
      hint: `${p.url} - ${p.model}`,
    })),
    initialValue: activeProvider?.id,
  })

  if (isCancel(choice)) {
    cancel('Cancelled')
    return
  }

  if (choice === activeProvider?.id) {
    log.info('Already the active provider.')
    return
  }

  const newConfig = activateProvider(config, choice as string)
  await saveGlobalConfig(mode, newConfig)

  const activated = newConfig.providers.find((p) => p.id === choice)
  outro(`✓ Now using "${activated?.name}"`)
}

export async function runProviderRemove(mode: Mode): Promise<void> {
  const config = await loadGlobalConfig(mode)

  if (config.providers.length === 0) {
    log.warn('No providers configured.')
    return
  }

  const choice = await select({
    message: 'Select provider to remove:',
    options: config.providers.map((p) => ({
      value: p.id,
      label: `${p.name}${p.isActive ? ' (active)' : ''}`,
      hint: p.url,
    })),
  })

  if (isCancel(choice)) {
    cancel('Cancelled')
    return
  }

  const providerToRemove = config.providers.find((p) => p.id === choice)

  if (providerToRemove?.isActive && config.providers.length > 1) {
    const confirm = await select({
      message: `"${providerToRemove.name}" is the active provider. Remove it anyway?`,
      options: [
        { value: 'yes', label: 'Yes, remove and activate next provider' },
        { value: 'no', label: 'No, cancel' },
      ],
    })
    if (isCancel(confirm) || confirm === 'no') {
      cancel('Cancelled')
      return
    }
  }

  const newConfig = removeProvider(config, choice as string)
  await saveGlobalConfig(mode, newConfig)

  outro(`✓ Removed "${providerToRemove?.name}"`)
}

export async function runProviderCommand(mode: Mode, subcommand?: string): Promise<void> {
  switch (subcommand) {
    case 'add':
      await runProviderAdd(mode)
      break
    case 'list':
    case 'ls':
      await runProviderList(mode)
      break
    case 'use':
    case 'switch':
      await runProviderUse(mode)
      break
    case 'remove':
    case 'rm':
    case 'delete':
      await runProviderRemove(mode)
      break
    default:
      printProviderHelp()
  }
}
