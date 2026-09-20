import { useLocalizedString } from '../../hooks/useLocalizedString'
import { activatePluginAction, badgeToneClasses, pluginIcon, type PluginActionContext } from './plugin-ui-utils'
import type { DeclarativeNode, PluginBadgeTone } from '@shared/plugin.js'

const PROGRESS_COLORS: Record<string, string> = {
  neutral: 'bg-text-muted',
  info: 'bg-accent-primary',
  success: 'bg-accent-success',
  warning: 'bg-accent-warning',
  danger: 'bg-accent-error',
}

const BUTTON_VARIANT_CLASSES: Record<'default' | 'primary' | 'danger' | 'ghost', string> = {
  default: 'bg-bg-tertiary text-text-primary hover:bg-bg-primary',
  primary: 'bg-accent-primary text-white hover:bg-accent-primary/80',
  danger: 'bg-accent-error text-white hover:bg-accent-error/80',
  ghost: 'p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary',
}

const GAP_CLASSES: Record<'none' | 'xs' | 'sm' | 'md' | 'lg', string> = {
  none: 'gap-0',
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-3',
  lg: 'gap-4',
}

const ALIGN_CLASSES: Record<'start' | 'center' | 'end' | 'stretch', string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
}

const JUSTIFY_CLASSES: Record<'start' | 'center' | 'end' | 'between', string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
}

const CALLOUT_CLASSES: Record<PluginBadgeTone, string> = {
  neutral: 'bg-bg-tertiary border-border text-text-primary',
  info: 'bg-accent-primary/10 border-accent-primary/30 text-text-primary',
  success: 'bg-accent-success/10 border-accent-success/30 text-text-primary',
  warning: 'bg-accent-warning/10 border-accent-warning/30 text-text-primary',
  danger: 'bg-accent-error/10 border-accent-error/30 text-text-primary',
}

export function interpolate(text: string, values: Record<string, unknown>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in values ? String(values[key]) : match))
}

export interface DeclarativeRendererProps {
  node: DeclarativeNode
  values?: Record<string, unknown>
  context?: PluginActionContext & { pluginId?: string }
}

export function DeclarativeRenderer({ node, values = {}, context = {} }: DeclarativeRendererProps) {
  const localize = useLocalizedString()

  switch (node.type) {
    case 'text':
      return (
        <p className={node.muted ? 'text-sm text-text-muted' : 'text-sm text-text-primary'}>
          {interpolate(localize(node.text), values)}
        </p>
      )

    case 'keyValue':
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {node.items.map((item, index) => (
            <div key={index} className="contents">
              <dt className="text-text-muted">{localize(item.key)}</dt>
              <dd className="text-text-primary">{interpolate(item.value, values)}</dd>
            </div>
          ))}
        </dl>
      )

    case 'table':
      return (
        <table className="w-full text-sm">
          <thead>
            <tr>
              {node.columns.map((column, index) => (
                <th key={index} className="text-left text-text-muted font-medium pb-1">
                  {localize(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {node.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="py-0.5 text-text-primary">
                    {interpolate(cell, values)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )

    case 'progress':
      return (
        <div>
          <div className="flex justify-between text-xs text-text-muted mb-1">
            <span>{localize(node.label)}</span>
            <span>
              {node.value} / {node.max}
            </span>
          </div>
          <div className="h-2 rounded bg-bg-tertiary overflow-hidden">
            <div
              className={`h-full ${PROGRESS_COLORS[node.tone ?? 'info'] ?? 'bg-accent-primary'}`}
              style={{ width: `${node.max > 0 ? Math.min(100, (node.value / node.max) * 100) : 0}%` }}
            />
          </div>
        </div>
      )

    case 'badge':
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${badgeToneClasses(
            node.tone,
          )}`}
        >
          {localize(node.label)}
        </span>
      )

    case 'button': {
      const Icon = node.icon ? pluginIcon(node.icon) : null
      const labelText = localize(node.label)
      const isGhost = node.variant === 'ghost'
      return (
        <button
          type="button"
          title={labelText || undefined}
          aria-label={labelText || undefined}
          onClick={() => void activatePluginAction(context.pluginId, node.onActivate, context)}
          className={`transition-colors ${
            isGhost
              ? BUTTON_VARIANT_CLASSES.ghost
              : `inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium ${
                  BUTTON_VARIANT_CLASSES[node.variant ?? 'default']
                }`
          }`}
        >
          {Icon && <Icon className="w-4 h-4" />}
          {!isGhost && labelText && <span>{labelText}</span>}
        </button>
      )
    }

    case 'divider':
      return <hr className="border-border my-2" />

    case 'stack': {
      const directionClass = node.direction === 'row' ? 'flex flex-row' : 'flex flex-col'
      const gapClass = GAP_CLASSES[node.gap ?? 'sm']
      const alignClass = ALIGN_CLASSES[node.align ?? 'start']
      const justifyClass = JUSTIFY_CLASSES[node.justify ?? 'start']
      return (
        <div className={`${directionClass} ${gapClass} ${alignClass} ${justifyClass} ${node.className ?? ''}`}>
          {node.children.map((child, index) => (
            <DeclarativeRenderer key={index} node={child} values={values} context={context} />
          ))}
        </div>
      )
    }

    case 'card': {
      return (
        <div className="rounded-lg border border-border bg-bg-secondary p-3 shadow-sm space-y-2">
          {(node.title || node.subtitle) && (
            <div className="space-y-0.5">
              {node.title && <h4 className="text-sm font-semibold text-text-primary">{localize(node.title)}</h4>}
              {node.subtitle && <p className="text-xs text-text-muted">{localize(node.subtitle)}</p>}
            </div>
          )}
          <div className="space-y-2">
            {node.children.map((child, index) => (
              <DeclarativeRenderer key={index} node={child} values={values} context={context} />
            ))}
          </div>
        </div>
      )
    }

    case 'callout': {
      const Icon = node.icon ? pluginIcon(node.icon) : pluginIcon(node.tone === 'danger' ? 'warning' : 'info')
      return (
        <div
          className={`flex items-start gap-2.5 p-3 rounded-md border text-sm ${CALLOUT_CLASSES[node.tone ?? 'info']}`}
        >
          <Icon className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="space-y-1">
            {node.title && <div className="font-medium text-text-primary">{localize(node.title)}</div>}
            <div className="text-text-secondary">{interpolate(localize(node.text), values)}</div>
          </div>
        </div>
      )
    }

    case 'icon': {
      const Icon = pluginIcon(node.icon)
      return <Icon className={`w-4 h-4 ${node.className ?? ''}`} />
    }

    case 'input': {
      return (
        <div className="space-y-1">
          {node.label && (
            <label className="block text-xs font-medium text-text-secondary">{localize(node.label)}</label>
          )}
          <input
            id={node.id}
            type={node.inputType ?? 'text'}
            defaultValue={node.defaultValue}
            placeholder={node.placeholder ? localize(node.placeholder) : undefined}
            className="w-full px-2.5 py-1.5 text-sm rounded bg-bg-tertiary border border-border text-text-primary focus:outline-none focus:border-accent-primary"
          />
        </div>
      )
    }

    case 'select': {
      return (
        <div className="space-y-1">
          {node.label && (
            <label className="block text-xs font-medium text-text-secondary">{localize(node.label)}</label>
          )}
          <select
            id={node.id}
            defaultValue={node.defaultValue}
            className="w-full px-2.5 py-1.5 text-sm rounded bg-bg-tertiary border border-border text-text-primary focus:outline-none focus:border-accent-primary"
          >
            {node.options.map((option) => (
              <option key={option.value} value={option.value}>
                {localize(option.label)}
              </option>
            ))}
          </select>
        </div>
      )
    }

    case 'iframe': {
      const height = typeof node.height === 'number' ? `${node.height}px` : (node.height ?? '200px')
      const width = typeof node.width === 'number' ? `${node.width}px` : (node.width ?? '100%')
      return (
        <iframe
          src={node.url}
          style={{ height, width }}
          sandbox="allow-scripts allow-forms allow-same-origin"
          className="border-0 rounded"
        />
      )
    }

    default:
      return null
  }
}
