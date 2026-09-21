import { useResource } from './useResource'
import { configResource } from '../lib/resources'

/** Runtime selection + app-level config (excludes the providers list). */
export function useConfig() {
  const { data, refresh, loading } = useResource(configResource)
  return { config: data ?? null, refresh, loading }
}
