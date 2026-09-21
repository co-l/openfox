import { useResource } from './useResource'
import { pluginListResource } from '../lib/resources'
import { EMPTY_PLUGIN_CONTRIBUTIONS } from '@shared/plugin.js'

export function usePlugins() {
  const { data, loading, error, refresh } = useResource(pluginListResource)
  return {
    plugins: data?.plugins ?? [],
    contributions: data?.contributions ?? {
      ...EMPTY_PLUGIN_CONTRIBUTIONS,
      actions: [],
      badges: [],
      panels: [],
      sections: [],
      settingsTabs: [],
      components: [],
      overrides: [],
    },
    loading,
    error,
    refresh,
  }
}
