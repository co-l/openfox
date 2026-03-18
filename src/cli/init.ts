import { select, text, spinner, log, outro } from '@clack/prompts'
import { detectBackend, detectModel } from '../server/llm/index.js'
import { saveGlobalConfig } from './config.js'
import type { Mode } from './main.js'

const LLM_OPTIONS = [
  { value: 'http://localhost:8000', label: 'http://localhost:8000' },
  { value: 'http://localhost:11434', label: 'http://localhost:11434' },
  { value: 'http://localhost:8080', label: 'http://localhost:8080' },
  { value: 'other', label: 'Other...' },
]

export async function runInitWithSelect(mode: Mode): Promise<void> {
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
    const config = {
      llm: { url: found.url, backend: found.backend as 'auto' | 'vllm' | 'sglang' | 'ollama' | 'llamacpp', model: found.model, maxContext: 200000, disableThinking: false },
      server: { port: 10369, host: '127.0.0.1', openBrowser: true },
      logging: { level: 'info' as const },
      database: { path: '' },
    }
    await saveGlobalConfig(mode, config)
    outro('Configuration saved!')
    return
  }
  
  s.stop('✗ No LLM server detected')
  
  const selection = await select({
    message: 'Select your LLM server:',
    options: LLM_OPTIONS,
  })
  
  let url: string
  if (String(selection) === 'other') {
    const textValue = await text({
      message: 'LLM Server URL',
      placeholder: 'http://localhost:8000/v1',
      initialValue: 'http://localhost:8000/v1',
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
    
    const config = {
      llm: { url, backend: backend as 'auto' | 'vllm' | 'sglang' | 'ollama' | 'llamacpp', model: model ?? 'auto', maxContext: 200000, disableThinking: false },
      server: { port: 10369, host: '127.0.0.1', openBrowser: true },
      logging: { level: 'info' as const },
      database: { path: '' },
    }
    await saveGlobalConfig(mode, config)
    
    outro('Configuration saved!')
  } catch (err) {
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
      return runInitWithSelect(mode)  // Recurse to retry
    } else if (choice === 'change') {
      return runInitWithSelect(mode)  // Recurse to change selection
    }
    // choice === 'continue' - save anyway with auto backend
    const config = {
      llm: { url, backend: 'auto' as const, model: 'auto', maxContext: 200000, disableThinking: false },
      server: { port: 10369, host: '127.0.0.1', openBrowser: true },
      logging: { level: 'info' as const },
      database: { path: '' },
    }
    await saveGlobalConfig(mode, config)
    outro('Configuration saved!')
  }
}
