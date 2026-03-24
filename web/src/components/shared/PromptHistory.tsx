import { useEffect, useRef } from 'react'
import type { PromptHistoryItem } from '../hooks/usePromptHistory'

interface PromptHistoryListProps {
  history: PromptHistoryItem[]
  selectedIndex: number
  onSelect: (content: string) => void
  onEscape: () => void
  onNavigate: (direction: 'up' | 'down') => void
}

export function PromptHistoryList({
  history,
  selectedIndex,
  onSelect,
  onEscape,
  onNavigate,
}: PromptHistoryListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedItemRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to keep selected item in view
  useEffect(() => {
    if (selectedItemRef.current && containerRef.current) {
      selectedItemRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      })
    }
  }, [selectedIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Enter':
        e.preventDefault()
        if (history[selectedIndex]) {
          onSelect(history[selectedIndex].content)
        }
        break
      case 'Escape':
        e.preventDefault()
        onEscape()
        break
      case 'ArrowUp':
        e.preventDefault()
        onNavigate('up')
        break
      case 'ArrowDown':
        e.preventDefault()
        onNavigate('down')
        break
    }
  }

  const handleSelect = (content: string) => {
    onSelect(content)
  }

  return (
    <div
      ref={containerRef}
      role="list"
      className="mb-2 p-2 bg-bg-secondary border border-border rounded-lg overflow-y-auto max-h-64"
      onKeyDown={handleKeyDown}
    >
      {history.map((item, index) => (
        <div
          ref={index === selectedIndex ? selectedItemRef : null}
          key={item.id}
          role="listitem"
          onClick={() => handleSelect(item.content)}
          className={`
            p-2 rounded cursor-pointer transition-colors
            ${index === selectedIndex 
              ? 'bg-accent-primary/20 border border-accent-primary' 
              : 'hover:bg-bg-tertiary'}
          `}
        >
          <div className="text-xs text-text-muted font-mono">
            {item.formattedTimestamp}
            {item.sessionName && (
              <>
                {' | '}
                <span className="text-accent-primary font-medium">
                  {item.sessionName}
                </span>
              </>
            )}
          </div>
          <div className="text-sm text-text-primary mt-1">
            {item.trimmedContent}
          </div>
        </div>
      ))}
    </div>
  )
}
