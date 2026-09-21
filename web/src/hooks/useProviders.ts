import { useResource } from './useResource'
import { providersResource } from '../lib/resources'

/**
 * Providers list + active provider id with implicit loadership via the
 * providers resource cache. Providers carry their inline models.
 */
export function useProviders() {
  const { data, refresh, loading } = useResource(providersResource)
  const providers = data?.providers ?? []
  const activeProviderId = data?.activeProviderId ?? null
  return { providers, activeProviderId, refresh, loading }
}
