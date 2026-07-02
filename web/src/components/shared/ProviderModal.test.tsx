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

    // Click "Next — Review"
    const nextButton = container.querySelector('[data-testid="provider-modal-next"]') as HTMLButtonElement | null
    if (nextButton) nextButton.click()

    // Wait for state update
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Click "Save Provider"
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

    // Click "Next — Review" to go to step 3
    const nextButton = container.querySelector('[data-testid="provider-modal-next"]') as HTMLButtonElement | null
    expect(nextButton).toBeTruthy()
    nextButton!.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Verify we're on step 3: save button visible
    const saveButton1 = container.querySelector('[data-testid="provider-modal-save"]')
    expect(saveButton1).toBeTruthy()
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

    // MUST still be on step 3 — save button still visible
    expect(container.querySelector('[data-testid="provider-modal-save"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="provider-modal-next"]')).toBeNull()
  })
})
