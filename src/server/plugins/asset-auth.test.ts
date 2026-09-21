import { describe, expect, it } from 'vitest'
import { pluginAssetToken } from './asset-auth.js'

describe('pluginAssetToken', () => {
  it('reads the token query parameter on plugin asset paths', () => {
    expect(pluginAssetToken({ path: '/plugins/demo/assets/panel.html', query: { token: 'abc' } })).toBe('abc')
  })

  it('ignores the token on other API paths', () => {
    expect(pluginAssetToken({ path: '/plugins/demo/rpc/ping', query: { token: 'abc' } })).toBeUndefined()
    expect(pluginAssetToken({ path: '/sessions', query: { token: 'abc' } })).toBeUndefined()
  })

  it('ignores non-string or empty tokens', () => {
    expect(pluginAssetToken({ path: '/plugins/demo/assets/panel.html', query: { token: 123 } })).toBeUndefined()
    expect(pluginAssetToken({ path: '/plugins/demo/assets/panel.html', query: { token: '' } })).toBeUndefined()
    expect(pluginAssetToken({ path: '/plugins/demo/assets/panel.html', query: {} })).toBeUndefined()
  })
})
