// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { ProviderModal } from './ProviderModal'
import type { ProviderFormData } from './ProviderModal'

let container: HTMLElement
let root: ReturnType<typeof createRoot>
let onSaveMock: ReturnType<typeof vi.fn>

/** Mounts a fresh React root before each test in the calling suite and tears it down after. */
function setupRoot() {
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
}

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))

/** Renders the modal on step 2 with the shared onSave mock, then waits for its effects to settle. */
async function renderProviderModal(props: Partial<ComponentProps<typeof ProviderModal>> = {}, waitMs = 200) {
  root.render(
    <ProviderModal
      isOpen={true}
      onClose={vi.fn()}
      onSave={onSaveMock as (provider: ProviderFormData) => void}
      initialStep={2}
      {...props}
    />,
  )
  await tick(waitMs)
}

function providerWithModels(models: Array<Record<string, unknown>>) {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    url: 'http://localhost:8000/v1',
    backend: 'vllm' as const,
    models: models as never,
  }
}

function clickSave() {
  const saveButton = document.body.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
  saveButton?.click()
  return saveButton
}

const savedProvider = (): ProviderFormData => onSaveMock.mock.calls[0]![0]!

const buttonByText = (text: string) =>
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.trim() === text) as
    HTMLButtonElement | undefined

/** React controlled inputs only react to the native value setter followed by an 'input' event. */
function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('ProviderModal - thinkingLevel persistence', () => {
  setupRoot()

  const makeEditProvider = () =>
    providerWithModels([{ id: 'test-model', contextWindow: 200000, thinkingEnabled: true }])

  async function renderAndSave(thinkingLevel?: string) {
    const modelId = 'test-model'
    await renderProviderModal({ editProvider: makeEditProvider(), editModelId: modelId })

    // Find the reasoning effort input (free-text variant; the select variant is
    // matched via the same aria-label in other tests)
    const effortInput = document.body.querySelector('input[aria-label="Reasoning effort"]') as HTMLInputElement | null
    if (thinkingLevel !== undefined && effortInput) setInputValue(effortInput, thinkingLevel)

    // Click "Save Provider" (no separate review step anymore)
    clickSave()

    return { modelId }
  }

  it('includes thinkingLevel in save payload when user sets reasoning effort', async () => {
    const { modelId } = await renderAndSave('high')

    expect(onSaveMock).toHaveBeenCalledTimes(1)
    const savedModel = savedProvider().models.find((m) => m.id === modelId)
    expect(savedModel).toBeDefined()
    expect(savedModel?.thinkingLevel).toBe('high')
  })

  it('includes thinkingLevel in save payload even when user leaves default', async () => {
    const { modelId } = await renderAndSave(undefined)

    expect(onSaveMock).toHaveBeenCalledTimes(1)
    const savedModel = savedProvider().models.find((m) => m.id === modelId)
    expect(savedModel).toBeDefined()
    // No default thinkingLevel — auto-config or user sets it explicitly
    expect(savedModel?.thinkingLevel).toBeUndefined()
  })

  it('uses a constrained reasoning effort selector with medium as the provider default', async () => {
    await renderProviderModal({
      editProvider: {
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
      },
      editModelId: 'reasoning-model',
    })

    const effortSelect = document.body.querySelector(
      'select[aria-label="Reasoning effort"]',
    ) as HTMLSelectElement | null
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

    clickSave()

    expect(savedProvider().models.find((model) => model.id === 'reasoning-model')?.thinkingLevel).toBe('medium')
  })

  it('saves a provider reasoning effort selected from the catalog values', async () => {
    await renderProviderModal({
      editProvider: {
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
      },
      editModelId: 'reasoning-model',
    })

    const effortSelect = document.body.querySelector('select[aria-label="Reasoning effort"]') as HTMLSelectElement
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set?.call(effortSelect, 'high')
    effortSelect.dispatchEvent(new Event('change', { bubbles: true }))

    clickSave()

    expect(savedProvider().models.find((model) => model.id === 'reasoning-model')?.thinkingLevel).toBe('high')
  })

  it('includes all model fields in save payload', async () => {
    const { modelId } = await renderAndSave(undefined)

    expect(onSaveMock).toHaveBeenCalledTimes(1)
    const savedModel = savedProvider().models.find((m) => m.id === modelId)
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
    await renderProviderModal({
      editProvider: providerWithModels([
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
      ]),
      editModelId: 'test-model',
    })

    // Save immediately without touching any field — reopening the modal must not
    // silently reset previously-persisted advanced parameters to undefined/defaults.
    clickSave()

    expect(onSaveMock).toHaveBeenCalledTimes(1)
    const savedModel = savedProvider().models.find((m) => m.id === 'test-model')
    expect(savedModel).toBeDefined()
    expect(savedModel?.temperature).toBe(0.42)
    expect(savedModel?.topP).toBe(0.9)
    expect(savedModel?.topK).toBe(40)
    expect(savedModel?.maxTokens).toBe(2048)
    expect(savedModel?.compactionThreshold).toBe(0.7)
  })

  it('does not reset form step when editProvider reference changes (parent re-render)', async () => {
    await renderProviderModal({ editProvider: makeEditProvider(), editModelId: 'test-model' })

    // On step 2, the save button is visible (no separate review step)
    expect(document.body.querySelector('[data-testid="provider-modal-save"]')).toBeTruthy()
    expect(document.body.querySelector('[data-testid="provider-modal-next"]')).toBeNull()

    // Simulate parent re-render with new editProvider reference (identical data)
    await renderProviderModal({ editProvider: makeEditProvider(), editModelId: 'test-model' }, 100)

    // MUST still be on step 2 — save button still visible
    expect(document.body.querySelector('[data-testid="provider-modal-save"]')).toBeTruthy()
    expect(document.body.querySelector('[data-testid="provider-modal-next"]')).toBeNull()
  })

  it('prefills the catalog context window when a model is selected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ state: 'connected' }), { status: 200 })),
    )
    await renderProviderModal({
      editProvider: {
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
      },
    })

    const availableRows = Array.from(document.body.querySelectorAll('[role="checkbox"]'))
    const catalogRow = availableRows.find((row) => row.textContent?.includes('Catalog model')) as
      HTMLElement | undefined
    expect(catalogRow).toBeTruthy()
    catalogRow?.click()
    await tick()

    clickSave()

    expect(savedProvider().models.find((model) => model.id === 'catalog-model')).toEqual(
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

  it('adds a manually-entered model to the save payload when discovery returns no models', async () => {
    // Simulate a provider (e.g. Cline) that does not expose a /models endpoint.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/providers/models')) {
          return new Response(JSON.stringify({ error: 'No models found at http://localhost:8000/v1/models' }), {
            status: 404,
          })
        }
        return new Response(JSON.stringify({}), { status: 200 })
      }),
    )

    await renderProviderModal(
      {
        editProvider: {
          id: 'no-models-provider',
          name: 'No Models Provider',
          url: 'http://localhost:8000/v1',
          backend: 'openai',
          models: [],
        },
      },
      300,
    )

    // The manual model input is available even though discovery failed.
    const manualInput = document.body.querySelector(
      '[data-testid="provider-modal-manual-model-input"]',
    ) as HTMLInputElement
    expect(manualInput).toBeTruthy()

    setInputValue(manualInput, 'my-cline-model')

    const addButton = document.body.querySelector(
      '[data-testid="provider-modal-manual-model-add"]',
    ) as HTMLButtonElement | null
    addButton?.click()
    await tick()

    clickSave()

    expect(onSaveMock).toHaveBeenCalledTimes(1)
    const savedModel = savedProvider().models.find((m) => m.id === 'my-cline-model')
    expect(savedModel).toBeDefined()
    expect(savedModel?.selected).toBe(true)
    expect(savedModel?.contextWindow).toBe(200000)
  })

  it('rejects a duplicate manual model id and selects the existing one', async () => {
    await renderProviderModal({
      editProvider: {
        id: 'dup-provider',
        name: 'Dup Provider',
        url: 'http://localhost:8000/v1',
        backend: 'vllm',
        models: [{ id: 'existing-model', contextWindow: 200000 }],
      },
    })

    const manualInput = document.body.querySelector(
      '[data-testid="provider-modal-manual-model-input"]',
    ) as HTMLInputElement
    setInputValue(manualInput, 'existing-model')

    const addButton = document.body.querySelector(
      '[data-testid="provider-modal-manual-model-add"]',
    ) as HTMLButtonElement | null
    addButton?.click()
    await tick()

    // An error message is shown and the duplicate was not added.
    expect(document.body.textContent).toContain('already in the list')

    clickSave()

    // Only the original model is present — no duplicate.
    expect(savedProvider().models.filter((m) => m.id === 'existing-model')).toHaveLength(1)
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

    // Starts on step 1: the engine picker is only reachable from there.
    await renderProviderModal({ initialStep: undefined }, 100)

    buttonByText('Account Provider')?.click()
    await tick(0)
    buttonByText(engineName)?.click()
    await tick(0)

    const nextButton = document.body.querySelector('[data-testid="provider-modal-next"]') as HTMLButtonElement | null
    expect(nextButton?.disabled).toBe(false)
    nextButton?.click()
    await tick()

    clickSave()

    expect(onSaveMock).toHaveBeenCalledTimes(1)
    const savedData = savedProvider()
    expect(savedData.backend).toBe(expectedBackend)
    expect(savedData.authAdapter).toBeUndefined()
    expect(savedData.transportAdapter).toBeUndefined()
  })

  it('disables reasoning messages when auto-config detects a rejected history field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/providers/auto-config')) {
          return new Response(
            JSON.stringify({
              models: [
                {
                  id: 'test-model',
                  contextWindow: 200000,
                  supportsVision: false,
                  thinkingConfig: { reasoning_effort: 'high' },
                  nonThinkingConfig: null,
                  sendReasoningInMessages: false,
                },
              ],
            }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ presets: [] }), { status: 200 })
      }),
    )

    await renderProviderModal({ editProvider: makeEditProvider(), editModelId: 'test-model' })

    buttonByText('Auto-config')?.click()
    await tick()

    clickSave()

    expect(savedProvider().sendReasoningInMessages).toBe(false)
  })
})

describe('ProviderModal - sampling param Send checkboxes', () => {
  setupRoot()

  const renderModal = (models: Array<Record<string, unknown>>, editModelId?: string) =>
    renderProviderModal({ editProvider: providerWithModels(models), editModelId })

  function getSendCheckbox(paramKey: string): HTMLInputElement | null {
    return document.body.querySelector(`input[data-testid="send-${paramKey}"]`) as HTMLInputElement | null
  }

  function getParamInput(paramKey: string): HTMLInputElement | null {
    return document.body.querySelector(`input[data-testid="param-${paramKey}"]`) as HTMLInputElement | null
  }

  const savedTestModel = () => savedProvider().models.find((m) => m.id === 'test-model')

  it('renders Send checkboxes for Temperature, Top P, Top K, Max tokens checked by default', async () => {
    await renderModal([{ id: 'test-model', contextWindow: 200000 }], 'test-model')

    for (const key of ['temperature', 'top_p', 'top_k', 'max_tokens']) {
      const cb = getSendCheckbox(key)
      expect(cb, `checkbox for ${key} should exist`).toBeTruthy()
      expect(cb?.checked, `checkbox for ${key} should be checked by default`).toBe(true)
    }
  })

  it('unchecking Temperature adds temperature to omitParams and dims the input', async () => {
    await renderModal([{ id: 'test-model', contextWindow: 200000, temperature: 0.7 }], 'test-model')

    const cb = getSendCheckbox('temperature')
    expect(cb).toBeTruthy()
    cb!.click()

    const input = getParamInput('temperature')
    expect(input?.disabled).toBe(true)
    expect(input?.value).toBe('')

    clickSave()
    expect(savedTestModel()?.omitParams).toEqual(['temperature'])
  })

  it('re-checking Temperature removes it from omitParams', async () => {
    await renderModal([{ id: 'test-model', contextWindow: 200000 }], 'test-model')

    const cb = getSendCheckbox('temperature')!
    cb.click()
    cb.click()

    clickSave()
    expect(savedTestModel()?.omitParams).toBeUndefined()
  })

  it('preserves pre-existing omitParams entries (e.g. reasoning_effort) when toggling Temperature', async () => {
    await renderModal([{ id: 'test-model', contextWindow: 200000, omitParams: ['reasoning_effort'] }], 'test-model')

    const tempCb = getSendCheckbox('temperature')!
    expect(tempCb.checked).toBe(true)
    tempCb.click()

    clickSave()
    expect(savedTestModel()?.omitParams).toEqual(expect.arrayContaining(['reasoning_effort', 'temperature']))
    expect(savedTestModel()?.omitParams).toHaveLength(2)
  })

  it('reflects auto-config omitParams as unchecked boxes on modal open', async () => {
    await renderModal(
      [{ id: 'test-model', contextWindow: 200000, omitParams: ['temperature', 'top_p', 'top_k', 'reasoning_effort'] }],
      'test-model',
    )

    expect(getSendCheckbox('temperature')?.checked).toBe(false)
    expect(getSendCheckbox('top_p')?.checked).toBe(false)
    expect(getSendCheckbox('top_k')?.checked).toBe(false)
    expect(getSendCheckbox('max_tokens')?.checked).toBe(true)

    const tempInput = getParamInput('temperature')
    expect(tempInput?.disabled).toBe(true)

    clickSave()
    expect(savedTestModel()?.omitParams).toEqual(['temperature', 'top_p', 'top_k', 'reasoning_effort'])
  })

  it.each([true, false])(
    'shows a re-enable checkbox for reasoning_effort omitted by auto-config (thinkingEnabled: %s)',
    async (thinkingEnabled) => {
      await renderModal(
        [{ id: 'test-model', contextWindow: 200000, thinkingEnabled, omitParams: ['reasoning_effort'] }],
        'test-model',
      )

      const reEnableCb = document.body.querySelector(
        'input[data-testid="re-enable-reasoning_effort"]',
      ) as HTMLInputElement | null
      expect(reEnableCb).toBeTruthy()
      expect(reEnableCb?.checked).toBe(false)

      // Re-checking it removes the param from omitParams.
      reEnableCb!.click()

      clickSave()
      expect(savedTestModel()?.omitParams).toBeUndefined()
    },
  )
})

describe('ProviderModal - Provider-Level Defaults modal', () => {
  setupRoot()

  async function renderModalAndOpenDefaults() {
    await renderProviderModal({ editProvider: providerWithModels([{ id: 'test-model', contextWindow: 200000 }]) })

    const openButton = document.body.querySelector(
      'button[title="Provider-level defaults"]',
    ) as HTMLButtonElement | null
    expect(openButton).toBeTruthy()
    openButton!.click()
  }

  it('does not render hardcoded fake mode params fields', async () => {
    await renderModalAndOpenDefaults()

    const bodyText = document.body.textContent ?? ''
    expect(bodyText).not.toContain('Thinking mode params')
    expect(bodyText).not.toContain('Non-thinking mode params')
  })

  it('keeps real fields (thinking response field, send reasoning) functional', async () => {
    await renderModalAndOpenDefaults()

    const thinkingFieldInput = document.body.querySelector(
      'input[aria-label="Thinking response field"]',
    ) as HTMLInputElement | null
    expect(thinkingFieldInput).toBeTruthy()

    const sendReasoningLabel = Array.from(document.body.querySelectorAll('label')).find((l) =>
      l.textContent?.includes('Send reasoning in messages'),
    )
    expect(sendReasoningLabel).toBeTruthy()
    const sendReasoningCb = sendReasoningLabel?.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    expect(sendReasoningCb).toBeTruthy()
  })
})

describe('ProviderModal - effort presets and override editor', () => {
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
  })

  async function renderModal(models: Array<Record<string, unknown>>, editModelId?: string) {
    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSaveMock as (provider: ProviderFormData) => void}
          initialStep={2}
          editProvider={{
            id: 'test-provider',
            name: 'Test Provider',
            url: 'http://localhost:8000/v1',
            backend: 'vllm' as const,
            models: models as never,
          }}
          editModelId={editModelId}
        />,
      )
      setTimeout(resolve, 200)
    })
  }

  function save() {
    const saveButton = document.body.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()
  }

  /** Let React flush the discrete-event state update (no act() needed here). */
  function flush() {
    return new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  function setSelectValue(select: HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }

  it('adds and removes presets, sets an override, and saves the edited list', async () => {
    await renderModal(
      [
        {
          id: 'test-model',
          contextWindow: 200000,
          thinkingEnabled: true,
          reasoningEfforts: ['low', 'medium', 'high'],
        },
      ],
      'test-model',
    )

    // Remove 'high' from the presets.
    const removeHigh = document.body.querySelector(
      'button[aria-label="Remove preset high"]',
    ) as HTMLButtonElement | null
    expect(removeHigh).toBeTruthy()
    removeHigh?.click()
    await flush()

    // Add 'max' via the vocabulary selector.
    const addSelect = document.body.querySelector('select[aria-label="Add effort preset"]') as HTMLSelectElement | null
    expect(addSelect).toBeTruthy()
    setSelectValue(addSelect!, 'max')
    await flush()

    // Set the raw override (native setter — React controlled inputs ignore direct assignment).
    const overrideInput = document.body.querySelector(
      'input[aria-label="Reasoning effort override"]',
    ) as HTMLInputElement | null
    expect(overrideInput).toBeTruthy()
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    nativeInputValueSetter?.call(overrideInput, 'deep')
    overrideInput!.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    save()
    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    const savedModel = savedData.models.find((m) => m.id === 'test-model')
    expect(savedModel?.reasoningEfforts).toEqual(['low', 'medium', 'max'])
    expect(savedModel?.reasoningEffortOverride).toBe('deep')
  })

  it('reset to defaults clears the custom list and falls back to the stored presets', async () => {
    await renderModal(
      [
        {
          id: 'test-model',
          contextWindow: 200000,
          thinkingEnabled: true,
          reasoningEfforts: ['low', 'medium', 'high'],
        },
      ],
      'test-model',
    )

    // Make a custom edit first, then reset.
    const removeHigh = document.body.querySelector(
      'button[aria-label="Remove preset high"]',
    ) as HTMLButtonElement | null
    removeHigh?.click()
    await flush()

    const resetButton = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Reset to defaults'),
    )
    expect(resetButton).toBeTruthy()
    resetButton?.click()
    await flush()

    save()
    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    const savedModel = savedData.models.find((m) => m.id === 'test-model')
    // Falls back to the stored preset list (the catalog/model defaults).
    expect(savedModel?.reasoningEfforts).toEqual(['low', 'medium', 'high'])
  })

  it('reorders presets with the up/down controls', async () => {
    await renderModal(
      [
        {
          id: 'test-model',
          contextWindow: 200000,
          thinkingEnabled: true,
          reasoningEfforts: ['low', 'medium', 'high'],
        },
      ],
      'test-model',
    )

    // Move 'low' down (becomes second).
    const moveLowDown = document.body.querySelector(
      'button[aria-label="Move preset low down"]',
    ) as HTMLButtonElement | null
    expect(moveLowDown).toBeTruthy()
    moveLowDown?.click()
    await flush()

    // Move 'high' up (becomes second).
    const moveHighUp = document.body.querySelector(
      'button[aria-label="Move preset high up"]',
    ) as HTMLButtonElement | null
    expect(moveHighUp).toBeTruthy()
    moveHighUp?.click()
    await flush()

    save()
    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    const savedModel = savedData.models.find((m) => m.id === 'test-model')
    // ['low','medium','high'] → low down → ['medium','low','high'] → high up → ['medium','high','low']
    expect(savedModel?.reasoningEfforts).toEqual(['medium', 'high', 'low'])
  })

  it('removing every preset persists an explicitly-empty list (no chips) instead of resetting to defaults', async () => {
    await renderModal(
      [
        {
          id: 'test-model',
          contextWindow: 200000,
          thinkingEnabled: true,
          reasoningEfforts: ['low', 'medium'],
        },
      ],
      'test-model',
    )

    // Remove both chips — the list becomes explicitly empty, NOT reset to defaults.
    ;(document.body.querySelector('button[aria-label="Remove preset low"]') as HTMLElement | null)?.click()
    await flush()
    ;(document.body.querySelector('button[aria-label="Remove preset medium"]') as HTMLElement | null)?.click()
    await flush()

    save()
    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    const savedModel = savedData.models.find((m) => m.id === 'test-model')
    expect(savedModel?.reasoningEfforts).toEqual([])
  })

  it('an existing override is prefilled in the editor and survives a save untouched', async () => {
    await renderModal(
      [
        {
          id: 'test-model',
          contextWindow: 200000,
          thinkingEnabled: true,
          reasoningEfforts: ['low', 'medium', 'high'],
          reasoningEffortOverride: 'deep',
        },
      ],
      'test-model',
    )

    const overrideInput = document.body.querySelector(
      'input[aria-label="Reasoning effort override"]',
    ) as HTMLInputElement | null
    expect(overrideInput?.value).toBe('deep')

    save()
    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    const savedModel = savedData.models.find((m) => m.id === 'test-model')
    expect(savedModel?.reasoningEffortOverride).toBe('deep')
  })
})

describe('ProviderModal - small context window warning', () => {
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
  })

  async function renderModal(models: Array<Record<string, unknown>>) {
    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSaveMock as (provider: ProviderFormData) => void}
          initialStep={2}
          editProvider={{
            id: 'test-provider',
            name: 'Test Provider',
            url: 'http://localhost:8000/v1',
            backend: 'vllm' as const,
            models: models as never,
          }}
          editModelId="test-model"
        />,
      )
      setTimeout(resolve, 200)
    })
  }

  it('shows a warning when the context window is below the threshold', async () => {
    await renderModal([{ id: 'test-model', contextWindow: 8192 }])
    expect(document.body.querySelector('[data-small-context]')).not.toBeNull()
  })

  it('hides the warning when the context window is adequate', async () => {
    await renderModal([{ id: 'test-model', contextWindow: 32768 }])
    expect(document.body.querySelector('[data-small-context]')).toBeNull()
  })
})

describe('ProviderModal - model mode merge', () => {
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

  const omniModels = [
    { id: 'antigravity/gemini-3.6-flash-high', contextWindow: 1048576 },
    { id: 'antigravity/gemini-3.6-flash-low', contextWindow: 1048576 },
    { id: 'antigravity/gemini-3.6-flash-medium', contextWindow: 1048576 },
    { id: 'antigravity/claude-opus-4-6-thinking', contextWindow: 1048576 },
  ] as const

  async function renderOmni(editProviderModels: readonly unknown[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/provider-presets')) {
          return new Response(JSON.stringify({ presets: [] }), { status: 200 })
        }
        return new Response(JSON.stringify({ models: [], url: 'https://omniroute.example/v1' }), { status: 200 })
      }),
    )
    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSaveMock as (provider: ProviderFormData) => void}
          initialStep={2}
          editProvider={{
            id: 'omni-provider',
            name: 'OmniRoute',
            url: 'https://omniroute.example/v1',
            backend: 'openai' as const,
            models: editProviderModels as never,
          }}
        />,
      )
      setTimeout(resolve, 200)
    })
  }

  // Renders the ProviderModal in creation mode (no editProvider), navigates
  // step1 → step2 with a URL so the catalog is fetched and auto-collapsed into
  // mode-chip models.
  async function renderCreate() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/provider-presets')) {
          return new Response(JSON.stringify({ presets: [] }), { status: 200 })
        }
        if (url.includes('/models')) {
          return new Response(JSON.stringify({ models: omniModels, url: 'https://omniroute.example/v1' }), {
            status: 200,
          })
        }
        return new Response(JSON.stringify({ models: [], url: 'https://omniroute.example/v1' }), { status: 200 })
      }),
    )
    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSaveMock as (provider: ProviderFormData) => void}
          initialStep={1}
        />,
      )
      setTimeout(resolve, 200)
    })
    const urlInput = document.body.querySelector('[data-testid="provider-modal-url"]') as HTMLInputElement | null
    expect(urlInput).toBeTruthy()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(urlInput, 'https://omniroute.example/v1')
    urlInput!.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    ;(document.body.querySelector('[data-testid="provider-modal-next"]') as HTMLButtonElement | null)?.click()
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  it('creating a provider shows raw suffixed variants and a Merge button, no Unmerge', async () => {
    await renderCreate()
    // Raw catalog: suffixed variants shown separately.
    const hasSuffixed = Array.from(document.body.querySelectorAll('span,div')).some((el) =>
      el.textContent?.includes('gemini-3.6-flash-high'),
    )
    expect(hasSuffixed).toBe(true)
    // Merge button is visible; Unmerge is not (nothing merged yet).
    const mergeButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Merge gemini-3.6-flash'),
    )
    expect(mergeButton).toBeTruthy()
    const unmergeButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Unmerge '),
    )
    expect(unmergeButton).toBeUndefined()
  })

  it('editing keeps the raw catalog: suffixed variants present, Merge button shown', async () => {
    await renderOmni(omniModels)
    // No auto-merge: the merged id is absent and the suffixed members remain.
    const saveButton = document.body.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()
    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    expect(savedData.models.some((m) => m.id === 'antigravity/gemini-3.6-flash' && m.modes?.length)).toBe(false)
    expect(savedData.models.some((m) => m.id === 'antigravity/gemini-3.6-flash-high')).toBe(true)
    expect(savedData.models.some((m) => m.id === 'antigravity/gemini-3.6-flash-low')).toBe(true)
    // Merge button offered for the family.
    const mergeButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Merge gemini-3.6-flash'),
    )
    expect(mergeButton).toBeTruthy()
  })

  it('shows no Merge button when there are no mergeable families (single model)', async () => {
    await renderOmni([{ id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', contextWindow: 1048576 }])
    const anyMergeButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Merge '),
    )
    expect(anyMergeButton).toBeUndefined()
  })

  const mergedOmniModel = {
    id: 'antigravity/gemini-3.6-flash',
    name: 'gemini-3.6-flash',
    apiModelId: 'antigravity/gemini-3.6-flash',
    contextWindow: 1048576,
    reasoningEfforts: ['high', 'low', 'medium'],
    modes: [
      { level: 'high', apiModelId: 'antigravity/gemini-3.6-flash-high' },
      { level: 'low', apiModelId: 'antigravity/gemini-3.6-flash-low' },
      { level: 'medium', apiModelId: 'antigravity/gemini-3.6-flash-medium' },
    ],
  } as const
  const claudeOpusModel = { id: 'antigravity/claude-opus-4-6-thinking', contextWindow: 1048576 }
  const mergedProviderModels = [mergedOmniModel, claudeOpusModel] as const

  // Ensure at least 2 models so the "Available Models" block (which hosts the
  // merge/unmerge banner) renders.
  async function renderWithRawCatalog(editProviderModels: readonly unknown[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/provider-presets')) {
          return new Response(JSON.stringify({ presets: [] }), { status: 200 })
        }
        if (url.includes('/models')) {
          return new Response(JSON.stringify({ models: omniModels, url: 'https://omniroute.example/v1' }), {
            status: 200,
          })
        }
        return new Response(JSON.stringify({ models: [], url: 'https://omniroute.example/v1' }), { status: 200 })
      }),
    )
    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSaveMock as (provider: ProviderFormData) => void}
          initialStep={2}
          editProvider={{
            id: 'omni-provider',
            name: 'OmniRoute',
            url: 'https://omniroute.example/v1',
            backend: 'openai' as const,
            models: editProviderModels as never,
          }}
        />,
      )
      setTimeout(resolve, 200)
    })
  }

  it('does not re-fetch raw catalog over saved merged models (no merge button on edit)', async () => {
    // The fetch mock returns the raw suffixed catalog; if the edit path
    // re-fetched over the saved merged model, the merged entry would be lost
    // and Merge buttons would reappear.
    await renderWithRawCatalog(mergedProviderModels)
    // The merged model is still present, and no Merge button is shown.
    const saveButton = document.body.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()
    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    expect(savedData.models.some((m) => m.id === 'antigravity/gemini-3.6-flash' && m.modes?.length)).toBe(true)
    const mergeButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Merge gemini-3.6-flash'),
    )
    expect(mergeButton).toBeUndefined()
  })

  it('shows an Unmerge button for an already-merged model', async () => {
    await renderWithRawCatalog(mergedProviderModels)
    const unmergeButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Unmerge gemini-3.6-flash'),
    )
    expect(unmergeButton).toBeTruthy()
  })

  it('manual merge migrates selection from suffixed members to the merged model', async () => {
    // Edit provider where one suffixed member was selected; after a manual
    // Merge the merged model stays selected and the suffixed members are gone.
    await renderOmni([
      { id: 'antigravity/gemini-3.6-flash-high', contextWindow: 1048576, selected: true },
      { id: 'antigravity/gemini-3.6-flash-low', contextWindow: 1048576 },
      { id: 'antigravity/gemini-3.6-flash-medium', contextWindow: 1048576 },
    ])
    const mergeButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Merge gemini-3.6-flash'),
    )
    expect(mergeButton).toBeTruthy()
    mergeButton?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const saveButton = document.body.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()
    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    const merged = savedData.models.find((m) => m.id === 'antigravity/gemini-3.6-flash')
    expect(merged?.modes?.length).toBe(3)
    // Because a member was selected, the merged model is selected in the payload.
    expect(merged?.selected).toBe(true)
    expect(savedData.models.some((m) => m.id === 'antigravity/gemini-3.6-flash-high')).toBe(false)
  })

  it('manual merge on multi-family only selects the family whose member was selected', async () => {
    // Two families; only a gemini member is selected. After merging the gemini
    // family the gemini merged model is selected but the claude family is not.
    await renderOmni([
      { id: 'antigravity/gemini-3.6-flash-high', contextWindow: 1048576, selected: true },
      { id: 'antigravity/gemini-3.6-flash-low', contextWindow: 1048576 },
      { id: 'antigravity/gemini-3.6-flash-medium', contextWindow: 1048576 },
      { id: 'antigravity/claude-opus-4-6-thinking-low', contextWindow: 1048576 },
      { id: 'antigravity/claude-opus-4-6-thinking-high', contextWindow: 1048576 },
    ])
    const geminiMerge = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Merge gemini-3.6-flash'),
    )
    expect(geminiMerge).toBeTruthy()
    geminiMerge?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const saveButton = document.body.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()
    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    const geminiMerged = savedData.models.find((m) => m.id === 'antigravity/gemini-3.6-flash')
    const claudeMerged = savedData.models.find((m) => m.id === 'antigravity/claude-opus-4-6-thinking')
    expect(geminiMerged?.modes?.length).toBe(3)
    // Claude family was not merged, so it stays as separate variants.
    expect(claudeMerged?.modes?.length).toBeUndefined()
    // Only the gemini family (which had a selected member) is selected.
    expect(geminiMerged?.selected).toBe(true)
    expect(savedData.models.some((m) => m.id === 'antigravity/gemini-3.6-flash-high')).toBe(false)
  })

  it('unmerges a merged model back into its suffixed members in the save payload', async () => {
    await renderWithRawCatalog(mergedProviderModels)
    const unmergeButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Unmerge gemini-3.6-flash'),
    )
    expect(unmergeButton).toBeTruthy()
    unmergeButton?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    // After unmerge a Merge button for the re-expanded family must appear
    // (the suffixed variants are once again present in the list).
    const mergeButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Merge gemini-3.6-flash'),
    )
    expect(mergeButton).toBeTruthy()

    const saveButton = document.body.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()

    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    // The merged entry is gone; the suffixed members are restored.
    expect(savedData.models.some((m) => m.id === 'antigravity/gemini-3.6-flash' && m.modes?.length)).toBe(false)
    const levels = ['high', 'low', 'medium']
    for (const level of levels) {
      expect(savedData.models.some((m) => m.id === `antigravity/gemini-3.6-flash-${level}`)).toBe(true)
    }
  })

  it('re-merges an unmerged family back into a mode-chip model (Merge button disappears)', async () => {
    await renderWithRawCatalog(mergedProviderModels)
    const unmergeButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Unmerge gemini-3.6-flash'),
    )
    expect(unmergeButton).toBeTruthy()
    unmergeButton?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const mergeButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Merge gemini-3.6-flash'),
    )
    expect(mergeButton).toBeTruthy()
    mergeButton?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Merge button must disappear again after re-merging.
    const mergeAfter = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Merge gemini-3.6-flash'),
    )
    expect(mergeAfter).toBeUndefined()

    const saveButton = document.body.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()

    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    // Family collapsed back into a single mode-chip model.
    const merged = savedData.models.find((m) => m.id === 'antigravity/gemini-3.6-flash')
    expect(merged?.modes?.map((mode) => mode.level)).toEqual(['low', 'medium', 'high'])
    expect(savedData.models.some((m) => m.id === 'antigravity/gemini-3.6-flash-high')).toBe(false)
  })

  it('displays merged modes in parentheses in the Available Models list', async () => {
    await renderWithRawCatalog(mergedProviderModels)
    const availableModelsList = document.body.querySelectorAll('[role="checkbox"]')
    const geminiCheckbox = Array.from(availableModelsList).find((el) => el.textContent?.includes('gemini-3.6-flash'))
    expect(geminiCheckbox).toBeTruthy()
    expect(geminiCheckbox?.textContent).toContain('(high, low, medium)')
  })

  it('renders a Sync button next to Select all that refetches models without expanding collapsed models', async () => {
    await renderWithRawCatalog(mergedProviderModels)
    // Collapse any expanded model
    const header = document.body.querySelector(
      '.bg-bg-primary.border.border-border .cursor-pointer',
    ) as HTMLElement | null
    header?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const syncButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.trim().includes('Sync'),
    )
    expect(syncButton).toBeTruthy()
    syncButton?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(global.fetch).toHaveBeenCalled()
    // ModelConfigPanel should remain collapsed (e.g. no Context window input visible)
    const contextInput = document.body.querySelector('input[type="number"]')
    expect(contextInput).toBeNull()
  })

  it('syncing discovers new models, adding them to Available Models without adding them to Selected Models', async () => {
    const initialModels = [
      { id: 'model-a', contextWindow: 128000, selected: true },
      { id: 'model-b', contextWindow: 200000, selected: false },
    ]
    const fetchedCatalog = [
      { id: 'model-a', contextWindow: 128000 },
      { id: 'model-b', contextWindow: 200000 },
      { id: 'model-c-new', contextWindow: 256000 },
    ]

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/provider-presets')) {
          return new Response(JSON.stringify({ presets: [] }), { status: 200 })
        }
        if (url.includes('/models')) {
          return new Response(JSON.stringify({ models: fetchedCatalog, url: 'http://localhost:8000/v1' }), {
            status: 200,
          })
        }
        return new Response(JSON.stringify({ models: [], url: 'http://localhost:8000/v1' }), { status: 200 })
      }),
    )

    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSaveMock as (provider: ProviderFormData) => void}
          editProvider={{
            id: 'test-provider',
            name: 'Test Provider',
            url: 'http://localhost:8000/v1',
            backend: 'vllm',
            models: initialModels as never,
          }}
          initialStep={2}
        />,
      )
      setTimeout(resolve, 200)
    })

    const syncButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.trim().includes('Sync'),
    )
    expect(syncButton).toBeTruthy()
    syncButton?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Click Save Provider
    const saveButton = document.body.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()

    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    // model-a remains selected
    const modelA = savedData.models.find((m) => m.id === 'model-a')
    expect(modelA?.selected).toBe(true)

    // model-b was not selected and remains unselected
    const modelB = savedData.models.find((m) => m.id === 'model-b')
    expect(modelB?.selected).toBeUndefined()

    // model-c-new is added to models but is NOT selected
    const modelC = savedData.models.find((m) => m.id === 'model-c-new')
    expect(modelC).toBeDefined()
    expect(modelC?.selected).toBeUndefined()
  })

  it('syncing with merged mode models does not duplicate models in Selected Models', async () => {
    const initialModels = [
      {
        id: 'claude-opus-4-6-thinking',
        contextWindow: 1048576,
        selected: true,
        modes: [
          { level: 'low', apiModelId: 'claude-opus-4-6-thinking-low' },
          { level: 'high', apiModelId: 'claude-opus-4-6-thinking-high' },
        ],
      },
      { id: 'gemini-3.7-flash', contextWindow: 1048576, selected: true },
    ]
    const fetchedCatalog = [
      { id: 'claude-opus-4-6-thinking', contextWindow: 1048576 },
      { id: 'gemini-3.7-flash', contextWindow: 1048576 },
      { id: 'gemini-3.1-pro', contextWindow: 1048576 },
    ]

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/provider-presets')) {
          return new Response(JSON.stringify({ presets: [] }), { status: 200 })
        }
        if (url.includes('/models')) {
          return new Response(JSON.stringify({ models: fetchedCatalog, url: 'http://localhost:8000/v1' }), {
            status: 200,
          })
        }
        return new Response(JSON.stringify({ models: [], url: 'http://localhost:8000/v1' }), { status: 200 })
      }),
    )

    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSaveMock as (provider: ProviderFormData) => void}
          editProvider={{
            id: 'test-provider',
            name: 'Test Provider',
            url: 'http://localhost:8000/v1',
            backend: 'vllm',
            models: initialModels as never,
          }}
          initialStep={2}
        />,
      )
      setTimeout(resolve, 200)
    })

    const syncButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.trim().includes('Sync'),
    )
    expect(syncButton).toBeTruthy()
    syncButton?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const saveButton = document.body.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()

    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    const opusInstances = savedData.models.filter((m) => m.id === 'claude-opus-4-6-thinking')
    expect(opusInstances.length).toBe(1)
    expect(opusInstances[0]?.modes).toBeDefined()
    expect(opusInstances[0]?.selected).toBe(true)

    // gemini-3.1-pro was newly discovered, so it is in available models but NOT selected
    const geminiPro = savedData.models.find((m) => m.id === 'gemini-3.1-pro')
    expect(geminiPro).toBeDefined()
    expect(geminiPro?.selected).toBeUndefined()

    // Total models saved should be 3 (claude-opus, gemini-flash, gemini-pro)
    expect(savedData.models.length).toBe(3)
  })

  it('syncing when backend returns a single new model does not auto-select it for an existing provider with multiple models', async () => {
    const initialModels = [
      { id: 'model-a', contextWindow: 128000, selected: true },
      { id: 'model-b', contextWindow: 200000, selected: false },
    ]
    const singleModelCatalog = [{ id: 'model-a', contextWindow: 128000 }]

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/provider-presets')) {
          return new Response(JSON.stringify({ presets: [] }), { status: 200 })
        }
        if (url.includes('/models')) {
          return new Response(JSON.stringify({ models: singleModelCatalog, url: 'http://localhost:8000/v1' }), {
            status: 200,
          })
        }
        return new Response(JSON.stringify({ models: [], url: 'http://localhost:8000/v1' }), { status: 200 })
      }),
    )

    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSaveMock as (provider: ProviderFormData) => void}
          editProvider={{
            id: 'test-provider',
            name: 'Test Provider',
            url: 'http://localhost:8000/v1',
            backend: 'vllm',
            models: initialModels as never,
          }}
          initialStep={2}
        />,
      )
      setTimeout(resolve, 200)
    })

    const syncButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.trim().includes('Sync'),
    )
    expect(syncButton).toBeTruthy()
    syncButton?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const saveButton = document.body.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()

    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    expect(savedData.models.find((m) => m.id === 'model-a')?.selected).toBe(true)
    expect(savedData.models.some((m) => m.id === 'model-b')).toBe(false)
  })

  it('syncing removes deleted models from Available Models and Selected Models', async () => {
    const initialModels = [
      { id: 'model-kept', contextWindow: 128000, selected: true },
      { id: 'model-removed', contextWindow: 200000, selected: true },
      { id: 'model-unselected-removed', contextWindow: 200000, selected: false },
    ]
    const updatedCatalog = [{ id: 'model-kept', contextWindow: 128000 }]

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/provider-presets')) {
          return new Response(JSON.stringify({ presets: [] }), { status: 200 })
        }
        if (url.includes('/models')) {
          return new Response(JSON.stringify({ models: updatedCatalog, url: 'http://localhost:8000/v1' }), {
            status: 200,
          })
        }
        return new Response(JSON.stringify({ models: [], url: 'http://localhost:8000/v1' }), { status: 200 })
      }),
    )

    await new Promise<void>((resolve) => {
      root.render(
        <ProviderModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSaveMock as (provider: ProviderFormData) => void}
          editProvider={{
            id: 'test-provider',
            name: 'Test Provider',
            url: 'http://localhost:8000/v1',
            backend: 'vllm',
            models: initialModels as never,
          }}
          initialStep={2}
        />,
      )
      setTimeout(resolve, 200)
    })

    const syncButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.trim().includes('Sync'),
    )
    expect(syncButton).toBeTruthy()
    syncButton?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const saveButton = document.body.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
    saveButton?.click()

    const savedData: ProviderFormData = onSaveMock.mock.calls[0]![0]!
    expect(savedData.models.length).toBe(1)
    expect(savedData.models[0]?.id).toBe('model-kept')
    expect(savedData.models[0]?.selected).toBe(true)
  })
})
