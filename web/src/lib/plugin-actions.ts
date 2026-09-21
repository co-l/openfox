import { authFetch } from './api'
import type {
  PluginInfo,
  PluginNotification,
  PluginSettingsSchema,
  PluginSettingsValues,
  PluginSettingScope,
  PluginUiContributions,
} from '@shared/plugin.js'

export interface PluginListData {
  plugins: PluginInfo[]
  contributions: PluginUiContributions
}

export interface NotificationsData {
  notifications: PluginNotification[]
  unreadCount: number
}

export async function fetchPluginList(): Promise<PluginListData> {
  const res = await authFetch('/api/plugins/list')
  if (!res.ok) throw new Error(`Failed to load plugins (${res.status})`)
  return (await res.json()) as PluginListData
}

export async function fetchNotifications(): Promise<NotificationsData> {
  const res = await authFetch('/api/notifications')
  if (!res.ok) throw new Error(`Failed to load notifications (${res.status})`)
  return (await res.json()) as NotificationsData
}

export interface RegistryPlugin {
  name: string
  displayName: string
  description: string
  githubUrl: string
}

export async function fetchPluginRegistry(): Promise<{ plugins: RegistryPlugin[] }> {
  const res = await authFetch('/api/plugins/registry')
  if (!res.ok) throw new Error(`Failed to load plugin registry (${res.status})`)
  return (await res.json()) as { plugins: RegistryPlugin[] }
}

export interface PluginDiagnosticInfo {
  packageName: string
  version?: string
  source: string
  loaded: boolean
  enabled: boolean
  error?: string
  capabilities: string[]
}

export async function fetchPluginDiagnostics(): Promise<{ diagnostics: PluginDiagnosticInfo[] }> {
  const res = await authFetch('/api/plugins/diagnostics')
  if (!res.ok) throw new Error(`Failed to load plugin diagnostics (${res.status})`)
  return (await res.json()) as { diagnostics: PluginDiagnosticInfo[] }
}

export interface PluginToolInfo {
  name: string
  description: string
  pluginId: string
}

export async function fetchPluginTools(): Promise<{ tools: PluginToolInfo[] }> {
  const res = await authFetch('/api/plugins/tools')
  if (!res.ok) throw new Error(`Failed to load plugin tools (${res.status})`)
  return (await res.json()) as { tools: PluginToolInfo[] }
}

export interface PluginInstallInput {
  githubUrl?: string
  npm?: string
  path?: string
}

async function okOrError(res: Response): Promise<{ ok: boolean; error?: string }> {
  if (res.ok) return { ok: true }
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  return { ok: false, ...(body.error ? { error: body.error } : {}) }
}

export async function installPlugin(input: PluginInstallInput): Promise<{ ok: boolean; error?: string }> {
  const res = await authFetch('/api/plugins/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return okOrError(res)
}

export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const action = enabled ? 'enable' : 'disable'
  const res = await authFetch(`/api/plugins/${encodeURIComponent(pluginId)}/${action}`, { method: 'POST' })
  return okOrError(res)
}

export async function uninstallPlugin(pluginId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await authFetch(`/api/plugins/${encodeURIComponent(pluginId)}/uninstall`, { method: 'POST' })
  return okOrError(res)
}

export interface PluginSettingsData {
  schema: PluginSettingsSchema
  values: PluginSettingsValues
  secretsSet: string[]
}

export async function fetchPluginSettings(
  pluginId: string,
  scope: PluginSettingScope = 'global',
  projectId?: string,
): Promise<PluginSettingsData> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('projectId', projectId)
  const res = await authFetch(`/api/plugins/${encodeURIComponent(pluginId)}/settings?${params.toString()}`)
  if (!res.ok) throw new Error(`Failed to load plugin settings (${res.status})`)
  return (await res.json()) as PluginSettingsData
}

export async function savePluginSettings(
  pluginId: string,
  values: Record<string, unknown>,
  scope: PluginSettingScope = 'global',
  projectId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await authFetch(`/api/plugins/${encodeURIComponent(pluginId)}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values, scope, ...(projectId ? { projectId } : {}) }),
  })
  return okOrError(res)
}

export async function invokePluginRpc(
  pluginId: string,
  method: string,
  params: Record<string, unknown> = {},
  context: { sessionId?: string; workdir?: string; projectId?: string } = {},
): Promise<unknown> {
  const res = await authFetch(`/api/plugins/${encodeURIComponent(pluginId)}/rpc/${encodeURIComponent(method)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params, ...context }),
  })
  const body = (await res.json()) as { result?: unknown; error?: string }
  if (!res.ok) throw new Error(body.error ?? `Plugin RPC failed (${res.status})`)
  return body.result
}

export async function markNotificationsRead(id?: string): Promise<void> {
  await authFetch('/api/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(id ? { id } : { all: true }),
  })
}

export async function deleteNotification(id: string): Promise<void> {
  await authFetch(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function clearNotifications(): Promise<void> {
  await authFetch('/api/notifications', { method: 'DELETE' })
}
