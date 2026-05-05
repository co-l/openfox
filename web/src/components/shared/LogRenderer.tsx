import { ansiToReact } from '../../lib/ansiParser'

interface LogRendererProps {
  logs: { stream: 'stdout' | 'stderr'; content: string }[]
  preRef?: React.RefObject<HTMLPreElement | null>
  preClassName?: string
}

export function LogRenderer({ logs, preRef, preClassName = 'text-sm font-mono' }: LogRendererProps) {
  return (
    <pre ref={preRef} className={preClassName}>
      {logs.length === 0 ? (
        <span className="text-text-muted">No output yet</span>
      ) : (
        logs.map((chunk, i) => (
          <span key={i} className={chunk.stream === 'stderr' ? 'text-accent-warning' : ''}>
            {ansiToReact(chunk.content)}
          </span>
        ))
      )}
    </pre>
  )
}