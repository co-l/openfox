import { Fragment } from 'react'
import { ScrollArea } from './ScrollArea'
import type { ScrollbarGestureKind } from './ScrollArea'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'
import { ansiToReact } from '../../lib/ansiParser'
import { useT } from '../../hooks/useT'

interface LogEntry {
  stream: 'stdout' | 'stderr'
  content: string
  type?: 'marker'
}

interface LogRendererProps {
  logs: LogEntry[]
  preRef?: React.RefObject<HTMLPreElement | null>
  preClassName?: string
  scrollAreaRef?: React.Ref<OverlayScrollbarsComponentRef<'div'>>
  onScrollbarGesture?: (kind: ScrollbarGestureKind, gapToEndPx: number | null) => void
}

export function LogRenderer({
  logs,
  preRef,
  preClassName = 'text-sm font-mono',
  scrollAreaRef,
  onScrollbarGesture,
}: LogRendererProps) {
  const t = useT()
  return (
    <ScrollArea
      ref={scrollAreaRef}
      options={{ overflow: { x: 'scroll', y: 'scroll' } }}
      className={preClassName}
      onScrollbarGesture={onScrollbarGesture}
    >
      <pre ref={preRef} className="contents">
        {logs.length === 0 ? (
          <span className="text-text-muted">{t({ en: 'No output yet', fr: 'Aucune sortie pour l’instant' })}</span>
        ) : (
          logs.map((chunk, i) =>
            chunk.type === 'marker' ? (
              <Fragment key={i}>
                <hr className="border-t border-border my-1" />
              </Fragment>
            ) : (
              <span key={i} className={chunk.stream === 'stderr' ? 'text-accent-warning' : ''}>
                {ansiToReact(chunk.content)}
              </span>
            ),
          )
        )}
      </pre>
    </ScrollArea>
  )
}
