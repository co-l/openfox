import { Markdown } from './Markdown'

interface ThinkingBlockProps {
  content: string
  variant?: 'default' | 'labeled'
}

export function ThinkingBlock({ content, variant = 'default' }: ThinkingBlockProps) {
  if (variant === 'labeled') {
    return (
      <div className="text-text-muted text-sm italic mb-3">
        <span className="text-purple-400">thinking:</span>
        <div className="ml-1.5 mt-0.5">
          <Markdown content={content} />
        </div>
      </div>
    )
  }
  
  return (
    <div className="text-text-muted text-sm italic bg-bg-tertiary/50 rounded p-1.5 mb-3 whitespace-pre-wrap">
      {content}
    </div>
  )
}
