// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { ProviderModal } from './ProviderModal'
import type { ProviderFormData } from './ProviderModal'

describe('ProviderModal - thinkingLevel persistence', () => {
  let container: HTMLElement
  let root: ReturnType<typeof createRoot>
  let onSaveMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onSaveMock = vi.fn()
  })

  afterEach(() => {
    root.unmount()
    document.body.removeChild(container)
    vi.unstubAllGlobals()
  })

  function makeEditProvider() {
    return {
      id: 'test-provider',
      name: 'Test Provider',
      url: 'http://localhost:8000/v1',
      backend: 'vllm' as const,
      models: [
        {
          id: 'test-model',
          contextWindow: 200000,
          thinkingEnabled: true,
        },
      ],
    }
  }

  async function renderAndSave(thinkingLevel?: string) {
    const modelId = 'test-model'
    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSaveMock as (provider: ProviderFormData) => void}
          initialStep={2}
          editProvider={makeEditProvider()}
          editModelId={modelId}
        />,
      )
      // Wait for useEffect to initialize modelConfigs from editProvider
      setTimeout(resolve, 200)
    })

    // Find the reasoning effort input (shows 'max' as default)
    const effortInput = container.querySelector('input[type="text"]') as HTMLInputElement | null

    if (thinkingLevel !== undefined && effortInput) {
      // React controlled components listen to 'input' event with native setter
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      nativeInputValueSetter?.call(effortInput, thinkingLevel)
      effortInput.dispatchEvent(new Event('input', { bubbles: true }))
    }

    // Click "Save Provider" (no separate review step anymore)
    const saveButton = container.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    if (saveButton) saveButton.click()

    return { modelId }
  }

  it('includes thinkingLevel in save payload when user sets reasoning effort', async () => {
    const { modelId } = await renderAndSave('high')

    expect(onSaveMock).toHaveBeenCalledTimes(1)
    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    const savedModel = savedData.models.find((m) => m.id === modelId)
    expect(savedModel).toBeDefined()
    expect(savedModel?.thinkingLevel).toBe('high')
  })

  it('includes thinkingLevel in save payload even when user leaves default', async () => {
    const { modelId } = await renderAndSave(undefined)

    expect(onSaveMock).toHaveBeenCalledTimes(1)
    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    const savedModel = savedData.models.find((m) => m.id === modelId)
    expect(savedModel).toBeDefined()
    // No default thinkingLevel — auto-config or user sets it explicitly
    expect(savedModel?.thinkingLevel).toBeUndefined()
  })

  it('uses a constrained reasoning effort selector with medium as the provider default', async () => {
    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSaveMock as (provider: ProviderFormData) => void}
          initialStep={2}
          editProvider={{
            id: 'external-provider',
            name: 'External Account Provider',
            url: 'http://localhost:8000/v1',
            backend: 'openai',
            models: [
              {
                id: 'reasoning-model',
                contextWindow: 1_050_000,
                thinkingEnabled: true,
                reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
              },
            ],
          }}
          editModelId="reasoning-model"
        />,
      )
      setTimeout(resolve, 200)
    })

    const effortSelect = container.querySelector('select[aria-label="Reasoning effort"]') as HTMLSelectElement | null
    expect(effortSelect).toBeTruthy()
    expect(effortSelect?.value).toBe('medium')
    expect(Array.from(effortSelect?.options ?? []).map((option) => option.value)).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])

    const saveButton = container.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()

    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    expect(savedData.models.find((model) => model.id === 'reasoning-model')?.thinkingLevel).toBe('medium')
  })

  it('saves a provider reasoning effort selected from the catalog values', async () => {
    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSaveMock as (provider: ProviderFormData) => void}
          initialStep={2}
          editProvider={{
            id: 'external-provider',
            name: 'External Account Provider',
            url: 'http://localhost:8000/v1',
            backend: 'openai',
            models: [
              {
                id: 'reasoning-model',
                contextWindow: 1_050_000,
                thinkingEnabled: true,
                reasoningEfforts: ['low', 'medium', 'high'],
              },
            ],
          }}
          editModelId="reasoning-model"
        />,
      )
      setTimeout(resolve, 200)
    })

    const effortSelect = container.querySelector('select[aria-label="Reasoning effort"]') as HTMLSelectElement
    const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
    nativeSelectValueSetter?.call(effortSelect, 'high')
    effortSelect.dispatchEvent(new Event('change', { bubbles: true }))

    const saveButton = container.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()

    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    expect(savedData.models.find((model) => model.id === 'reasoning-model')?.thinkingLevel).toBe('high')
  })

  it('includes all model fields in save payload', async () => {
    const { modelId } = await renderAndSave(undefined)

    expect(onSaveMock).toHaveBeenCalledTimes(1)
    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    const savedModel = savedData.models.find((m) => m.id === modelId)
    expect(savedModel).toBeDefined()

    // Every field the UI can set must be present in the save payload.
    // If you add a new model field to the UI, add it here too.
    const expectedFields = [
      'id',
      'contextWindow',
      'supportsVision',
      'thinkingEnabled',
      'thinkingLevel',
      'nonThinkingEnabled',
      'thinkingQueryParams',
      'nonThinkingQueryParams',
      'temperature',
      'topP',
      'topK',
      'maxTokens',
    ] as const

    for (const field of expectedFields) {
      expect(savedModel).toHaveProperty(field)
    }
  })

  it('preserves previously-saved advanced parameters when reopening the modal', async () => {
    const editProvider = {
      id: 'test-provider',
      name: 'Test Provider',
      url: 'http://localhost:8000/v1',
      backend: 'vllm' as const,
      models: [
        {
          id: 'test-model',
          contextWindow: 200000,
          thinkingEnabled: true,
          temperature: 0.42,
          topP: 0.9,
          topK: 40,
          maxTokens: 2048,
          compactionThreshold: 0.7,
        },
      ],
    }

    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSaveMock as (provider: ProviderFormData) => void}
          initialStep={2}
          editProvider={editProvider}
          editModelId="test-model"
        />,
      )
      setTimeout(resolve, 200)
    })

    // Save immediately without touching any field — reopening the modal must not
    // silently reset previously-persisted advanced parameters to undefined/defaults.
    const saveButton = container.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()

    expect(onSaveMock).toHaveBeenCalledTimes(1)
    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    const savedModel = savedData.models.find((m) => m.id === 'test-model')
    expect(savedModel).toBeDefined()
    expect(savedModel?.temperature).toBe(0.42)
    expect(savedModel?.topP).toBe(0.9)
    expect(savedModel?.topK).toBe(40)
    expect(savedModel?.maxTokens).toBe(2048)
    expect(savedModel?.compactionThreshold).toBe(0.7)
  })

  it('does not reset form step when editProvider reference changes (parent re-render)', async () => {
    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSaveMock as (provider: ProviderFormData) => void}
          initialStep={2}
          editProvider={makeEditProvider()}
          editModelId="test-model"
        />,
      )
      setTimeout(resolve, 200)
    })

    // On step 2, the save button is visible (no separate review step)
    const saveButton = container.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    expect(saveButton).toBeTruthy()
    expect(container.querySelector('[data-testid="provider-modal-next"]')).toBeNull()

    // Simulate parent re-render with new editProvider reference (identical data)
    root.render(
      <ProviderModal
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSaveMock as (provider: ProviderFormData) => void}
        initialStep={2}
        editProvider={makeEditProvider()}
        editModelId="test-model"
      />,
    )
    await new Promise((resolve) => setTimeout(resolve, 100))

    // MUST still be on step 2 — save button still visible
    expect(container.querySelector('[data-testid="provider-modal-save"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="provider-modal-next"]')).toBeNull()
  })
  it('prefills the catalog context window when a model is selected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ state: 'connected' }), { status: 200 })),
    )
    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSaveMock as (provider: ProviderFormData) => void}
          initialStep={2}
          editProvider={{
            id: 'provider-1',
            name: 'External Provider',
            url: 'https://provider.example/v1',
            backend: 'openai',
            transportAdapter: 'example-transport',
            models: [
              { id: 'selected-model', contextWindow: 1050000, selected: true },
              {
                id: 'catalog-model',
                name: 'Catalog model',
                apiModelId: 'catalog-model',
                requestBody: { service_tier: 'priority' },
                reasoningEfforts: ['low', 'high'],
                contextWindow: 400000,
              },
            ],
          }}
        />,
      )
      setTimeout(resolve, 200)
    })

    const availableRows = Array.from(container.querySelectorAll('[role="checkbox"]'))
    const catalogRow = availableRows.find((row) => row.textContent?.includes('Catalog model')) as
      | HTMLElement
      | undefined
    expect(catalogRow).toBeTruthy()
    catalogRow?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const saveButton = container.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()

    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    expect(savedData.models.find((model) => model.id === 'catalog-model')).toEqual(
      expect.objectContaining({
        name: 'Catalog model',
        apiModelId: 'catalog-model',
        requestBody: { service_tier: 'priority' },
        reasoningEfforts: ['low', 'high'],
        contextWindow: 400000,
        selected: true,
      }),
    )
  })

  it.each([
    ['Ollama', 'ollama'],
    ['Other', 'unknown'],
  ])('clears preset adapters when switching to %s', async (engineName, expectedBackend) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/provider-presets')) {
          return new Response(
            JSON.stringify({
              presets: [
                {
                  id: 'account-provider',
                  name: 'Account Provider',
                  defaults: {
                    name: 'Account Provider',
                    url: 'https://provider.example/api',
                    backend: 'openai',
                  },
                  authAdapter: 'account-auth',
                  transportAdapter: 'custom-transport',
                },
              ],
            }),
            { status: 200 },
          )
        }
        if (url.includes('/api/providers/models')) {
          return new Response(JSON.stringify({ models: [], url: 'http://localhost:11434' }), { status: 200 })
        }
        return new Response(JSON.stringify({}), { status: 200 })
      }),
    )

    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal isOpen={true} onClose={vi.fn()} onSave={onSaveMock as (provider: ProviderFormData) => void} />,
      )
      setTimeout(resolve, 100)
    })

    const buttonByText = (text: string) =>
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === text) as
        | HTMLButtonElement
        | undefined

    buttonByText('Account Provider')?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    buttonByText(engineName)?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const nextButton = container.querySelector('[data-testid="provider-modal-next"]') as HTMLButtonElement | null
    expect(nextButton?.disabled).toBe(false)
    nextButton?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const saveButton = container.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()

    expect(onSaveMock).toHaveBeenCalledTimes(1)
    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    expect(savedData.backend).toBe(expectedBackend)
    expect(savedData.authAdapter).toBeUndefined()
    expect(savedData.transportAdapter).toBeUndefined()
  })
})
