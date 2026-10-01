import type { ProviderAuthAdapter } from '../../../provider/index.js'
import { logger } from '../../utils/logger.js'

/**
 * Auth adapters that own per-provider credentials (multi-account plugins store
 * one credential per account) may expose this hook so deleting the provider
 * also removes the accounts it created.
 */
export type AuthAdapterWithProviderDeletion = ProviderAuthAdapter & {
  deleteProvider?(providerId: string): Promise<void>
}

/**
 * Cascade a provider deletion to its auth adapter. Failures are logged, never
 * thrown: a provider must stay deletable even when its plugin misbehaves.
 */
export async function cascadeProviderDelete(
  adapter: ProviderAuthAdapter | undefined,
  providerId: string,
): Promise<void> {
  const withDeletion = adapter as AuthAdapterWithProviderDeletion | undefined
  if (!withDeletion || typeof withDeletion.deleteProvider !== 'function') return
  try {
    await withDeletion.deleteProvider(providerId)
  } catch (error) {
    logger.warn('Failed to cascade provider deletion to its auth adapter', {
      providerId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
