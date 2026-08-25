// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { ModelEntryRow, type ModelWithConfig } from './model-list'

function renderRow(modelConfig: ModelWithConfig) {
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
