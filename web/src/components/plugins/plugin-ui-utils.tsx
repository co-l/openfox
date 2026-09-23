import type { ComponentType } from 'react'
import * as iconsModule from '../shared/icons'
import { invokePluginRpc } from '../../lib/plugin-actions'
import { usePluginUiStore } from '../../stores/pluginUi'
import { usePluginToastStore } from '../../stores/pluginToasts'
import type { PluginActivation, PluginBadgeTone, PluginVisibilityCondition } from '@shared/plugin.js'

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
  download: 'DownloadIcon',
  external: 'OpenExternalIcon',
  folder: 'FolderIcon',
  gear: 'GearIcon',
  info: 'InfoIcon',
  play: 'PlayIcon',
  plus: 'PlusIcon',
  puzzle: 'PuzzleIcon',
  refresh: 'ReloadIcon',
  search: 'SearchIcon',
  star: 'StarIcon',
  terminal: 'TerminalIcon',
  trash: 'TrashIcon',
  warning: 'WarningIcon',
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
  return true
}

export function pluginRpcContext(context: PluginActionContext): {
  sessionId?: string
  workdir?: string
  projectId?: string
} {
  return {
    ...(typeof context.sessionId === 'string' ? { sessionId: context.sessionId } : {}),
    ...(typeof context.workdir === 'string' ? { workdir: context.workdir } : {}),
    ...(typeof context.projectId === 'string' ? { projectId: context.projectId } : {}),
  }
}

const RPC_ERROR_TITLE = {
  en: 'Plugin Action Failed',
  fr: 'Échec de l’action du plugin',
}

export async function activatePluginAction(
  pluginId: string | undefined,
  activation: PluginActivation,
  context: PluginActionContext = {},
): Promise<void> {
  if (!pluginId) return
  try {
    if (activation.kind === 'rpc') {
      await invokePluginRpc(pluginId, activation.method, activation.params ?? {}, pluginRpcContext(context))

      // If active panel is currently open and belongs to this plugin, refresh dynamic content if supported
      const activePanel = usePluginUiStore.getState().activePanel
      if (activePanel && activePanel.pluginId === pluginId) {
        try {
          const res = (await invokePluginRpc(
            pluginId,
            `${activePanel.panelId}.getContent`,
            {},
            pluginRpcContext(context),
          )) as {
            nodes?: unknown[]
          }
          if (res && Array.isArray(res.nodes)) {
            usePluginUiStore.getState().setState(pluginId, activePanel.panelId, 'content', res.nodes)
          }
        } catch {
          // Gracefully ignore if custom getContent not implemented
        }
      }

      void import('../../lib/resources').then((m) => m.providersResource.refresh()).catch(() => {})
      return
    }

    if (activation.kind === 'openPanel') {
      usePluginUiStore.getState().openPanel(pluginId, activation.panelId, pluginRpcContext(context))
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
