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
  | 'transforms'
  | 'dangerLevels'

export type PluginSlotName =
  | 'header.actions'
  | 'session.header.actions'
  | 'message.actions'
  | 'composer.actions'
  | 'session.row.badges'
  | 'session.header.badges'
  | 'plugin.menu'
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
  | 'stats.modal'
  | 'stats.modal.summary'
  | (string & {})

export type PluginBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export type PluginActivation =
  | { kind: 'rpc'; method: string; params?: Record<string, unknown> }
  | { kind: 'openPanel'; panelId: string }
  | { kind: 'openUrl'; url: string }
  | { kind: 'openSettings'; tab?: PluginSettingsTabRef }

/**
 * Settings tab opened by an `openSettings` activation: a core tab id
 * (`plugins`, `tools`, …) or a full plugin tab reference
 * (`plugin:<pluginId>:<tabId>`).
 */
export type PluginSettingsTabRef = string

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
  /**
   * `plugin.menu` turns the plugin's own row in the plugins menu into the
   * action: `label` replaces the plugin display name and activating the row
   * runs `onActivate`.
   */
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
  | { type: 'text'; text: LocalizedString; muted?: boolean; className?: string }
  | { type: 'keyValue'; items: { key: LocalizedString; value: string }[] }
  | { type: 'table'; columns: LocalizedString[]; rows: string[][] }
  | { type: 'progress'; label: LocalizedString; value: number; max: number; tone?: PluginBadgeTone }
  | { type: 'badge'; label: LocalizedString; tone?: PluginBadgeTone; color?: string; className?: string }
  | {
      type: 'button'
      label: LocalizedString
      title?: LocalizedString
      variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'pill'
      icon?: string
      disabled?: boolean
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
      className?: string
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
      type: 'details'
      title: LocalizedString
      defaultOpen?: boolean
      className?: string
      children: DeclarativeNode[]
    }
  | {
      type: 'input'
      id: string
      placeholder?: LocalizedString
      defaultValue?: string
      defaultChecked?: boolean
      label?: LocalizedString
      inputType?: 'text' | 'number' | 'password' | 'checkbox' | 'textarea'
      rows?: number
      disabled?: boolean
      onChange?: PluginActivation
      onBlur?: PluginActivation
    }
  | {
      type: 'select'
      id: string
      label?: LocalizedString
      options: { value: string; label: LocalizedString }[]
      defaultValue?: string
      onChange?: PluginActivation
      onBlur?: PluginActivation
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
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full'
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

export interface PluginDangerLevelView {
  id: string
  pluginId: string
  label: LocalizedString
  description?: LocalizedString
  badgeTone?: PluginBadgeTone
}

export interface PluginUiContributions {
  actions: PluginUiAction[]
  badges: PluginUiBadge[]
  panels: PluginUiPanel[]
  sections: PluginUiSection[]
  components: PluginUiComponent[]
  overrides: PluginUiOverride[]
  settingsTabs: PluginSettingsTab[]
  dangerLevels?: PluginDangerLevelView[]
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
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'textarea' | 'path' | 'button' | 'status' | 'list'
  label: LocalizedString
  buttonLabel?: LocalizedString
  buttonVariant?: 'default' | 'primary' | 'secondary' | 'danger' | 'ghost'
  rpcMethod?: string
  description?: LocalizedString
  default?: PluginSettingValue
  options?: PluginSettingsOption[]
  required?: boolean
  secret?: boolean
  placeholder?: string
  scope?: PluginSettingScope
  parentKey?: string
  width?: 'full' | 'half'
  section?: LocalizedString
  hideWhenInstalled?: boolean
  /** Display-only field: rendered disabled, always shows `default`, never read from or written to storage. */
  readOnly?: boolean
  /** Whether to render a directory browser button to pick files or folders from the filesystem. */
  browseDirectory?: boolean
  /** Custom label for the browse directory button. */
  browseButtonLabel?: LocalizedString
  /** Danger levels for which this setting field is applicable (e.g. ['whitelist_only']). */
  dangerLevels?: string[]
  /**
   * Sub-fields of a `list` field, rendered inline on a single row per item.
   * Values are stored as a JSON array string, so a list value always travels
   * through `PluginSettingsValues` as a `string`.
   */
  itemFields?: PluginSettingsField[]
  /** Label of the "add row" button of a `list` field. */
  addLabel?: LocalizedString
  /** Label of the per-row remove button of a `list` field. */
  removeLabel?: LocalizedString
  /** Minimum number of rows of a `list` field. */
  minItems?: number
  /** Maximum number of rows of a `list` field. */
  maxItems?: number
  /**
   * "Open the provider page" button rendered next to the input — useful to send
   * the user to the page where an access token is generated.
   */
  linkButton?: PluginSettingsLinkButton
  /**
   * Backing store of the value. When set, the field is read from and written to
   * the plugin's own storage (`context.storage`) under that key instead of the
   * settings store — the way to surface a secret an earlier version of the
   * plugin kept in storage. Storage-backed fields are global.
   */
  storageKey?: string
}

/**
 * Button that opens an external page (typically "generate an access token")
 * next to a field or a `list` sub-field input.
 *
 * The URL is a template resolved against the values of the row (or the whole
 * form for a top-level field):
 * - `{{key}}` is replaced by the value of `key`,
 * - `{{key.origin}}` by its URL origin (`https://gitlab.example.com/group/x` → `https://gitlab.example.com`).
 *
 * The button is disabled while the resolved URL is not an absolute http(s) URL,
 * so a template built from a not-yet-filled field stays greyed out.
 */
export interface PluginSettingsLinkButton {
  label: LocalizedString
  /** URL template, also used as the fallback when `hrefByValue` has no match. */
  href?: string
  /** Field whose value selects the template in `hrefByValue`. */
  hrefByField?: string
  /** Templates keyed by the value of `hrefByField`. */
  hrefByValue?: Record<string, string>
}

export interface PluginSettingsSchema {
  fields: PluginSettingsField[]
}

export type PluginSettingsValues = Record<string, PluginSettingValue>

export interface PluginModelPopoverRow {
  label: LocalizedString
  value: string
  strikeThroughValue?: string
  tone?: PluginBadgeTone
}

export interface PluginModelPopoverView {
  title?: LocalizedString
  badge?: { label: LocalizedString; tone?: PluginBadgeTone }
  rows?: PluginModelPopoverRow[]
  footer?: LocalizedString
}

export interface PluginModelSublineItem {
  text: string
  tone?: PluginBadgeTone
}

export interface PluginModelBadge {
  label: LocalizedString
  tooltip?: LocalizedString
  tone?: PluginBadgeTone
  icon?: string
}

export interface PluginModelMetadataView {
  contextWindow?: number
  vision?: boolean
  reasoning?: boolean
  nameTone?: PluginBadgeTone
  popover?: PluginModelPopoverView
  subline?: PluginModelSublineItem[]
  bottomSubline?: PluginModelSublineItem[]
  badges?: PluginModelBadge[]
  extra?: Record<string, unknown>
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
  messageTransforms: number
  dangerLevels: number
}

export interface PluginInfo {
  id: string
  displayName: string
  description?: string
  author?: string
  icon?: string
  logo?: string
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
  messageTransforms: 0,
  dangerLevels: 0,
}
