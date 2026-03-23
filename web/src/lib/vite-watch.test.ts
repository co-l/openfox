import { describe, expect, it } from 'vitest'
import { createViteWatchOptions } from '../../vite-watch.js'

describe('createViteWatchOptions', () => {
  it('defaults to polling on Linux to avoid watcher exhaustion', () => {
    expect(createViteWatchOptions({ platform: 'linux', env: {} })).toMatchObject({
      usePolling: true,
      interval: 150,
      binaryInterval: 300,
    })
  })

  it('allows polling to be disabled explicitly', () => {
    expect(createViteWatchOptions({
      platform: 'linux',
      env: { OPENFOX_VITE_USE_POLLING: '0' },
    })).toMatchObject({
      usePolling: false,
    })
  })

  it('allows polling to be enabled explicitly on any platform', () => {
    expect(createViteWatchOptions({
      platform: 'darwin',
      env: { OPENFOX_VITE_USE_POLLING: 'true' },
    })).toMatchObject({
      usePolling: true,
      interval: 150,
    })
  })
})
