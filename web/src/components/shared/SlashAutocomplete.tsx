import { ScrollArea } from './ScrollArea'
import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useFloatingPanel } from '../../hooks/useFloatingPanel'
import { getSlashAtCursor } from '../../lib/getSlashAtCursor'
import { SCOPE_LABELS } from '../../lib/workflow-scope'
import type { WorkflowInfo } from '../../lib/parse-slash-command'
import type { CommandInfo } from '../../lib/parse-slash-command'
import type { WorkflowScope } from '@shared/types.js'
import { useT } from '../../hooks/useT'

export type SlashSuggestion =
  | { type: 'workflow'; id: string; name: string; scope: WorkflowScope; paramCount: number }
  | { type: 'command'; id: string; name: string; paramCount: number }

interface SlashAutocompleteProps {
  text: string
  cursorPos: number
  workflows: WorkflowInfo[]
  commands: CommandInfo[]
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
  { text, cursorPos, workflows, commands, onSelect, anchorRef },
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
    return [...wf, ...cmd]
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
          <span className={`font-medium ${item.type === 'workflow' ? 'text-accent-primary' : 'text-accent-warning'}`}>
            /{item.id}
          </span>
          <span className="truncate flex-1">{item.name}</span>
          {item.type === 'workflow' && (
            <span className="text-[10px] text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded whitespace-nowrap">
              {SCOPE_LABELS[item.scope]}
            </span>
          )}
          {item.paramCount > 0 && (
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

  if (anchorRef) {
    const panel = (
      <div
        ref={panelRef}
        role="listbox"
        className="fixed z-[100]"
        style={{ top: layout?.top ?? 0, left: layout?.left ?? 0, width: layout?.width }}
      >
        <ScrollArea className="bg-bg-secondary border border-border rounded-lg shadow-lg max-h-64">
          {itemsMarkup}
        </ScrollArea>
      </div>
    )
    return createPortal(panel, document.body)
  }

  return (
    <div ref={containerRef} className="absolute bottom-full left-0 right-0 mb-2 z-50" role="listbox">
      <ScrollArea className="bg-bg-secondary border border-border rounded-lg shadow-lg max-h-64">
        {itemsMarkup}
      </ScrollArea>
    </div>
  )
})

export { SlashAutocomplete }
