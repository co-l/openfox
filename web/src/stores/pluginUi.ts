import { create } from 'zustand'

function stateKey(pluginId: string, panelId: string | undefined, key: string): string {
  return `${pluginId}:${panelId ?? ''}:${key}`
}

export interface PluginPanelContext {
  sessionId?: string
  workdir?: string
  projectId?: string
}

export interface ActivePluginPanel {
  pluginId: string
  panelId: string
  context?: PluginPanelContext
  /**
   * Set when the panel was opened by an RPC action that already supplied the
   * panel `content`. The host then skips the on-open `initPanel` refresh so it
   * cannot clobber the freshly computed content.
   */
  skipInitPanel?: boolean
}

interface PluginUiStore {
  values: Record<string, unknown>
  activePanel: ActivePluginPanel | null
  setState: (pluginId: string, panelId: string | undefined, key: string, value: unknown) => void
  read: (pluginId: string, panelId: string | undefined, key: string) => unknown
  clearPanel: (pluginId: string, panelId: string) => void
  openPanel: (
    pluginId: string,
    panelId: string,
    context?: PluginPanelContext,
    options?: { skipInitPanel?: boolean },
  ) => void
  closePanel: () => void
}

export const usePluginUiStore = create<PluginUiStore>((set, get) => ({
  values: {},
  activePanel: null,
  setState: (pluginId, panelId, key, value) =>
    set((state) => ({ values: { ...state.values, [stateKey(pluginId, panelId, key)]: value } })),
  read: (pluginId, panelId, key) => get().values[stateKey(pluginId, panelId, key)],
  clearPanel: (pluginId, panelId) =>
    set((state) => {
      const prefix = `${pluginId}:${panelId}:`
      return {
        values: Object.fromEntries(Object.entries(state.values).filter(([key]) => !key.startsWith(prefix))),
      }
    }),
  openPanel: (pluginId, panelId, context, options) =>
    set({
      activePanel: {
        pluginId,
        panelId,
        ...(context && Object.keys(context).length > 0 ? { context } : {}),
        ...(options?.skipInitPanel ? { skipInitPanel: true } : {}),
      },
    }),
  closePanel: () => set({ activePanel: null }),
}))
