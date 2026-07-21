// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  vi.resetModules()
})

describe('detectBasePath', () => {
  it('returns empty string when document is undefined', async () => {
    const origDocument = globalThis.document
    delete (globalThis as any).document
    const { detectBasePath } = await import('./basePath')
    expect(detectBasePath()).toBe('')
    globalThis.document = origDocument
  })

  it('returns empty string when no matching script tag found', async () => {
    document.body.innerHTML = '<script src="/other.js"></script>'
    const { detectBasePath } = await import('./basePath')
    expect(detectBasePath()).toBe('')
  })

  it('returns empty string for root deployment with /assets/ script', async () => {
    document.body.innerHTML = '<script type="module" src="/assets/index-abc123.js"></script>'
    const { detectBasePath } = await import('./basePath')
    expect(detectBasePath()).toBe('')
  })

  it('extracts subpath from /assets/ script path', async () => {
    document.body.innerHTML = '<script type="module" src="/openfox/assets/index-abc123.js"></script>'
    const { detectBasePath } = await import('./basePath')
    expect(detectBasePath()).toBe('/openfox')
  })

  it('extracts deep subpath from /assets/ script path', async () => {
    document.body.innerHTML = '<script type="module" src="/deep/path/openfox/assets/index-abc123.js"></script>'
    const { detectBasePath } = await import('./basePath')
    expect(detectBasePath()).toBe('/deep/path/openfox')
  })

  it('returns empty string for root deployment with /src/main.tsx script (dev mode)', async () => {
    document.body.innerHTML = '<script type="module" src="/src/main.tsx"></script>'
    const { detectBasePath } = await import('./basePath')
    expect(detectBasePath()).toBe('')
  })

  it('extracts subpath from /src/main.tsx script path (dev mode)', async () => {
    document.body.innerHTML = '<script type="module" src="/openfox/src/main.tsx"></script>'
    const { detectBasePath } = await import('./basePath')
    expect(detectBasePath()).toBe('/openfox')
  })

  it('skips non-matching scripts like Vite HMR client', async () => {
    document.body.innerHTML = `
      <script type="module" src="/@vite/client"></script>
      <script type="module" src="/myapp/assets/index.js"></script>
    `
    const { detectBasePath } = await import('./basePath')
    expect(detectBasePath()).toBe('/myapp')
  })
})

describe('appUrl', () => {
  it('returns non-absolute paths unchanged', async () => {
    document.body.innerHTML = '<script type="module" src="/openfox/assets/index.js"></script>'
    const { appUrl } = await import('./basePath')
    expect(appUrl('relative/path')).toBe('relative/path')
    expect(appUrl('http://example.com/api')).toBe('http://example.com/api')
  })

  it('prefixes path with appBasePath when deployed under subpath', async () => {
    document.body.innerHTML = '<script type="module" src="/openfox/assets/index.js"></script>'
    const { appUrl } = await import('./basePath')
    expect(appUrl('/api/test')).toBe('/openfox/api/test')
    expect(appUrl('/ws')).toBe('/openfox/ws')
  })

  it('returns path unchanged when deployed at root', async () => {
    document.body.innerHTML = '<script type="module" src="/assets/index.js"></script>'
    const { appUrl } = await import('./basePath')
    expect(appUrl('/api/test')).toBe('/api/test')
    expect(appUrl('/ws')).toBe('/ws')
  })
})
