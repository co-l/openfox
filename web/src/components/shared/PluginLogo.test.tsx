// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PluginLogo, findPluginLogoForProvider } from './PluginLogo'
import type { PluginInfo } from '@shared/plugin.js'

describe('findPluginLogoForProvider', () => {
  it('returns custom logo or icon directly from provider', () => {
    expect(findPluginLogoForProvider({ logo: 'https://example.com/logo.png' })).toBe('https://example.com/logo.png')
    expect(findPluginLogoForProvider({ icon: 'cpu' })).toBe('cpu')
  })

  it('matches provider against loaded plugins', () => {
    const plugins: PluginInfo[] = [
      {
        id: 'openfox-custom-ai',
        displayName: 'Custom AI',
        version: '1.0.0',
        icon: 'sparkles',
      } as PluginInfo,
    ]

    expect(findPluginLogoForProvider({ preset: 'custom-ai' }, plugins)).toBe('sparkles')
    expect(findPluginLogoForProvider({ backend: 'custom-ai' }, plugins)).toBe('sparkles')
    expect(findPluginLogoForProvider({ id: 'openfox-custom-ai-provider' }, plugins)).toBe('sparkles')
    expect(findPluginLogoForProvider({ name: 'Custom AI' }, plugins)).toBe('sparkles')
    expect(findPluginLogoForProvider({ id: 'ai' }, plugins)).toBeUndefined()
  })

  it('resolves built-in provider logos to local asset paths', () => {
    expect(findPluginLogoForProvider({ backend: 'lmstudio' })).toBe('/assets/providers/lmstudio.webp')
    expect(findPluginLogoForProvider({ name: 'LM Studio' })).toBe('/assets/providers/lmstudio.webp')
    expect(findPluginLogoForProvider({ preset: 'llama.cpp' })).toBe('/assets/providers/llama-cpp.png')
    expect(findPluginLogoForProvider({ backend: 'llamacpp' })).toBe('/assets/providers/llama-cpp.png')
    expect(findPluginLogoForProvider({ name: 'Ollama local' })).toBe('/assets/providers/ollama.webp')
    expect(findPluginLogoForProvider({ backend: 'vllm' })).toBe('/assets/providers/vllm.png')
    expect(findPluginLogoForProvider({ name: 'Unsloth Fast' })).toBe('/assets/providers/unsloth.png')
  })

  it('returns undefined for unmatched provider', () => {
    expect(findPluginLogoForProvider(undefined)).toBeUndefined()
    expect(findPluginLogoForProvider({ name: 'Unknown Backend' })).toBeUndefined()
  })
})

describe('PluginLogo component', () => {
  it('renders null when neither icon nor logo is provided', () => {
    const { container } = render(<PluginLogo />)
    expect(container.firstChild).toBeNull()
  })

  it('renders raw SVG strings', () => {
    const { container } = render(<PluginLogo icon="<svg viewBox='0 0 10 10'><circle cx='5' cy='5' r='5'/></svg>" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
  })

  it('renders local image paths with img tag', () => {
    const { container } = render(<PluginLogo logo="/assets/providers/ollama.webp" />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('/assets/providers/ollama.webp')
  })

  it('renders external image URLs with img tag', () => {
    const { container } = render(<PluginLogo icon="https://example.com/logo.png" />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('https://example.com/logo.png')
  })

  it('renders named plugin icons', () => {
    const { container } = render(<PluginLogo icon="sparkles" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
  })
})
