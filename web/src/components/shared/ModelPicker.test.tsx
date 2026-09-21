// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { ModelPicker } from './ModelPicker'
import type { Provider } from '../../stores/config'

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(),
}))

vi.mock('../shared/ProviderModal', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react')
  return {
    ProviderModal: ({ editProvider, onSave }: any) =>
      React.createElement(
        'div',
        { 'data-testid': 'provider-modal', 'data-provider-id': editProvider?.id ?? '' },
        React.createElement(
          'button',
          { onClick: () => onSave?.({ id: editProvider?.id, name: 'Saved Provider' }) },
          'save provider',
        ),
      ),
    providerFormPayload: (data: any) => data,
  }
})

const mockProviders: Provider[] = [
  {
    id: 'provider-1',
    name: 'Local',
    backend: 'vllm',
    url: 'http://localhost:8000',
    isActive: true,
    isLocal: true,
    models: [
      { id: 'qwen3-coder', contextWindow: 32000, source: 'backend' },
      { id: 'deepseek-coder', contextWindow: 128000, source: 'backend' },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'provider-2',
    name: 'Cloud',
    backend: 'openai',
    url: 'https://api.openai.com',
    isActive: false,
    isLocal: false,
    models: [{ id: 'gpt-4o', contextWindow: 128000, source: 'backend' }],
    createdAt: '2024-01-01T00:00:00.000Z',
  },
]

function dropdownHtml(): string {
  return document.body.innerHTML
}

describe('ModelPicker', () => {
  let container: HTMLElement
  let root: ReturnType<typeof createRoot>
  let onChangeMock: (value: string | undefined) => void

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onChangeMock = vi.fn() as (value: string | undefined) => void
  })

  afterEach(() => {
    root.unmount()
    document.body.removeChild(container)
    vi.unstubAllGlobals()
  })

  function render(value: string | undefined) {
    act(() => {
      root.render(<ModelPicker providers={mockProviders} value={value} onChange={onChangeMock} />)
    })
  }

  it('test setup works', () => {
    const el = document.createElement('div')
    el.textContent = 'Hello'
    container.appendChild(el)
    expect(container.innerHTML).toContain('Hello')
  })

  it('renders with default option when value is undefined', () => {
    render(undefined)
    expect(container.innerHTML).toContain('Default')
  })

  it('shows selected model name when value is set', () => {
    render('provider-1/qwen3-coder')
    expect(container.innerHTML).toContain('qwen3')
  })

  it('opens dropdown on click', () => {
    render(undefined)
    const btn = container.querySelector('button')!
    act(() => {
      btn.click()
    })
    expect(dropdownHtml()).toContain('Local')
    expect(dropdownHtml()).toContain('Cloud')
  })

  it('calls onChange with undefined when default is clicked', () => {
    render('provider-1/qwen3-coder')
    const btn = container.querySelector('button')!
    act(() => {
      btn.click()
    })
    const defaultOption = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Default'),
    )
    act(() => {
      defaultOption?.click()
    })
    expect(onChangeMock).toHaveBeenCalledWith(undefined)
  })

  it('calls onChange with provider/model when model is clicked', () => {
    render(undefined)
    const btn = container.querySelector('button')!
    act(() => {
      btn.click()
    })
    const modelBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('qwen3'))
    act(() => {
      modelBtn?.click()
    })
    expect(onChangeMock).toHaveBeenCalledWith('provider-1/qwen3-coder')
  })

  it('filters models by search query', () => {
    render(undefined)
    const btn = container.querySelector('button')!
    act(() => {
      btn.click()
    })
    const input = document.body.querySelector('input[type="text"]') as HTMLInputElement
    if (input) {
      act(() => {
        input.value = 'deepseek'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    expect(dropdownHtml()).toContain('deepseek')
    expect(dropdownHtml()).not.toContain('qwen3')
  })

  it('shows context window for each model', () => {
    render(undefined)
    const btn = container.querySelector('button')!
    act(() => {
      btn.click()
    })
    expect(dropdownHtml()).toContain('32K')
    expect(dropdownHtml()).toContain('128K')
  })

  it('shows the effort suffix in the selected label when value includes one', () => {
    render('provider-1/qwen3-coder:high')
    expect(container.innerHTML).toContain('qwen3')
    expect(container.innerHTML).toContain(':high')
  })

  it('keeps a colon in the model id when the suffix is not an effort', () => {
    render('provider-1/deepseek-r1:70b')
    expect(container.innerHTML).toContain('deepseek r1:70b')
  })

  it('renders effort chips and clicking one calls onChange with provider/model:effort', () => {
    const providerWithEfforts: Provider = {
      ...mockProviders[0]!,
      models: [
        {
          id: 'qwen3-coder',
          contextWindow: 32000,
          source: 'backend',
          reasoningEfforts: ['low', 'medium', 'high'],
          thinkingEnabled: true,
          thinkingLevel: 'medium',
        },
      ],
    }
    act(() => {
      root.render(<ModelPicker providers={[providerWithEfforts]} value={undefined} onChange={onChangeMock} />)
    })
    const btn = container.querySelector('button')!
    act(() => {
      btn.click()
    })
    const chip = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'high')
    expect(chip).toBeTruthy()
    act(() => {
      chip?.click()
    })
    expect(onChangeMock).toHaveBeenCalledWith('provider-1/qwen3-coder:high')
  })

  it('preserves the effort when re-clicking the same model (does not silently drop it)', () => {
    render('provider-1/qwen3-coder:high')
    const btn = container.querySelector('button')!
    act(() => {
      btn.click()
    })
    const rowBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'qwen3 coder',
    )
    expect(rowBtn).toBeTruthy()
    act(() => {
      rowBtn?.click()
    })
    expect(onChangeMock).toHaveBeenCalledWith('provider-1/qwen3-coder:high')
  })

  it('resets the effort when clicking a different model', () => {
    render('provider-1/qwen3-coder:high')
    const btn = container.querySelector('button')!
    act(() => {
      btn.click()
    })
    const otherRow = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'deepseek coder',
    )
    act(() => {
      otherRow?.click()
    })
    expect(onChangeMock).toHaveBeenCalledWith('provider-1/deepseek-coder')
  })

  it('shows the model reasoningEffortOverride as the fallback effort in the label', () => {
    const providerWithOverride: Provider = {
      ...mockProviders[0]!,
      models: [
        {
          id: 'qwen3-coder',
          contextWindow: 32000,
          source: 'backend',
          reasoningEfforts: ['low', 'medium', 'high'],
          thinkingEnabled: true,
          thinkingLevel: 'medium',
          reasoningEffortOverride: 'deep',
        },
      ],
    }
    act(() => {
      root.render(
        <ModelPicker providers={[providerWithOverride]} value={'provider-1/qwen3-coder'} onChange={onChangeMock} />,
      )
    })
    // No explicit effort in the value — the override is shown as the effective default.
    expect(container.innerHTML).toContain(':deep')
  })

  it('an explicit effort in the value wins over the override in the label', () => {
    const providerWithOverride: Provider = {
      ...mockProviders[0]!,
      models: [
        {
          id: 'qwen3-coder',
          contextWindow: 32000,
          source: 'backend',
          reasoningEffortOverride: 'deep',
        },
      ],
    }
    act(() => {
      root.render(
        <ModelPicker
          providers={[providerWithOverride]}
          value={'provider-1/qwen3-coder:high'}
          onChange={onChangeMock}
        />,
      )
    })
    expect(container.innerHTML).toContain(':high')
    expect(container.innerHTML).not.toContain(':deep')
  })

  it('renders an edit provider button on each provider group header', () => {
    render(undefined)
    const btn = container.querySelector('button')!
    act(() => {
      btn.click()
    })
    const editButtons = Array.from(document.body.querySelectorAll('button')).filter((b) =>
      b.getAttribute('aria-label')?.startsWith('Edit provider'),
    )
    expect(editButtons).toHaveLength(2)
  })

  it('opens the provider modal with the clicked provider when editing', () => {
    render(undefined)
    const btn = container.querySelector('button')!
    act(() => {
      btn.click()
    })
    const editButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.getAttribute('aria-label')?.includes('Cloud'),
    )
    act(() => {
      editButton?.click()
    })
    const modal = document.body.querySelector('[data-testid="provider-modal"]')
    expect(modal).toBeTruthy()
    expect(modal?.getAttribute('data-provider-id')).toBe('provider-2')
  })

  it('saves provider edits via PUT and refreshes the providers resource', async () => {
    const { authFetch } = await import('../../lib/api')
    const { providersResource } = await import('../../lib/resources')
    const refreshSpy = vi.spyOn(providersResource, 'refresh')
    ;(authFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })

    render(undefined)
    const btn = container.querySelector('button')!
    act(() => {
      btn.click()
    })
    const editButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.getAttribute('aria-label')?.includes('Local'),
    )
    act(() => {
      editButton?.click()
    })
    const saveBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === 'save provider')
    await act(async () => {
      saveBtn?.click()
    })

    expect(authFetch).toHaveBeenCalledWith('/api/providers/provider-1', expect.objectContaining({ method: 'PUT' }))
    expect(refreshSpy).toHaveBeenCalled()
  })
})
