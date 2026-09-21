import { useLayoutEffect, useRef } from 'react'
import { useResourceWhen } from './useResource'
import { useDevServerStore, type LogChunk } from '../stores/dev-server'
import { devServerStatusResource, devServerConfigResource } from '../lib/resources'

const EMPTY_LOGS: LogChunk[] = []

/**
 * Dev-server data for a workdir with implicit loadership: mounting the hook
 * loads status + config from the resource cache, and hydrates the full log
 * buffer once when the server is alive. No consumer ever fires a fetch.
 */
export function useDevServer(workdir: string | null | undefined) {
  const enabled = Boolean(workdir)
  const key = workdir ?? ''
  const statusState = useResourceWhen(enabled, devServerStatusResource, key)
  const configState = useResourceWhen(enabled, devServerConfigResource, key)
  const logs = useDevServerStore((s) => (key ? s.logsByWorkdir[key] : undefined)) ?? EMPTY_LOGS

  const hydratedKey = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (!enabled) return
    const state = statusState.data?.state
    const alive = state === 'running' || state === 'warning'
    if (alive && hydratedKey.current !== key) {
      hydratedKey.current = key
      void useDevServerStore.getState().fetchLogs(key)
    }
  }, [enabled, key, statusState.data?.state])

  return {
    status: enabled ? (statusState.data ?? null) : null,
    config: enabled ? (configState.data ?? null) : null,
    logs,
    loading: statusState.loading || configState.loading,
    refresh: () => {
      void devServerStatusResource.refresh(key)
      void devServerConfigResource.refresh(key)
    },
  }
}
