// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { ModelEntryRow, getVisibleModels, type ModelWithConfig } from './model-list'
import type { Provider } from '../../stores/config'

function renderRow(
  modelConfig: ModelWithConfig,
  opts?: { onSelectEffort?: (p: string, m: string, e: string) => void; reasoningEfforts?: string[] },
) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <ModelEntryRow
        providerId="provider-1"
        modelConfig={modelConfig}
        isActive={false}
        highlighted={false}
        onModelClick={vi.fn()}
        reasoningEfforts={opts?.reasoningEfforts}
        onSelectEffort={opts?.onSelectEffort ?? vi.fn()}
      />,
    )
  })
  return { container, root }
}

function cleanup({ container, root }: { container: HTMLElement; root: ReturnType<typeof createRoot> }) {
  act(() => root.unmount())
  container.remove()
}

describe('ModelEntryRow vision indicator', () => {
  it('shows an eye indicator for a vision model', () => {
    const rendered = renderRow({ id: 'vision-model', contextWindow: 200000, source: 'backend', supportsVision: true })
    try {
      expect(rendered.container.querySelector('[data-vision]')).not.toBeNull()
    } finally {
      cleanup(rendered)
    }
  })

  it('does not show an eye indicator for a non-vision model', () => {
    const rendered = renderRow({ id: 'text-model', contextWindow: 200000, source: 'backend', supportsVision: false })
    try {
      expect(rendered.container.querySelector('[data-vision]')).toBeNull()
    } finally {
      cleanup(rendered)
    }
  })
})

describe('ModelEntryRow small-context warning', () => {
  it('shows a warning indicator for a small-context model', () => {
    const rendered = renderRow({ id: 'small-model', contextWindow: 8192, source: 'backend' })
    try {
      expect(rendered.container.querySelector('[data-small-context]')).not.toBeNull()
    } finally {
      cleanup(rendered)
    }
  })

  it('does not show a warning indicator for an adequate-context model', () => {
    const rendered = renderRow({ id: 'big-model', contextWindow: 32768, source: 'backend' })
    try {
      expect(rendered.container.querySelector('[data-small-context]')).toBeNull()
    } finally {
      cleanup(rendered)
    }
  })
})

describe('ModelEntryRow mode chips', () => {
  it('renders reasoning-effort chips for a merged mode model', () => {
    const rendered = renderRow(
      { id: 'gemini-3.6-flash', contextWindow: 1048576, source: 'backend' },
      { reasoningEfforts: ['low', 'medium', 'high'] },
    )
    try {
      const chipRow = rendered.container.querySelector('[aria-label="Reasoning efforts for gemini-3.6-flash"]')
      const chips = Array.from(chipRow?.querySelectorAll('button') ?? []).map((b) => b.textContent?.trim())
      expect(chips).toEqual(['low', 'medium', 'high'])
    } finally {
      cleanup(rendered)
    }
  })

  it('does not render chips when no reasoning efforts are set', () => {
    const rendered = renderRow({ id: 'plain-model', contextWindow: 1048576, source: 'backend' })
    try {
      const chipRow = rendered.container.querySelector('[aria-label^="Reasoning efforts"]')
      expect(chipRow).toBeNull()
    } finally {
      cleanup(rendered)
    }
  })

  it('calls onSelectEffort with the clicked level', () => {
    const onSelectEffort = vi.fn()
    const rendered = renderRow(
      { id: 'gemini-3.6-flash', contextWindow: 1048576, source: 'backend' },
      { onSelectEffort, reasoningEfforts: ['low', 'high'] },
    )
    try {
      const chipRow = rendered.container.querySelector('[aria-label="Reasoning efforts for gemini-3.6-flash"]')
      const high = Array.from(chipRow?.querySelectorAll('button') ?? []).find((b) => b.textContent?.trim() === 'high')
      act(() => high?.click())
      expect(onSelectEffort).toHaveBeenCalledWith('provider-1', 'gemini-3.6-flash', 'high')
    } finally {
      cleanup(rendered)
    }
  })
})

describe('getVisibleModels mode derivation', () => {
  it('derives reasoningEfforts from a merged model modes', () => {
    const provider = {
      id: 'omni',
      name: 'Omni',
      url: 'https://omniroute.example/v1',
      backend: 'openai',
      models: [
        {
          id: 'gemini-3.6-flash',
          name: 'Gemini 3.6 Flash',
          contextWindow: 1048576,
          source: 'backend',
          modes: [
            { level: 'low', apiModelId: 'gemini-3.6-flash-low' },
            { level: 'high', apiModelId: 'gemini-3.6-flash-high' },
          ],
        },
      ],
      isActive: false,
      createdAt: '',
    } as unknown as Provider
    const visible = getVisibleModels(provider)
    expect(visible[0]?.reasoningEfforts).toEqual(['low', 'high'])
  })
})
