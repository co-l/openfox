import { select, text, password, spinner, log, outro, isCancel, cancel } from '@clack/prompts'
import { detectModel } from '../server/llm/index.js'
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
import { cliT } from './i18n.js'

const BACKEND_OPTIONS = [
  { value: 'vllm', label: 'vLLM' },
  { value: 'sglang', label: 'SGLang' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'llamacpp', label: 'llama.cpp' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
]

export function printProviderHelp(): void {
  console.log(
    cliT({
      en: `
Provider Management Commands:

  openfox provider add       Add a new provider
  openfox provider list      List all configured providers
  openfox provider use       Switch to a different provider
  openfox provider remove    Remove a provider
`,
      fr: `
Commandes de gestion des fournisseurs :

  openfox provider add       Ajouter un nouveau fournisseur
  openfox provider list      Lister tous les fournisseurs configurés
  openfox provider use       Changer de fournisseur
  openfox provider remove    Supprimer un fournisseur
`,
    }),
  )
}

export async function runProviderAdd(mode: Mode): Promise<void> {
  const config = await loadGlobalConfig(mode)

  // Provider name
  const name = await text({
    message: cliT({ en: 'Provider name:', fr: 'Nom du fournisseur :' }),
    placeholder: cliT({ en: 'My Local vLLM', fr: 'Mon vLLM local' }),
    validate: (value) => {
      if (!value || value.length === 0) return cliT({ en: 'Name is required', fr: 'Le nom est requis' })
      if (config.providers.some((p) => p.name === value))
        return cliT({ en: 'Provider with this name already exists', fr: 'Un fournisseur avec ce nom existe déjà' })
    },
  })
  if (isCancel(name)) {
    cancel(cliT({ en: 'Cancelled', fr: 'Annulé' }))
    return
  }

  // URL with examples
  log.info(
    cliT({
      en: `URL examples:
  vLLM/SGLang:  http://localhost:8000
  Ollama:       http://localhost:11434
  llama.cpp:    http://localhost:8080
  OpenAI:       https://api.openai.com
  Anthropic:    https://api.anthropic.com
  
  (Don't include /v1 - it's added automatically)`,
      fr: `Exemples d’URL :
  vLLM/SGLang :  http://localhost:8000
  Ollama :       http://localhost:11434
  llama.cpp :    http://localhost:8080
  OpenAI :       https://api.openai.com
  Anthropic :    https://api.anthropic.com
  
  (N’incluez pas /v1 - il est ajouté automatiquement)`,
    }),
  )

  const url = await text({
    message: cliT({ en: 'API URL:', fr: 'URL de l’API :' }),
    placeholder: 'http://localhost:8000',
    initialValue: 'http://localhost:8000',
    validate: (value) => {
      if (!value || value.length === 0) return cliT({ en: 'URL is required', fr: 'L’URL est requise' })
      if (!value.startsWith('http'))
        return cliT({ en: 'Must start with http:// or https://', fr: 'Doit commencer par http:// ou https://' })
    },
  })
  if (isCancel(url)) {
    cancel(cliT({ en: 'Cancelled', fr: 'Annulé' }))
    return
  }

  // Backend
  const backend = await select({
    message: cliT({ en: 'Backend type:', fr: 'Type de backend :' }),
    options: BACKEND_OPTIONS,
  })
  if (isCancel(backend)) {
    cancel(cliT({ en: 'Cancelled', fr: 'Annulé' }))
    return
  }

  // Model selection - fetch available models from backend
  let selectedModel: string
  const s = spinner()
  s.start(
    cliT({
      en: `Fetching available models from ${url}...`,
      fr: `Récupération des modèles disponibles depuis ${url}...`,
    }),
  )

  let availableModels: string[] = []
  try {
    // Fetch available models
    availableModels = await fetchAvailableModelsFromBackend(url as string)
    s.stop(
      cliT({ en: `Found ${availableModels.length} model(s)`, fr: `${availableModels.length} modèle(s) trouvé(s)` }),
    )
  } catch {
    s.stop(
      cliT({
        en: '⚠ Could not fetch models, will use auto-detect',
        fr: '⚠ Impossible de récupérer les modèles, auto-détection utilisée',
      }),
    )
  }

  if (availableModels.length > 0) {
    // Show dropdown of available models
    const modelChoice = await select({
      message: cliT({ en: 'Select model:', fr: 'Sélectionnez un modèle :' }),
      options: availableModels.map((m) => ({
        value: m,
        label: m.split('/').pop() ?? m,
        hint: m,
      })),
    })
    if (isCancel(modelChoice)) {
      cancel(cliT({ en: 'Cancelled', fr: 'Annulé' }))
      return
    }
    selectedModel = modelChoice as string
  } else {
    // Fall back to text input
    const model = await text({
      message: cliT({ en: 'Model name (or "auto" to detect):', fr: 'Nom du modèle (ou « auto » pour détecter) :' }),
      placeholder: 'auto',
      initialValue: 'auto',
    })
    if (isCancel(model)) {
      cancel(cliT({ en: 'Cancelled', fr: 'Annulé' }))
      return
    }
    selectedModel = model as string

    // Try to detect model if auto
    if (selectedModel === 'auto') {
      const detectSpinner = spinner()
      detectSpinner.start(cliT({ en: 'Detecting model...', fr: 'Détection du modèle...' }))
      let detectedModel: string | null
      try {
        detectedModel = await detectModel(url as string)
        if (detectedModel) {
          selectedModel = detectedModel
          detectSpinner.stop(cliT({ en: `Detected: ${detectedModel}`, fr: `Détecté : ${detectedModel}` }))
        } else {
          detectSpinner.stop(
            cliT({
              en: 'Could not detect model, will use auto',
              fr: 'Impossible de détecter le modèle, « auto » sera utilisé',
            }),
          )
        }
      } catch {
        detectSpinner.stop(
          cliT({ en: 'Detection failed, will use auto', fr: 'Échec de la détection, « auto » sera utilisé' }),
        )
      }
    }
  }

  // Is this a local provider?
  const localBackends = new Set(['vllm', 'sglang', 'ollama', 'llamacpp', 'opencode-go'])
  const defaultIsLocal = localBackends.has(backend as string)
  const isLocalChoice = await select({
    message: cliT({ en: 'Is this a local provider?', fr: 'S’agit-il d’un fournisseur local ?' }),
    options: [
      { value: 'yes', label: cliT({ en: 'Yes', fr: 'Oui' }) },
      { value: 'no', label: cliT({ en: 'No', fr: 'Non' }) },
    ],
    initialValue: defaultIsLocal ? 'yes' : 'no',
  })
  if (isCancel(isLocalChoice)) {
    cancel(cliT({ en: 'Cancelled', fr: 'Annulé' }))
    return
  }
  const isLocal = isLocalChoice === 'yes'

  // API Key (optional)
  let apiKey: string | undefined
  if (backend === 'openai' || backend === 'anthropic') {
    const key = await password({
      message: cliT({ en: 'API Key:', fr: 'Clé API :' }),
    })
    if (isCancel(key)) {
      cancel(cliT({ en: 'Cancelled', fr: 'Annulé' }))
      return
    }
    apiKey = key || undefined
  } else {
    const needsKey = await select({
      message: cliT({ en: 'Does this provider require an API key?', fr: 'Ce fournisseur requiert-il une clé API ?' }),
      options: [
        { value: 'no', label: cliT({ en: 'No', fr: 'Non' }) },
        { value: 'yes', label: cliT({ en: 'Yes', fr: 'Oui' }) },
      ],
    })
    if (isCancel(needsKey)) {
      cancel(cliT({ en: 'Cancelled', fr: 'Annulé' }))
      return
    }
    if (needsKey === 'yes') {
      const key = await password({
        message: cliT({ en: 'API Key:', fr: 'Clé API :' }),
      })
      if (isCancel(key)) {
        cancel(cliT({ en: 'Cancelled', fr: 'Annulé' }))
        return
      }
      apiKey = key || undefined
    }
  }

  // Test connection
  const testSpinner = spinner()
  testSpinner.start(cliT({ en: `Testing connection to ${url}...`, fr: `Test de la connexion à ${url}...` }))

  const finalBackend = backend as string
  let finalDetectedModel: string | null = null

  try {
    if (selectedModel === 'auto') {
      finalDetectedModel = (await detectModel(url as string)) ?? 'auto'
    }
    testSpinner.stop(
      cliT({
        en: `✓ Connected to ${finalBackend}${finalDetectedModel !== 'auto' ? ` (${finalDetectedModel})` : ''}`,
        fr: `✓ Connecté à ${finalBackend}${finalDetectedModel !== 'auto' ? ` (${finalDetectedModel})` : ''}`,
      }),
    )
  } catch {
    testSpinner.stop(cliT({ en: '⚠ Could not connect to provider', fr: '⚠ Impossible de se connecter au fournisseur' }))
    const continueAnyway = await select({
      message: cliT({
        en: 'Provider is not reachable. Save anyway?',
        fr: 'Le fournisseur est injoignable. Enregistrer quand même ?',
      }),
      options: [
        { value: 'yes', label: cliT({ en: 'Yes, save anyway', fr: 'Oui, enregistrer quand même' }) },
        { value: 'no', label: cliT({ en: 'No, cancel', fr: 'Non, annuler' }) },
      ],
    })
    if (isCancel(continueAnyway) || continueAnyway === 'no') {
      cancel(cliT({ en: 'Cancelled', fr: 'Annulé' }))
      return
    }
  }

  // Make active?
  const makeActive =
    config.providers.length === 0 ||
    (await (async () => {
      const choice = await select({
        message: cliT({ en: 'Make this the active provider?', fr: 'Faire de ce fournisseur le fournisseur actif ?' }),
        options: [
          { value: 'yes', label: cliT({ en: 'Yes', fr: 'Oui' }) },
          { value: 'no', label: cliT({ en: 'No', fr: 'Non' }) },
        ],
      })
      if (isCancel(choice)) return false
      return choice === 'yes'
    })())

  // Fetch models with context windows
  const modelsWithContent: Array<{ id: string; contextWindow: number; source: 'backend' | 'user' | 'default' }> = []
  if (availableModels.length > 0) {
    const modelFetchSpinner = spinner()
    modelFetchSpinner.start(
      cliT({ en: 'Fetching model metadata...', fr: 'Récupération des métadonnées des modèles...' }),
    )
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
          modelFetchSpinner.stop(
            cliT({
              en: `✓ Fetched ${modelsWithContent.length} model(s) with context windows`,
              fr: `✓ ${modelsWithContent.length} modèle(s) récupéré(s) avec fenêtres de contexte`,
            }),
          )
        } else {
          modelFetchSpinner.stop(cliT({ en: '⚠ No models in response', fr: '⚠ Aucun modèle dans la réponse' }))
        }
      } else {
        modelFetchSpinner.stop(
          cliT({ en: '⚠ Could not fetch model metadata', fr: '⚠ Impossible de récupérer les métadonnées des modèles' }),
        )
      }
    } catch {
      modelFetchSpinner.stop(
        cliT({ en: '⚠ Failed to fetch model metadata', fr: '⚠ Échec de la récupération des métadonnées des modèles' }),
      )
    }
  }

  // If no models fetched, create empty array (will be populated on first switch)
  const models = modelsWithContent.length > 0 ? modelsWithContent : []

  let newConfig = addProvider(config, {
    name: name as string,
    url: url as string,
    backend: finalBackend as ProviderBackend,
    apiKey,
    isLocal,
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
  outro(
    cliT({
      en: `✓ Provider "${name}" added${makeActive ? ' and activated' : ''}`,
      fr: `✓ Fournisseur « ${name} » ajouté${makeActive ? ' et activé' : ''}`,
    }),
  )
}

export async function runProviderList(mode: Mode): Promise<void> {
  const config = await loadGlobalConfig(mode)

  if (config.providers.length === 0) {
    log.warn(
      cliT({
        en: 'No providers configured. Run `openfox provider add` to add one.',
        fr: 'Aucun fournisseur configuré. Lancez `openfox provider add` pour en ajouter un.',
      }),
    )
    return
  }

  console.log(cliT({ en: '\nConfigured providers:\n', fr: '\nFournisseurs configurés :\n' }))
  console.log(
    cliT({
      en: '  NAME                URL                              MODEL              BACKEND',
      fr: '  NOM                URL                              MODÈLE             BACKEND',
    }),
  )
  console.log(
    cliT({
      en: '  ────────────────────────────────────────────────────────────────────────────────',
      fr: '  ────────────────────────────────────────────────────────────────────────────────',
    }),
  )

  for (const provider of config.providers) {
    const marker = provider.isActive ? '▸' : ' '
    const name = provider.name.padEnd(18)
    const url = provider.url.padEnd(32)
    const model = (provider.models?.[0]?.id || 'auto').padEnd(18)
    const backend = provider.backend

    console.log(`${marker} ${name} ${url} ${model} ${backend}`)
  }

  console.log('')
}

export async function runProviderUse(mode: Mode): Promise<void> {
  const config = await loadGlobalConfig(mode)

  if (config.providers.length === 0) {
    log.warn(
      cliT({
        en: 'No providers configured. Run `openfox provider add` to add one.',
        fr: 'Aucun fournisseur configuré. Lancez `openfox provider add` pour en ajouter un.',
      }),
    )
    return
  }

  if (config.providers.length === 1) {
    log.info(
      cliT({ en: 'Only one provider configured, already active.', fr: 'Un seul fournisseur configuré, déjà actif.' }),
    )
    return
  }

  const activeProvider = getActiveProvider(config)

  const choice = await select({
    message: cliT({ en: 'Select provider to activate:', fr: 'Sélectionnez le fournisseur à activer :' }),
    options: config.providers.map((p) => ({
      value: p.id,
      label: `${p.name}${p.isActive ? cliT({ en: ' (current)', fr: ' (actuel)' }) : ''}`,
      hint: `${p.url} - ${p.models?.[0]?.id ?? 'auto'}`,
    })),
    initialValue: activeProvider?.id,
  })

  if (isCancel(choice)) {
    cancel(cliT({ en: 'Cancelled', fr: 'Annulé' }))
    return
  }

  if (choice === activeProvider?.id) {
    log.info(cliT({ en: 'Already the active provider.', fr: 'Déjà le fournisseur actif.' }))
    return
  }

  const newConfig = activateProvider(config, choice as string)
  await saveGlobalConfig(mode, newConfig)

  const activated = newConfig.providers.find((p) => p.id === choice)
  outro(cliT({ en: `✓ Now using "${activated?.name}"`, fr: `✓ Vous utilisez désormais « ${activated?.name} »` }))
}

export async function runProviderRemove(mode: Mode): Promise<void> {
  const config = await loadGlobalConfig(mode)

  if (config.providers.length === 0) {
    log.warn(cliT({ en: 'No providers configured.', fr: 'Aucun fournisseur configuré.' }))
    return
  }

  const choice = await select({
    message: cliT({ en: 'Select provider to remove:', fr: 'Sélectionnez le fournisseur à supprimer :' }),
    options: config.providers.map((p) => ({
      value: p.id,
      label: `${p.name}${p.isActive ? cliT({ en: ' (active)', fr: ' (actif)' }) : ''}`,
      hint: p.url,
    })),
  })

  if (isCancel(choice)) {
    cancel(cliT({ en: 'Cancelled', fr: 'Annulé' }))
    return
  }

  const providerToRemove = config.providers.find((p) => p.id === choice)

  if (providerToRemove?.isActive && config.providers.length > 1) {
    const confirm = await select({
      message: cliT({
        en: `"${providerToRemove.name}" is the active provider. Remove it anyway?`,
        fr: `« ${providerToRemove.name} » est le fournisseur actif. Le supprimer quand même ?`,
      }),
      options: [
        {
          value: 'yes',
          label: cliT({
            en: 'Yes, remove and activate next provider',
            fr: 'Oui, supprimer et activer le fournisseur suivant',
          }),
        },
        { value: 'no', label: cliT({ en: 'No, cancel', fr: 'Non, annuler' }) },
      ],
    })
    if (isCancel(confirm) || confirm === 'no') {
      cancel(cliT({ en: 'Cancelled', fr: 'Annulé' }))
      return
    }
  }

  const newConfig = removeProvider(config, choice as string)
  await saveGlobalConfig(mode, newConfig)

  outro(cliT({ en: `✓ Removed "${providerToRemove?.name}"`, fr: `✓ « ${providerToRemove?.name} » supprimé` }))
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
