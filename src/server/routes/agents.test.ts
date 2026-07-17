import { describe, expect, it } from 'vitest'
import type { Provider } from '../../shared/types.js'
import { validateModelCascade } from './agents.js'

const providers: Provider[] = [
  {
    id: 'primary',
    name: 'Primary',
    url: 'http://localhost',
    backend: 'vllm',
    models: [{ id: 'model/a', contextWindow: 1000, source: 'user' }],
    isActive: true,
    createdAt: '',
  },
]

describe('agent model cascade validation', () => {
  it('accepts inheritance and a valid cascade', () => {
    expect(validateModelCascade({ metadata: {} }, providers)).toBeNull()
    expect(
      validateModelCascade({ metadata: { modelCascade: [{ providerId: 'primary', model: 'model/a' }] } }, providers),
    ).toBeNull()
  })

  it('rejects empty, duplicate, unknown provider, and unknown model entries', () => {
    expect(validateModelCascade({ metadata: { modelCascade: [] } }, providers)).toContain('non-empty')
    expect(
      validateModelCascade(
        {
          metadata: {
            modelCascade: [
              { providerId: 'primary', model: 'model/a' },
              { providerId: 'primary', model: 'model/a' },
            ],
          },
        },
        providers,
      ),
    ).toContain('duplicate')
    expect(
      validateModelCascade({ metadata: { modelCascade: [{ providerId: 'missing', model: 'model' }] } }, providers),
    ).toContain('Unknown provider')
    expect(
      validateModelCascade({ metadata: { modelCascade: [{ providerId: 'primary', model: 'missing' }] } }, providers),
    ).toContain('Unknown model')
  })
})
