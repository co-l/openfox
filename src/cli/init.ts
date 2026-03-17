import { intro, outro, text, spinner, log } from '@clack/prompts'
import { detectBackend, detectModel } from '../server/llm/index.js'
import { loadGlobalConfig, saveGlobalConfig, mergeConfigs } from './config.js'
import type { Mode } from './main.js'

export async function runInit(mode: Mode): Promise<void> {
  intro('Welcome to OpenFox!')
  
  const existing = await loadGlobalConfig(mode)
  
  const url = await text({
    message: 'LLM Server URL',
    placeholder: 'http://localhost:8000/v1',
    initialValue: existing.llm.url ?? 'http://localhost:8000/v1',
    validate: (value) => {
      if (!value || value.length === 0) return 'URL is required'
      if (!value.startsWith('http')) return 'Must start with http://'
    },
  })
  
  const s = spinner()
  s.start('Testing connection...')
  
  try {
    const backend = await detectBackend(String(url))
    const model = await detectModel(String(url))
    
    s.stop(`Connected to ${backend}${model ? ' (' + model + ')' : ''}`)
    
    const config = mergeConfigs(existing, {
      llm: { url: String(url), backend: backend as 'auto' | 'vllm' | 'sglang' | 'ollama' | 'llamacpp', model: model ?? 'auto', maxContext: existing.llm.maxContext, disableThinking: existing.llm.disableThinking },
    })
    
    await saveGlobalConfig(mode, config)
    
    outro('Configuration saved!')
  } catch (err) {
    s.stop('Connection failed')
    log.error(`Could not connect to ${String(url)}`)
    outro('Setup cancelled. Run `openfox init` to try again.')
    process.exit(1)
  }
}
