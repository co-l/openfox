import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react'
import { load, release, retain, snapshot, subscribe, type Resource } from '../lib/resourceCache'

/**
 * React binding over the resource cache. Loadership is implicit: mounting the
 * hook kicks `load()` + `retain()` in a layout effect (before first paint, so
 * there is no "loaded-but-empty" flash frame) and cleanup releases the ref.
 * `refresh()` is stable per args and swallows errors into the snapshot.
 */
export function useResource<Data, Args extends unknown[]>(res: Resource<Data, Args>, ...args: Args) {
  return useResourceWhen(true, res, ...args)
}

/**
 * Gated variant of `useResource`: while `enabled` is false the hook neither
 * loads nor retains the entry (callers on the unauthenticated login page must
 * not fire per-key settings requests). Flipping `enabled` to true triggers the
 * load, which the cache's freshness/single-flight rules dedupe against any
 * data the batched warm-up already wrote through.
 */
export function useResourceWhen<Data, Args extends unknown[]>(
  enabled: boolean,
  res: Resource<Data, Args>,
  ...args: Args
) {
  const key = res.keyOf(...args)
  const getSnapshot = useCallback(() => snapshot<Data>(key), [key])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const refresh = useCallback(() => res.refresh(...args), [res, ...args])

  useLayoutEffect(() => {
    if (!enabled) return
    load(key, () => res.fetch(...args), res.maxAgeMs)
    retain(key)
    return () => release(key)
  }, [enabled, key, res, ...args])

  return { ...state, refresh }
}
