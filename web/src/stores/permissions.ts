import { create } from 'zustand'
import type { PermissionConfig, PermissionRule, ScopedPermissionRule } from '@shared/permissions.js'
import { authFetch } from '../lib/api'
import { wsClient } from '../lib/ws'

type Scope = 'global' | 'project'

function notifyContextChanged() {
  try {
    wsClient.send('context.checkDynamic', {})
  } catch {
    // WS might not be connected
  }
}

interface PermissionsStore {
  globalConfig: PermissionConfig | null
  projectConfig: PermissionConfig | null
  mergedRules: ScopedPermissionRule[]
  loading: boolean
  saving: boolean
  error: string | null

  fetchAll: (workdir?: string) => Promise<void>
  fetchConfig: (scope: Scope, workdir?: string) => Promise<void>
  saveConfig: (scope: Scope, config: PermissionConfig, workdir?: string) => Promise<void>
  addRule: (scope: Scope, rule: PermissionRule, workdir?: string) => Promise<void>
  updateRule: (scope: Scope, index: number, rule: PermissionRule, workdir?: string) => Promise<void>
  deleteRule: (scope: Scope, index: number, workdir?: string) => Promise<void>
}

function buildUrl(scope: Scope, workdir?: string): string {
  const params = new URLSearchParams({ scope })
  if (scope === 'project' && workdir) params.set('workdir', workdir)
  return `/api/permissions?${params.toString()}`
}

function emptyConfig(): PermissionConfig {
  return { version: 1, rules: [] }
}

function computeMerged(global: PermissionConfig | null, project: PermissionConfig | null): ScopedPermissionRule[] {
  const globalRules: ScopedPermissionRule[] = (global?.rules ?? []).map((r) => ({ ...r, scope: 'global' as const }))
  const projectRules: ScopedPermissionRule[] = (project?.rules ?? []).map((r) => ({
    ...r,
    scope: 'project' as const,
  }))
  return [...globalRules, ...projectRules]
}

export const usePermissionsStore = create<PermissionsStore>()((set, get) => ({
  globalConfig: null,
  projectConfig: null,
  mergedRules: [],
  loading: false,
  saving: false,
  error: null,

  fetchAll: async (workdir) => {
    set({ loading: true, error: null })
    try {
      if (workdir) {
        await Promise.all([get().fetchConfig('global'), get().fetchConfig('project', workdir)])
      } else {
        set({ projectConfig: null })
        await get().fetchConfig('global')
      }
    } finally {
      set({ loading: false })
    }
  },

  fetchConfig: async (scope, workdir) => {
    try {
      const res = await authFetch(buildUrl(scope, workdir))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { config: PermissionConfig | null }
      const config = data.config ?? emptyConfig()
      if (scope === 'global') {
        set({ globalConfig: config, mergedRules: computeMerged(config, get().projectConfig) })
      } else {
        set({ projectConfig: config, mergedRules: computeMerged(get().globalConfig, config) })
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load permissions' })
    }
  },

  saveConfig: async (scope, config, workdir) => {
    set({ saving: true })
    try {
      const res = await authFetch(buildUrl(scope, workdir), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? 'Failed to save permissions')
      }
      const data = (await res.json()) as { config: PermissionConfig }
      if (scope === 'global') {
        set({ globalConfig: data.config, mergedRules: computeMerged(data.config, get().projectConfig) })
      } else {
        set({ projectConfig: data.config, mergedRules: computeMerged(get().globalConfig, data.config) })
      }
      notifyContextChanged()
    } finally {
      set({ saving: false })
    }
  },

  addRule: async (scope, rule, workdir) => {
    const current = scope === 'global' ? get().globalConfig : get().projectConfig
    const config: PermissionConfig = current
      ? { ...current, rules: [...current.rules, rule] }
      : { version: 1, rules: [rule] }
    await get().saveConfig(scope, config, workdir)
  },

  updateRule: async (scope, index, rule, workdir) => {
    const current = scope === 'global' ? get().globalConfig : get().projectConfig
    if (!current) return
    const rules = [...current.rules]
    rules[index] = rule
    const config: PermissionConfig = { ...current, rules }
    await get().saveConfig(scope, config, workdir)
  },

  deleteRule: async (scope, index, workdir) => {
    const current = scope === 'global' ? get().globalConfig : get().projectConfig
    if (!current) return
    const rules = current.rules.filter((_, i) => i !== index)
    const config: PermissionConfig = { ...current, rules }
    await get().saveConfig(scope, config, workdir)
  },
}))
