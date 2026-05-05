import { useSettingsStore } from '../../stores/settings'

export function useSettingsStoreState() {
  const settings = useSettingsStore((state) => state.settings)
  const loading = useSettingsStore((state) => state.loading)
  const getSetting = useSettingsStore((state) => state.getSetting)
  const setSetting = useSettingsStore((state) => state.setSetting)

  return { settings, loading, getSetting, setSetting }
}