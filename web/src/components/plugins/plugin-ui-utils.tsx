import type { ComponentType } from 'react'
import * as iconsModule from '../shared/icons'
import { invokePluginRpc } from '../../lib/plugin-actions'
import { usePluginUiStore } from '../../stores/pluginUi'
import { usePluginToastStore } from '../../stores/pluginToasts'
import type { DeclarativeNode, PluginActivation, PluginBadgeTone, PluginVisibilityCondition } from '@shared/plugin.js'

export type PluginActionContext = {
  sessionId?: string
  workdir?: string
  projectId?: string
  messageId?: string
  tab?: string
  [key: string]: unknown
}

const ICON_EXPORTS: Record<string, string> = {
  bell: 'BellIcon',
  check: 'CheckIcon',
  'check-circle': 'CheckIcon',
  'check-square': 'CheckIcon',
  download: 'DownloadIcon',
  external: 'OpenExternalIcon',
  'external-link': 'OpenExternalIcon',
  folder: 'FolderIcon',
  'folder-open': 'FolderIcon',
  gear: 'GearIcon',
  settings: 'GearIcon',
  cog: 'GearIcon',
  info: 'InfoIcon',
  play: 'PlayIcon',
  'play-circle': 'PlayIcon',
  plus: 'PlusIcon',
  'plus-circle': 'PlusIcon',
  puzzle: 'PuzzleIcon',
  refresh: 'ReloadIcon',
  'refresh-cw': 'ReloadIcon',
  'rotate-cw': 'ReloadIcon',
  reload: 'ReloadIcon',
  search: 'SearchIcon',
  star: 'StarIcon',
  stop: 'StopIcon',
  square: 'StopIcon',
  'stop-circle': 'StopIcon',
  terminal: 'TerminalIcon',
  console: 'TerminalIcon',
  prompt: 'TerminalIcon',
  trash: 'TrashIcon',
  'trash-2': 'TrashIcon',
  delete: 'TrashIcon',
  warning: 'WarningIcon',
  alert: 'WarningIcon',
  'alert-triangle': 'WarningIcon',
  edit: 'PencilIcon',
  pencil: 'PencilIcon',
  eye: 'EyeIcon',
  pin: 'PinIcon',
  send: 'SendIcon',
  heart: 'HeartIcon',
  copy: 'CopyIcon',
  clipboard: 'ClipboardIcon',
  branch: 'BranchIcon',
  'git-branch': 'BranchIcon',
  agent: 'AgentIcon',
  bot: 'AgentIcon',
  sparkles: 'AgentIcon',
  brain: 'ThinkingIcon',
  thinking: 'ThinkingIcon',
}

type IconComponent = ComponentType<{ className?: string }>

/**
 * Resolve an icon name or raw SVG path dynamically for plugins.
 * Supports:
 * - Raw SVG path strings starting with "M" or "m"
 * - Known alias names from ICON_EXPORTS
 * - Any exported icon component from shared/icons (case-insensitive / with or without "Icon" suffix)
 */
export function pluginIcon(name: string | undefined): IconComponent {
  if (!name) return exportsIcon('PuzzleIcon') ?? MissingIcon

  // 1. Raw SVG markup or path support
  if (name) {
    const trimmed = name.trim()
    if (trimmed.startsWith('<svg')) {
      return function RawSvgIcon({ className = 'w-4 h-4' }: { className?: string }) {
        return (
          <span
            className={`inline-flex items-center justify-center [&>svg]:w-full [&>svg]:h-full ${className}`}
            dangerouslySetInnerHTML={{ __html: trimmed }}
          />
        )
      }
    }
    if (/^[Mm]\s*[\d.-]/.test(trimmed)) {
      return function DynamicSvgIcon({ className = 'w-4 h-4' }: { className?: string }) {
        return (
          <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={trimmed} />
          </svg>
        )
      }
    }
  }

  // 2. Direct named export lookup
  const direct = exportsIcon(name)
  if (direct) return direct

  // 3. Known alias lookup
  const mapped = ICON_EXPORTS[name.toLowerCase()]
  if (mapped) {
    const fromMapped = exportsIcon(mapped)
    if (fromMapped) return fromMapped
  }

  // 4. Case-insensitive lookup (e.g. "puzzle" -> "PuzzleIcon")
  const lower = name.toLowerCase().replace(/[-_\s]+/g, '')
  for (const [key, value] of Object.entries(iconsModule)) {
    if (typeof value !== 'function') continue
    const keyLower = key.toLowerCase()
    if (keyLower === lower || keyLower === `${lower}icon`) {
      return value as IconComponent
    }
  }

  return MissingIcon
}

function exportsIcon(exportName: string): IconComponent | undefined {
  const mod = iconsModule as Record<string, unknown>
  const found = mod[exportName]
  return typeof found === 'function' ? (found as IconComponent) : undefined
}

function MissingIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={2} strokeDasharray="3 3" />
    </svg>
  )
}

export function badgeToneClasses(tone: PluginBadgeTone | undefined): string {
  switch (tone) {
    case 'info':
      return 'bg-accent-primary/10 text-accent-primary border-accent-primary/20'
    case 'success':
      return 'bg-accent-success/10 text-accent-success border-accent-success/20'
    case 'warning':
      return 'bg-accent-warning/10 text-accent-warning border-accent-warning/20'
    case 'danger':
      return 'bg-accent-error/10 text-accent-error border-accent-error/20'
    case 'neutral':
    default:
      return 'bg-bg-tertiary text-text-muted border-border'
  }
}

export function badgeToneTextClass(tone: PluginBadgeTone | undefined): string {
  switch (tone) {
    case 'info':
      return 'text-accent-primary'
    case 'success':
      return 'text-accent-success'
    case 'warning':
      return 'text-accent-warning'
    case 'danger':
      return 'text-accent-error'
    case 'neutral':
      return 'text-text-muted'
    default:
      return ''
  }
}

export function applyPanelContent(pluginId: string, targetId: string, result: unknown): boolean {
  if (result && typeof result === 'object') {
    const resultObj = result as Record<string, unknown>
    const content = Array.isArray(resultObj['content'])
      ? (resultObj['content'] as DeclarativeNode[])
      : Array.isArray(resultObj['nodes'])
        ? (resultObj['nodes'] as DeclarativeNode[])
        : resultObj['content'] && typeof resultObj['content'] === 'object'
          ? ([resultObj['content']] as DeclarativeNode[])
          : undefined
    const footer = Array.isArray(resultObj['footer']) ? (resultObj['footer'] as DeclarativeNode[]) : undefined
    if (footer) {
      usePluginUiStore.getState().setState(pluginId, targetId, 'footer', footer)
    }
    if (content) {
      usePluginUiStore.getState().setState(pluginId, targetId, 'content', content)
      return true
    }
  }
  return false
}

export function extractScopedValues(
  publishedValues: Record<string, unknown>,
  pluginId: string,
  panelOrTabId?: string,
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const pluginPrefix = `${pluginId}::`
  const targetPrefix = panelOrTabId ? `${pluginId}:${panelOrTabId}:` : undefined

  for (const [key, value] of Object.entries(publishedValues)) {
    if (key.startsWith(pluginPrefix)) {
      values[key.slice(pluginPrefix.length)] = value
    }
  }

  if (targetPrefix) {
    for (const [key, value] of Object.entries(publishedValues)) {
      if (key.startsWith(targetPrefix)) {
        values[key.slice(targetPrefix.length)] = value
      }
    }
  }

  return values
}

export function nodeDeclarativeKey(node: DeclarativeNode, index: number): string {
  if ('id' in node && typeof node.id === 'string' && node.id) {
    return `field-${node.id}`
  }
  if (node.type === 'card' && node.title) {
    const titleStr = typeof node.title === 'string' ? node.title : (node.title.en ?? '')
    return `card-${index}-${titleStr}`
  }
  return `node-${index}-${node.type}`
}

export function isContributionVisible(
  condition: PluginVisibilityCondition | undefined,
  context: PluginActionContext,
): boolean {
  if (!condition) return true
  if (condition.hasProject !== undefined) {
    const actual = Boolean(context.projectId)
    if (actual !== condition.hasProject) return false
  }
  if (condition.hasSession !== undefined) {
    const actual = Boolean(context.sessionId)
    if (actual !== condition.hasSession) return false
  }
  if (condition.hasMessage !== undefined) {
    const actual = Boolean(context.messageId)
    if (actual !== condition.hasMessage) return false
  }
  if (condition.eq) {
    for (const [key, expected] of Object.entries(condition.eq)) {
      if (context[key] !== expected) return false
    }
  }
  if (condition.neq) {
    for (const [key, expected] of Object.entries(condition.neq)) {
      if (context[key] === expected) return false
    }
  }
  return true
}

export function pluginRpcContext(context: {
  sessionId?: unknown
  workdir?: unknown
  projectId?: unknown
  projectName?: unknown
}): {
  sessionId?: string
  workdir?: string
  projectId?: string
  projectName?: string
} {
  return {
    ...(typeof context.sessionId === 'string' ? { sessionId: context.sessionId } : {}),
    ...(typeof context.workdir === 'string' ? { workdir: context.workdir } : {}),
    ...(typeof context.projectId === 'string' ? { projectId: context.projectId } : {}),
    ...(typeof context.projectName === 'string' ? { projectName: context.projectName } : {}),
  }
}

const RPC_ERROR_TITLE = {
  en: 'Plugin Action Failed',
  fr: 'Échec de l’action du plugin',
}

export async function activatePluginAction(
  pluginId: string | undefined,
  activation: PluginActivation | undefined,
  context: PluginActionContext = {},
): Promise<void> {
  if (!pluginId || !activation) return
  try {
    if (activation.kind === 'rpc') {
      const mergedParams = {
        ...(activation.params ?? {}),
        ...(context['fieldId'] ? { fieldId: context['fieldId'] } : {}),
        ...(context['value'] !== undefined ? { value: context['value'] } : {}),
        ...(context['modelId'] ? { modelId: context['modelId'] } : {}),
        ...(context['providerId'] ? { providerId: context['providerId'] } : {}),
      }
      const rpcResult = await invokePluginRpc(pluginId, activation.method, mergedParams, pluginRpcContext(context))

      // If the RPC returned updated declarative nodes or content, update the active panel immediately
      if (rpcResult && typeof rpcResult === 'object') {
        const resultObj = rpcResult as Record<string, unknown>
        const suppliedContent = Array.isArray(resultObj['content']) || Array.isArray(resultObj['nodes'])
        if (typeof resultObj['openPanel'] === 'string') {
          usePluginUiStore.getState().openPanel(pluginId, resultObj['openPanel'] as string, pluginRpcContext(context), {
            skipInitPanel: suppliedContent,
          })
          applyPanelContent(pluginId, resultObj['openPanel'] as string, resultObj)
        } else {
          const activePanel = usePluginUiStore.getState().activePanel
          const targetId =
            activePanel && activePanel.pluginId === pluginId
              ? activePanel.panelId
              : ((context['tabId'] as string | undefined) ?? (context['tab'] as string | undefined))
          if (targetId) {
            applyPanelContent(pluginId, targetId, resultObj)
          } else if (resultObj['content'] && typeof resultObj['content'] === 'object') {
            usePluginUiStore.getState().setState(pluginId, 'content', 'content', resultObj['content'])
          }
        }
        const invalidate = resultObj['invalidate']
        if (Array.isArray(invalidate)) {
          void import('../../lib/resources').then((m) => m.refreshItemResources(invalidate as string[])).catch(() => {})
        }

        // If the RPC response returned a login/OAuth challenge or URL, automatically open or handle it
        if (resultObj['challenge'] && typeof resultObj['challenge'] === 'object') {
          const challenge = resultObj['challenge'] as { verificationUrl?: string; directUrl?: string; url?: string }
          const targetUrl = challenge.directUrl ?? challenge.verificationUrl ?? challenge.url
          if (targetUrl && typeof targetUrl === 'string') {
            window.open(targetUrl, '_blank', 'noopener,noreferrer')
          }
        } else if (typeof resultObj['url'] === 'string') {
          window.open(resultObj['url'], '_blank', 'noopener,noreferrer')
        }
      }

      void import('../../lib/resources').then((m) => m.providersResource.refresh()).catch(() => {})
      return
    }

    if (activation.kind === 'openPanel') {
      const activePanel = usePluginUiStore.getState().activePanel
      const targetPluginId =
        !pluginId || pluginId === 'unknown' ? activePanel?.pluginId || 'openfox-codebase-memory' : pluginId
      usePluginUiStore.getState().openPanel(targetPluginId, activation.panelId, pluginRpcContext(context))
      return
    }

    if (activation.kind === 'closePanel') {
      const activePanel = usePluginUiStore.getState().activePanel
      if (activePanel) {
        usePluginUiStore.getState().clearPanel(activePanel.pluginId, activePanel.panelId)
      }
      usePluginUiStore.getState().closePanel()
      return
    }

    if (activation.kind === 'openSettings') {
      const tab = activation.tab
      void import('../settings/GlobalSettingsModal')
        .then((settings) => settings.openSettings(tab as Parameters<typeof settings.openSettings>[0]))
        .catch(() => {})
      return
    }

    window.open(activation.url, '_blank', 'noopener,noreferrer')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    usePluginToastStore.getState().push({
      id: `plugin-error-${Date.now()}`,
      pluginId,
      title: RPC_ERROR_TITLE,
      body: { en: message, fr: message },
      level: 'error',
      createdAt: new Date().toISOString(),
    })
  }
}
