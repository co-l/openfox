// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { Message } from '@shared/types.js'
import { ChatMessage } from './ChatMessage'

function renderMessage(content: string) {
  const container = document.createElement('div')
  const root = createRoot(container)
  const message: Message = {
    id: 'fallback-1',
    role: 'system',
    content,
    timestamp: new Date().toISOString(),
    isSystemGenerated: true,
    messageKind: 'model-fallback',
  }
  flushSync(() => root.render(<ChatMessage message={message} />))
  return container
}

describe('ChatMessage model fallback', () => {
  it('shows the failed provider, model, and error', () => {
    const container = renderMessage(
      JSON.stringify({ providerId: 'provider-a', providerName: 'Primary', model: 'model-a', error: 'Rate limited' }),
    )

    expect(container.textContent).toContain('Primary / model-a')
    expect(container.textContent).toContain('Rate limited')
  })

  it('renders malformed payloads without breaking the feed', () => {
    expect(renderMessage('{}').textContent).toContain('Model fallback details unavailable')
    expect(renderMessage('Unavailable model').textContent).toContain('Model fallback details unavailable')
  })
})
