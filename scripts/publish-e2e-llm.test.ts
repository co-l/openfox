import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { resolveLlmMode, resolveProdConfigPath, selectProdLlm, type ProdLlmSelection } from './publish-e2e-llm.js'

const provider = (overrides: Record<string, unknown> = {}) => ({
  name: 'DeepSeek API',
  url: 'https://api.deepseek.com',
  apiKey: 'sk-super-secret-key',
  isActive: true,
  models: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-flash', selected: true }],
  ...overrides,
})

describe('resolveLlmMode', () => {
  it('defaults to local when unset', () => {
    expect(resolveLlmMode(undefined)).toBe('local')
  })

  it('defaults to local when empty or whitespace', () => {
    expect(resolveLlmMode('')).toBe('local')
    expect(resolveLlmMode('   ')).toBe('local')
  })

  it('accepts local explicitly', () => {
    expect(resolveLlmMode('local')).toBe('local')
  })

  it('accepts prod (case-insensitive, trimmed)', () => {
    expect(resolveLlmMode('prod')).toBe('prod')
    expect(resolveLlmMode(' PROD ')).toBe('prod')
  })

  it('fails fast on an invalid value instead of silently using local', () => {
    expect(() => resolveLlmMode('prodd')).toThrow(/OPENFOX_PUBLISH_E2E_LLM/)
    expect(() => resolveLlmMode('true')).toThrow(/OPENFOX_PUBLISH_E2E_LLM/)
  })
})

describe('resolveProdConfigPath', () => {
  it('defaults to the prod config in the home directory', () => {
    expect(resolveProdConfigPath({}, '/home/conrad')).toBe(join('/home/conrad', '.config', 'openfox', 'config.json'))
  })

  it('honours the OPENFOX_PUBLISH_E2E_PROD_CONFIG override', () => {
    expect(resolveProdConfigPath({ OPENFOX_PUBLISH_E2E_PROD_CONFIG: '/tmp/other.json' }, '/home/conrad')).toBe(
      '/tmp/other.json',
    )
  })

  it('ignores a blank override', () => {
    expect(resolveProdConfigPath({ OPENFOX_PUBLISH_E2E_PROD_CONFIG: '  ' }, '/home/conrad')).toBe(
      join('/home/conrad', '.config', 'openfox', 'config.json'),
    )
  })
})

describe('selectProdLlm', () => {
  it('picks the active provider and its selected model', () => {
    const selection: ProdLlmSelection = selectProdLlm({ providers: [provider()] })
    expect(selection).toEqual({
      url: 'https://api.deepseek.com',
      apiKey: 'sk-super-secret-key',
      model: 'deepseek-flash',
    })
  })

  it('falls back to the first model when none is selected', () => {
    const config = { providers: [provider({ models: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-flash' }] })] }
    expect(selectProdLlm(config).model).toBe('deepseek-v4-pro')
  })

  it('skips inactive providers when no name filter is given', () => {
    const config = {
      providers: [
        provider({ name: 'Inactive', isActive: false, apiKey: 'sk-inactive' }),
        provider({ name: 'Active', isActive: true, apiKey: 'sk-active', url: 'https://active.example' }),
      ],
    }
    expect(selectProdLlm(config)).toEqual({
      url: 'https://active.example',
      apiKey: 'sk-active',
      model: 'deepseek-flash',
    })
  })

  it('matches the provider by name (case-insensitive) even when inactive', () => {
    const config = {
      providers: [
        provider({ name: 'DeepSeek API', isActive: false, apiKey: 'sk-deepseek' }),
        provider({ name: 'Other', isActive: true, apiKey: 'sk-other' }),
      ],
    }
    expect(selectProdLlm(config, 'deepseek api').apiKey).toBe('sk-deepseek')
  })

  it('throws when the requested provider name is not found', () => {
    expect(() => selectProdLlm({ providers: [provider()] }, 'Mistral')).toThrow(/Mistral/)
  })

  it('throws when no provider has an api key (e.g. credentialRef-only providers)', () => {
    const config = { providers: [provider({ apiKey: undefined, credentialRef: 'ref-1' })] }
    expect(() => selectProdLlm(config)).toThrow(/api key/i)
  })

  it('throws when no provider is active and no name filter is given', () => {
    expect(() => selectProdLlm({ providers: [provider({ isActive: false })] })).toThrow(/active/i)
  })

  it('throws when the selected provider has no url', () => {
    expect(() => selectProdLlm({ providers: [provider({ url: '' })] })).toThrow(/url/i)
  })

  it('throws when the selected provider has no models', () => {
    expect(() => selectProdLlm({ providers: [provider({ models: [] })] })).toThrow(/model/i)
  })

  it('throws on a malformed config', () => {
    expect(() => selectProdLlm(null)).toThrow(/providers/i)
    expect(() => selectProdLlm({})).toThrow(/providers/i)
    expect(() => selectProdLlm({ providers: 'nope' })).toThrow(/providers/i)
  })

  it('never leaks the api key in error messages', () => {
    const secret = 'sk-super-secret-key'
    const attempts = [
      () => selectProdLlm({ providers: [provider({ apiKey: secret, models: [] })] }),
      () => selectProdLlm({ providers: [provider({ apiKey: secret, url: '' })] }),
      () => selectProdLlm({ providers: [provider({ apiKey: secret, isActive: false })] }),
    ]
    for (const attempt of attempts) {
      try {
        attempt()
        throw new Error('expected selectProdLlm to throw')
      } catch (error) {
        expect((error as Error).message).not.toContain(secret)
      }
    }
  })
})
