import { useResourceWhen } from './useResource'
import { settingResource } from '../lib/resources'

/**
 * Read one server-persisted setting with implicit loadership. `fallback` covers
 * the not-yet-loaded window and the case where the server has no value.
 *
 * `enabled` gates the fetch: unauthenticated consumers (e.g. the login page)
 * pass false so no per-key settings request is fired before auth.
 */
export function useSetting(key: string, fallback = '', enabled = true) {
  const { data, loading } = useResourceWhen(enabled, settingResource, key)
  return { value: data ?? fallback, loading }
}
