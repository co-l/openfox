export type LocalizedString = { en: string; fr: string }

export type PluginCapability =
  | 'providers'
  | 'models'
  | 'settings'
  | 'tools'
  | 'commands'
  | 'skills'
  | 'ui'
  | 'hooks'
  | 'notifications'
  | 'workflows'
  | 'rpc'
  | 'assets'

export type PluginSlotName =
  | 'header.actions'
  | 'session.header.actions'
  | 'message.actions'
  | 'composer.actions'
  | 'session.row.badges'
  | 'session.header.badges'
  | (string & {})

export type PluginZoneId =
  | 'header'
  | 'header.brand'
  | 'header.nav'
  | 'header.actions'
  | 'header.status'
  | 'sidebar'
  | 'sidebar.header'
  | 'sidebar.project_selector'
  | 'sidebar.nav'
  | 'sidebar.sessions_list'
  | 'sidebar.footer'
  | 'session.header'
  | 'session.header.title'
  | 'session.header.actions'
  | 'session.header.badges'
  | 'session.content'
  | 'session.messages'
  | 'message.bubble'
  | 'message.actions'
  | 'composer'
  | 'composer.toolbar'
  | 'composer.actions'
  | 'session.footer'
  | 'settings.sidebar'
  | 'settings.content'
  | 'modal.footer'
  | (string & {})

export type PluginBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export type PluginActivation =
  | { kind: 'rpc'; method: string; params?: Record<string, unknown> }
  | { kind: 'openPanel'; panelId: string }
  | { kind: 'openUrl'; url: string }

/**
 * Declarative visibility for a contribution. Every field is ANDed; omitted
 * fields impose no constraint. Context values come from the slot host
 * (e.g. a session row passes sessionId, a message menu passes messageId).
 */
export interface PluginVisibilityCondition {
  hasSession?: boolean
  hasProject?: boolean
  hasMessage?: boolean
}

export interface PluginUiAction {
  id: string
  pluginId?: string
  slot: PluginSlotName
  label: LocalizedString
  icon?: string
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  tooltip?: LocalizedString
  visibleWhen?: PluginVisibilityCondition
  onActivate: PluginActivation
}

export type PluginUiBadgeAppearance = 'badge' | 'icon'
export type PluginUiBadgeCacheScope = 'context' | 'session' | 'workdir' | 'project'

export interface PluginUiBadgeDynamicState {
  visible?: boolean
  value?: string | number
  label?: LocalizedString
  tone?: PluginBadgeTone
  tooltip?: LocalizedString
  icon?: string
}

export interface PluginUiBadgeRpcSource {
  kind: 'rpc'
  method: string
  /** Optional live refresh interval. Omit for the default cache-only behavior. */
  refreshMs?: number
  /** Controls RPC de-duplication when the same badge is rendered in many rows. */
  cacheScope?: PluginUiBadgeCacheScope
}

export interface PluginUiBadge {
  id: string
  pluginId?: string
  slot: PluginSlotName
  label: LocalizedString
  tone?: PluginBadgeTone
  tooltip?: LocalizedString
  icon?: string
  /** Compact icon-only rendering for passive status indicators. */
  appearance?: PluginUiBadgeAppearance
  value?: string
  visibleWhen?: PluginVisibilityCondition
  source?: PluginUiBadgeRpcSource
}

export type DeclarativeNode =
  | { type: 'text'; text: LocalizedString; muted?: boolean }
  | { type: 'keyValue'; items: { key: LocalizedString; value: string }[] }
  | { type: 'table'; columns: LocalizedString[]; rows: string[][] }
  | { type: 'progress'; label: LocalizedString; value: number; max: number; tone?: PluginBadgeTone }
  | { type: 'badge'; label: LocalizedString; tone?: PluginBadgeTone }
  | {
      type: 'button'
      label: LocalizedString
      variant?: 'default' | 'primary' | 'danger' | 'ghost'
      icon?: string
      onActivate: PluginActivation
    }
  | { type: 'divider' }
  | {
      type: 'stack'
      direction?: 'row' | 'column'
      gap?: 'none' | 'xs' | 'sm' | 'md' | 'lg'
      align?: 'start' | 'center' | 'end' | 'stretch'
      justify?: 'start' | 'center' | 'end' | 'between'
      className?: string
      children: DeclarativeNode[]
    }
  | {
      type: 'card'
      title?: LocalizedString
      subtitle?: LocalizedString
      tone?: PluginBadgeTone
      children: DeclarativeNode[]
    }
  | {
      type: 'callout'
      tone?: PluginBadgeTone
      title?: LocalizedString
      text: LocalizedString
      icon?: string
    }
  | {
      type: 'icon'
      icon: string
      tone?: PluginBadgeTone
      className?: string
    }
  | {
      type: 'input'
      id: string
      placeholder?: LocalizedString
      defaultValue?: string
      label?: LocalizedString
      inputType?: 'text' | 'number' | 'password'
    }
  | {
      type: 'select'
      id: string
      label?: LocalizedString
      options: { value: string; label: LocalizedString }[]
      defaultValue?: string
    }
  | {
      type: 'iframe'
      url: string
      height?: string | number
      width?: string | number
    }

export interface PluginUiComponent {
  id: string
  pluginId?: string
  zone: PluginZoneId
  position?: 'before' | 'after' | 'inside'
  order?: number
  visibleWhen?: PluginVisibilityCondition
  component: DeclarativeNode
}

export interface PluginUiOverride {
  id: string
  pluginId?: string
  zone: PluginZoneId
  mode: 'hide' | 'replace'
  order?: number
  visibleWhen?: PluginVisibilityCondition
  replacement?: DeclarativeNode
}

export interface PluginUiPanel {
  id: string
  pluginId?: string
  title: LocalizedString
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  kind: 'declarative' | 'iframe'
  content?: DeclarativeNode[]
  url?: string
}

export interface PluginSettingsTab {
  id: string
  pluginId?: string
  label: LocalizedString
  icon?: string
  order?: number
  content: DeclarativeNode[]
}

export interface PluginUiContributions {
  actions: PluginUiAction[]
  badges: PluginUiBadge[]
  panels: PluginUiPanel[]
  sections: PluginUiSection[]
  components: PluginUiComponent[]
  overrides: PluginUiOverride[]
  settingsTabs: PluginSettingsTab[]
}

export interface PluginUiSection {
  id: string
  pluginId: string
  title: LocalizedString
  schema: PluginSettingsSchema
}

export interface PluginUiStatePayload {
  pluginId: string
  panelId?: string
  key: string
  value: unknown
}

export type PluginSettingScope = 'global' | 'project'

export type PluginSettingValue = string | number | boolean

export interface PluginSettingsOption {
  value: string
  label: LocalizedString
}

export interface PluginSettingsField {
  key: string
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'textarea' | 'path'
  label: LocalizedString
  description?: LocalizedString
  default?: PluginSettingValue
  options?: PluginSettingsOption[]
  required?: boolean
  secret?: boolean
  placeholder?: string
  scope?: PluginSettingScope
}

export interface PluginSettingsSchema {
  fields: PluginSettingsField[]
}

export type PluginSettingsValues = Record<string, PluginSettingValue>

export interface PluginModelPricingView {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  currency?: string
  discountPercent?: number
}

export interface PluginModelMetadataView {
  pricing?: PluginModelPricingView
  contextWindow?: number
  vision?: boolean
  reasoning?: boolean
  badges?: { label: LocalizedString; tooltip?: LocalizedString; tone?: PluginBadgeTone; icon?: string }[]
}

export interface PluginContributionSummary {
  presets: number
  authAdapters: number
  transportAdapters: number
  modelMetadataProviders: number
  tools: number
  commands: number
  skillSources: number
  hooks: number
  rpcMethods: number
  transitions: number
  settingsFields: number
  uiActions: number
  uiBadges: number
  uiPanels: number
  settingsTabs: number
  uiComponents: number
  uiOverrides: number
}

export interface PluginInfo {
  id: string
  displayName: string
  description?: string
  version: string
  apiVersion: 1 | 2
  source: string
  enabled: boolean
  loaded: boolean
  error?: string
  capabilities: PluginCapability[]
  contributions: PluginContributionSummary
  /** False when the plugin was discovered outside {configDir}/plugins (e.g. node_modules). */
  removable: boolean
}

export type PluginNotificationLevel = 'info' | 'success' | 'warning' | 'error'

export interface PluginNotificationAction {
  label: LocalizedString
  onActivate: PluginActivation
}

export interface PluginNotification {
  id: string
  pluginId: string
  title: LocalizedString
  body?: LocalizedString
  level: PluginNotificationLevel
  actions?: PluginNotificationAction[]
  createdAt: string
  readAt?: string
}

export interface PluginNotificationPayload {
  notification: PluginNotification
}

export interface PluginNotificationDeletedPayload {
  id?: string
  all?: boolean
}

export const EMPTY_PLUGIN_CONTRIBUTIONS: PluginContributionSummary = {
  presets: 0,
  authAdapters: 0,
  transportAdapters: 0,
  modelMetadataProviders: 0,
  tools: 0,
  commands: 0,
  skillSources: 0,
  hooks: 0,
  rpcMethods: 0,
  transitions: 0,
  settingsFields: 0,
  uiActions: 0,
  uiBadges: 0,
  uiPanels: 0,
  settingsTabs: 0,
  uiComponents: 0,
  uiOverrides: 0,
}
