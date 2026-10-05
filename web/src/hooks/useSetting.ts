import { useResourceWhen } from './useResource'
import { settingResource } from '../lib/resources'

/**
 * Read one server-persisted setting with implicit loadership. `fallback` covers
 * the not-yet-loaded window and the case where the server has no value.
 *
 * `hasData` is true once the fetch has settled and produced a value (even an
 * empty string). It stays false while the entry is still loading, so callers
 * can avoid acting on the `fallback` during the load window — acting on it
 * would briefly revert an already-applied override back to the default.
 *
 * `enabled` gates the fetch: unauthenticated consumers (e.g. the login page)
 * pass false so no per-key settings request is fired before auth.
 */
export function useSetting(key: string, fallback = '', enabled = true) {
  const { data, loading } = useResourceWhen(enabled, settingResource, key)
  return { value: data ?? fallback, loading, hasData: data !== undefined }
}
