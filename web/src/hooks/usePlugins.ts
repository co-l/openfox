import { useResource } from './useResource'
import { pluginListResource } from '../lib/resources'
import type { PluginUiContributions } from '@shared/plugin.js'

const EMPTY_UI_CONTRIBUTIONS: PluginUiContributions = {
  actions: [],
  badges: [],
  panels: [],
  sections: [],
  settingsTabs: [],
  components: [],
  overrides: [],
  dangerLevels: [],
}

export function usePlugins() {
  const { data, loading, error, refresh } = useResource(pluginListResource)
  return {
    plugins: data?.plugins ?? [],
    contributions: data?.contributions ?? EMPTY_UI_CONTRIBUTIONS,
    loading,
    error,
    refresh,
  }
}
