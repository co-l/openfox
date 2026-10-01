import { describe, expect, it, vi } from 'vitest'
import type { ProviderAuthAdapter } from '../../../provider/index.js'
import { logger } from '../../utils/logger.js'
import { cascadeProviderDelete } from './provider-deletion.js'

function adapterWith(deleteProvider?: (providerId: string) => Promise<void>): ProviderAuthAdapter {
  return {
    id: 'multi-account-auth',
    beginLogin: vi.fn(),
    getStatus: vi.fn(),
    getAccessContext: vi.fn(),
    logout: vi.fn(),
    ...(deleteProvider ? { deleteProvider } : {}),
  } as unknown as ProviderAuthAdapter
}

describe('cascadeProviderDelete', () => {
  it('removes the accounts owned by the deleted provider', async () => {
    const deleteProvider = vi.fn(async () => undefined)

    await cascadeProviderDelete(adapterWith(deleteProvider), 'provider-1')

    expect(deleteProvider).toHaveBeenCalledWith('provider-1')
  })

  it('does nothing when the adapter has no provider-deletion hook', async () => {
    await expect(cascadeProviderDelete(adapterWith(), 'provider-1')).resolves.toBeUndefined()
    await expect(cascadeProviderDelete(undefined, 'provider-1')).resolves.toBeUndefined()
  })

  it('logs and swallows adapter failures so the provider stays deletable', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const deleteProvider = vi.fn(async () => {
      throw new Error('boom')
    })

    await expect(cascadeProviderDelete(adapterWith(deleteProvider), 'provider-1')).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(
      'Failed to cascade provider deletion to its auth adapter',
      expect.objectContaining({ providerId: 'provider-1', error: 'boom' }),
    )
    warn.mockRestore()
  })
})
