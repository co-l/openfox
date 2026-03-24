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

  return (
    <div
      role="list"
      className="mb-2 p-2 bg-bg-secondary border border-border rounded-lg overflow-y-auto max-h-64"
      onKeyDown={handleKeyDown}
    >
      {history.map((item, index) => (
        <div
          key={item.id}
          role="listitem"
          className={`
            p-2 rounded cursor-pointer transition-colors
            ${index === selectedIndex 
              ? 'bg-accent-primary/20 border border-accent-primary' 
              : 'hover:bg-bg-tertiary'}
          `}
        >
          <div className="text-xs text-text-muted font-mono">
            {item.formattedTimestamp}
          </div>
          <div className="text-sm text-text-primary mt-1">
            {item.trimmedContent}
          </div>
          {index < history.length - 1 && (
            <div className="mt-2 text-text-muted text-xs">-------</div>
          )}
        </div>
      ))}
    </div>
  )
}
