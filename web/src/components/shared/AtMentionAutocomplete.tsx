import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react'
import { getAtMentionAtCursor } from '../../lib/atMention'
import { authFetch } from '../../lib/api'
import { Spinner } from '../shared/Spinner'
import { FolderIcon } from '../shared/icons'

interface FileSuggestion {
  path: string
  name: string
  type: 'file' | 'directory'
  score: number
}

interface AtMentionAutocompleteProps {
  text: string
  cursorPos: number
  workdir?: string | null
  onSelect: (suggestion: FileSuggestion, startIndex: number) => void
}

export interface AtMentionAutocompleteHandle {
  handleKeyDown: (e: React.KeyboardEvent) => boolean
}

const AtMentionAutocomplete = forwardRef<AtMentionAutocompleteHandle, AtMentionAutocompleteProps>(
  function AtMentionAutocomplete({ text, cursorPos, workdir, onSelect }, ref) {
  const mention = getAtMentionAtCursor(text, cursorPos)
  const [suggestions, setSuggestions] = useState<FileSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<(HTMLLIElement | null)[]>([])
  const selectedIndexRef = useRef(0)
  const suggestionsRef = useRef<FileSuggestion[]>([])

  useEffect(() => {
    selectedIndexRef.current = selectedIndex
  }, [selectedIndex])

  useEffect(() => {
    suggestionsRef.current = suggestions
  }, [suggestions])

  useEffect(() => {
    if (!mention) {
      setSuggestions([])
      return
    }

    const timeoutId = setTimeout(() => {
      fetchSuggestions(mention.query)
    }, 150)

    return () => clearTimeout(timeoutId)
  }, [mention?.query, workdir])

  const fetchSuggestions = async (query: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: query })
      if (workdir) params.set('workdir', workdir)
      const response = await authFetch(`/api/files?${params.toString()}`)
      const data: FileSuggestion[] = await response.json()
      setSuggestions(data)
      setSelectedIndex(0)
      selectedIndexRef.current = 0
    } catch (err) {
      console.error('File search failed:', err)
      setSuggestions([])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!mention) return false

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => {
            const next = Math.min(i + 1, suggestionsRef.current.length - 1)
            if (itemsRef.current[next]) {
              itemsRef.current[next]?.scrollIntoView({ block: 'nearest' })
            }
            return next
          })
          return true
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => {
            const next = Math.max(i - 1, 0)
            if (itemsRef.current[next]) {
              itemsRef.current[next]?.scrollIntoView({ block: 'nearest' })
            }
            return next
          })
          return true
        case 'Enter':
        case 'Tab': {
          const currentSuggestions = suggestionsRef.current
          if (currentSuggestions[selectedIndexRef.current]) {
            e.preventDefault()
            onSelect(currentSuggestions[selectedIndexRef.current]!, mention.startIndex)
            return true
          }
          return false
        }
        case 'Escape':
          e.preventDefault()
          setSuggestions([])
          return true
      }
      return false
    },
    [mention, onSelect],
  )

  useImperativeHandle(ref, () => ({ handleKeyDown }), [handleKeyDown])

  useEffect(() => {
    if (!mention) return

    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSuggestions([])
      }
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [mention])

  if (!mention) return null

  if (loading) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
        <div className="bg-bg-secondary border border-border rounded-lg shadow-lg">
          <div className="p-4 text-center">
            <Spinner size="sm" />
          </div>
        </div>
      </div>
    )
  }

  if (suggestions.length === 0) return null

  return (
    <div ref={containerRef} className="absolute bottom-full left-0 right-0 mb-2 z-50">
      <div className="bg-bg-secondary border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
        <ul className="py-1">
          {suggestions.map((item, index) => (
            <li
              ref={(el) => {
                itemsRef.current[index] = el
              }}
              key={item.path}
              className={`px-3 py-2 cursor-pointer flex items-center gap-2 text-sm ${
                index === selectedIndex
                  ? 'bg-accent-primary/20 text-text-primary'
                  : 'text-text-muted hover:bg-bg-tertiary'
              }`}
              onClick={() => {
                if (mention) {
                  onSelect(item, mention.startIndex)
                }
              }}
            >
              {item.type === 'directory' ? (
                <FolderIcon className="w-4 h-4 shrink-0" />
              ) : (
                <span className="w-4 h-4 shrink-0" />
              )}
              <span className="truncate">{item.path}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
  },
)

export { AtMentionAutocomplete }
export type { FileSuggestion }
