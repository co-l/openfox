import { ScrollArea } from './ScrollArea'
import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useFloatingPanel } from '../../hooks/useFloatingPanel'
import { getSlashAtCursor } from '../../lib/getSlashAtCursor'
import { SCOPE_LABELS } from '../../lib/workflow-scope'
import { SETTINGS_KEYS } from '../../lib/resources'
import { useSetting } from '../../hooks/useSetting'
import type { WorkflowInfo } from '../../lib/parse-slash-command'
import type { CommandInfo } from '../../lib/parse-slash-command'
import type { WorkflowScope } from '@shared/types.js'
import { useT } from '../../hooks/useT'

export interface SkillSlashInfo {
  id: string
  name: string
  description?: string
}

export type SlashSuggestion =
  | { type: 'workflow'; id: string; name: string; scope: WorkflowScope; paramCount: number }
  | { type: 'command'; id: string; name: string; paramCount: number }
  | { type: 'skill'; id: string; name: string; description?: string }

interface SlashAutocompleteProps {
  text: string
  cursorPos: number
  workflows: WorkflowInfo[]
  commands: CommandInfo[]
  skills?: SkillSlashInfo[]
  onSelect: (suggestion: SlashSuggestion, startIndex: number) => void
  /**
   * When provided, the dropdown renders into a portal fixed to this anchor
   * element instead of absolutely inside the composer, escaping overflow-hidden
   * ancestors (modal bodies, scroll areas). Omit for the in-flow chat behavior.
   */
  anchorRef?: RefObject<HTMLElement | null>
}

export interface SlashAutocompleteHandle {
  handleKeyDown: (e: React.KeyboardEvent) => boolean
}

const SlashAutocomplete = forwardRef<SlashAutocompleteHandle, SlashAutocompleteProps>(function SlashAutocomplete(
  { text, cursorPos, workflows, commands, skills = [], onSelect, anchorRef },
  ref,
) {
  const t = useT()
  const slash = getSlashAtCursor(text, cursorPos)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([])
  const selectedIndexRef = useRef(0)
  const suggestionsRef = useRef<SlashSuggestion[]>([])

  useEffect(() => {
    selectedIndexRef.current = selectedIndex
  }, [selectedIndex])

  useEffect(() => {
    suggestionsRef.current = suggestions
  })

  const query = slash?.query ?? ''
  const suggestions: SlashSuggestion[] = (() => {
    if (!slash) return []
    const q = query.toLowerCase()
    const wf: SlashSuggestion[] = workflows
      .filter((w) => w.id.toLowerCase().includes(q) || w.name.toLowerCase().includes(q))
      .map((w) => ({
        type: 'workflow' as const,
        id: w.id,
        name: w.name,
        scope: w.scope,
        paramCount: (w.parameters ?? []).length,
      }))
    const cmd: SlashSuggestion[] = commands
      .filter((c) => c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .map((c) => ({
        type: 'command' as const,
        id: c.id,
        name: c.name,
        paramCount: 0,
      }))
    const skl: SlashSuggestion[] = skills
      .filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q)),
      )
      .map((s) => ({
        type: 'skill' as const,
        id: s.id,
        name: s.name,
        description: s.description,
      }))
    return [...wf, ...cmd, ...skl]
  })()

  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedIndex(0)
    selectedIndexRef.current = 0
  }, [suggestions.length])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!slash || suggestions.length === 0) return false

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => {
            const next = Math.min(i + 1, suggestions.length - 1)
            itemsRef.current[next]?.scrollIntoView({ block: 'nearest' })
            return next
          })
          return true
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => {
            const next = Math.max(i - 1, 0)
            itemsRef.current[next]?.scrollIntoView({ block: 'nearest' })
            return next
          })
          return true
        case 'Enter':
        case 'Tab': {
          const sel = suggestions[selectedIndexRef.current]
          if (sel) {
            e.preventDefault()
            onSelect(sel, slash.startIndex)
            return true
          }
          return false
        }
        case 'Escape':
          e.preventDefault()
          // Parent handles closing
          return true
      }
      return false
    },
    [slash, suggestions, onSelect],
  )

  useImperativeHandle(ref, () => ({ handleKeyDown }), [handleKeyDown])

  const { panelRef, layout } = useFloatingPanel(anchorRef, !!slash && suggestions.length > 0)
  const isFullscreen = useSetting(SETTINGS_KEYS.DISPLAY_FULLSCREEN_SLASH_COMMAND, 'false').value === 'true'

  if (!slash || suggestions.length === 0) return null

  const itemsMarkup = (
    <div>
      {suggestions.map((item, index) => (
        <button
          key={`${item.type}-${item.id}-${item.type === 'workflow' ? item.scope : ''}`}
          ref={(el) => {
            itemsRef.current[index] = el
          }}
          role="option"
          aria-selected={index === selectedIndex}
          className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm ${
            index === selectedIndex ? 'bg-accent-primary/20 text-text-primary' : 'text-text-muted hover:bg-bg-tertiary'
          }`}
          onClick={() => {
            if (slash) onSelect(item, slash.startIndex)
          }}
        >
          <span
            className={`font-medium ${
              item.type === 'workflow'
                ? 'text-accent-primary'
                : item.type === 'skill'
                  ? 'text-accent-success'
                  : 'text-accent-warning'
            }`}
          >
            /{item.id}
          </span>
          <span className="truncate flex-1">{item.name}</span>
          {item.type === 'workflow' && (
            <span className="text-[10px] text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded whitespace-nowrap">
              {SCOPE_LABELS[item.scope]}
            </span>
          )}
          {item.type === 'skill' && (
            <span className="text-[10px] text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded whitespace-nowrap">
              {t({ en: 'Skill', fr: 'Compétence' })}
            </span>
          )}
          {item.type !== 'skill' && item.paramCount > 0 && (
            <span className="text-[10px] text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded">
              {item.paramCount}{' '}
              {t(
                { en: { one: 'param', other: 'params' }, fr: { one: 'paramètre', other: 'paramètres' } },
                { count: item.paramCount },
              )}
            </span>
          )}
        </button>
      ))}
    </div>
  )

  if (isFullscreen) {
    const targetTop = (() => {
      if (typeof document !== 'undefined') {
        const topHeader = document.querySelector('header')
        if (topHeader) {
          return Math.round(topHeader.getBoundingClientRect().bottom + 10)
        }
      }
      return 42
    })()

    if (anchorRef) {
      const panel = (
        <div
          ref={panelRef}
          role="listbox"
          className="fixed z-[100]"
          style={{
            top: targetTop,
            left: layout?.left ?? 0,
            width: layout?.width,
            bottom: window.innerHeight - (layout?.top ?? 0) + 8,
          }}
        >
          <div className="bg-bg-secondary border border-border rounded-lg shadow-2xl h-full flex flex-col overflow-hidden">
            <ScrollArea className="flex-1 h-full max-h-none">{itemsMarkup}</ScrollArea>
          </div>
        </div>
      )
      return createPortal(panel, document.body)
    }

    return (
      <div
        ref={containerRef}
        className="fixed z-50 left-2 right-2 md:left-auto md:right-auto"
        style={{
          top: `${targetTop}px`,
          bottom: '84px',
          left: containerRef.current?.getBoundingClientRect().left ?? undefined,
          width: containerRef.current?.getBoundingClientRect().width ?? undefined,
        }}
        role="listbox"
      >
        <div className="bg-bg-secondary border border-border rounded-lg shadow-2xl h-full flex flex-col overflow-hidden">
          <ScrollArea className="flex-1 h-full max-h-none">{itemsMarkup}</ScrollArea>
        </div>
      </div>
    )
  }

  if (anchorRef) {
    const panel = (
      <div
        ref={panelRef}
        role="listbox"
        className="fixed z-[100]"
        style={{ top: layout?.top ?? 0, left: layout?.left ?? 0, width: layout?.width }}
      >
        <div className="bg-bg-secondary border border-border rounded-lg shadow-2xl max-h-64 flex flex-col overflow-hidden">
          <ScrollArea className="max-h-64">{itemsMarkup}</ScrollArea>
        </div>
      </div>
    )
    return createPortal(panel, document.body)
  }

  return (
    <div ref={containerRef} className="absolute bottom-full left-0 right-0 mb-2 z-50" role="listbox">
      <div className="bg-bg-secondary border border-border rounded-lg shadow-2xl max-h-64 flex flex-col overflow-hidden">
        <ScrollArea className="max-h-64">{itemsMarkup}</ScrollArea>
      </div>
    </div>
  )
})

export { SlashAutocomplete }
