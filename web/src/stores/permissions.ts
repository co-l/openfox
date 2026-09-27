import { create } from 'zustand'
import type { PermissionConfig, PermissionRule, ScopedPermissionRule, SessionGrants } from '@shared/permissions.js'
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
  /** "Allow for this session" approvals currently held by the server, per session. */
  grants: SessionGrants[]

  fetchAll: (workdir?: string) => Promise<void>
  fetchConfig: (scope: Scope, workdir?: string) => Promise<void>
  addRule: (scope: Scope, rule: PermissionRule, workdir?: string) => Promise<void>
  updateRule: (scope: Scope, id: string, rule: PermissionRule, workdir?: string) => Promise<void>
  deleteRule: (scope: Scope, id: string, workdir?: string) => Promise<void>
  fetchGrants: () => Promise<void>
  revokeGrantedPath: (sessionId: string, path: string) => Promise<void>
  revokeGrantedRule: (sessionId: string, rule: PermissionRule) => Promise<void>
  revokeSessionGrants: (sessionId: string) => Promise<void>
}

function buildUrl(scope: Scope, workdir?: string, path = ''): string {
  const params = new URLSearchParams({ scope })
  if (scope === 'project' && workdir) params.set('workdir', workdir)
  return `/api/permissions${path}?${params.toString()}`
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

type SetState = (partial: Partial<PermissionsStore>) => void
type GetState = () => PermissionsStore

/** Send one rule mutation and write the config the server returns back into the store. */
async function mutate(
  set: SetState,
  get: GetState,
  scope: Scope,
  url: string,
  method: 'POST' | 'PUT' | 'DELETE',
  rule?: PermissionRule,
): Promise<void> {
  set({ saving: true })
  try {
    const res = await authFetch(url, {
      method,
      ...(rule ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rule) } : {}),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
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
}

/** Send one grant revocation and store the grants the server returns. */
async function revoke(set: SetState, url: string): Promise<void> {
  set({ saving: true })
  try {
    const res = await authFetch(url, { method: 'DELETE' })
    // 404: already gone (revoked elsewhere or session ended). Resync from the server's answer if any.
    if (!res.ok && res.status !== 404) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(err.error ?? 'Failed to revoke grant')
    }
    const data = (await res.json().catch(() => ({}))) as { grants?: SessionGrants[] }
    if (data.grants) set({ grants: data.grants })
  } finally {
    set({ saving: false })
  }
}

export const usePermissionsStore = create<PermissionsStore>()((set, get) => ({
  globalConfig: null,
  projectConfig: null,
  mergedRules: [],
  loading: false,
  saving: false,
  error: null,
  grants: [],

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

  /**
   * Every mutation is a single request the SERVER applies to the file it just
   * read. The client never POSTs a whole config rebuilt from its own cache, so
   * a second tab editing the same scope cannot silently drop the first one's
   * rule, and a rule is addressed by id rather than by its index in the list.
   */
  addRule: async (scope, rule, workdir) => {
    await mutate(set, get, scope, buildUrl(scope, workdir, '/rules'), 'POST', rule)
  },

  updateRule: async (scope, id, rule, workdir) => {
    await mutate(set, get, scope, buildUrl(scope, workdir, `/rules/${id}`), 'PUT', rule)
  },

  deleteRule: async (scope, id, workdir) => {
    await mutate(set, get, scope, buildUrl(scope, workdir, `/rules/${id}`), 'DELETE')
  },

  fetchGrants: async () => {
    try {
      const res = await authFetch('/api/permissions/grants')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { grants?: SessionGrants[] }
      set({ grants: data.grants ?? [] })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load session grants' })
    }
  },

  revokeGrantedPath: async (sessionId, path) => {
    await revoke(set, `/api/permissions/grants/${encodeURIComponent(sessionId)}/paths?${new URLSearchParams({ path })}`)
  },

  revokeGrantedRule: async (sessionId, rule) => {
    const params = new URLSearchParams({ tool: rule.tool })
    if (rule.pattern !== undefined) params.set('pattern', rule.pattern)
    await revoke(set, `/api/permissions/grants/${encodeURIComponent(sessionId)}/rules?${params}`)
  },

  revokeSessionGrants: async (sessionId) => {
    await revoke(set, `/api/permissions/grants/${encodeURIComponent(sessionId)}`)
  },
}))
