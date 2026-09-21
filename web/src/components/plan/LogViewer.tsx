import { ScrollArea } from '../shared/ScrollArea'
import { memo, useRef } from 'react'
import { Modal } from '../shared/Modal'
import { LogRenderer } from '../shared/LogRenderer'
import { AutoScrollToggle } from '../shared/AutoScrollToggle'
import { TrashIcon, PlusIcon } from '../shared/icons'
import { useT } from '../../hooks/useT'
import { useAutoScroll } from '../../hooks/useAutoScroll'
import { useViewport } from '../../hooks/useViewport'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'

interface LogViewerProps {
  title: string
  subtitle?: string
  logs: { stream: 'stdout' | 'stderr'; content: string; type?: 'marker' }[]
  onClose: () => void
  onClear?: () => void
  onInsertMarker?: () => void
  preClassName?: string
}

export const LogViewer = memo(function LogViewer({
  title,
  subtitle,
  logs,
  onClose,
  onClear,
  onInsertMarker,
  preClassName,
}: LogViewerProps) {
  const t = useT()
  const scrollRef = useRef<OverlayScrollbarsComponentRef<'div'>>(null)

  const getViewport = useViewport(scrollRef)

  const { isAutoScrollActive, setAutoScroll, handleScrollbarGesture } = useAutoScroll(scrollRef, null, getViewport)

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={title}
      size="full"
      scrollable={false}
      headerRight={
        <AutoScrollToggle
          isActive={isAutoScrollActive}
          onToggle={setAutoScroll}
          className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-colors"
        />
      }
      footer={
        <div className="flex items-center gap-2">
          {onInsertMarker && (
            <button
              onClick={onInsertMarker}
              className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1 px-2 py-1 rounded hover:bg-bg-tertiary transition-colors"
              title={t({ en: 'Insert marker', fr: 'Insérer un repère' })}
            >
              <PlusIcon className="w-3.5 h-3.5" />
              {t({ en: 'Marker', fr: 'Repère' })}
            </button>
          )}
          {onClear && (
            <button
              onClick={onClear}
              className="text-xs text-text-muted hover:text-accent-error flex items-center gap-1 px-2 py-1 rounded hover:bg-bg-tertiary transition-colors"
              title={t({ en: 'Clear logs', fr: 'Effacer les journaux' })}
            >
              <TrashIcon className="w-3.5 h-3.5" />
              {t({ en: 'Clear', fr: 'Effacer' })}
            </button>
          )}
        </div>
      }
    >
      {subtitle && (
        <div className="subtitle-strip flex items-start gap-2 px-2 py-1.5 mb-2 bg-bg-tertiary rounded text-[11px] font-mono text-text-secondary whitespace-pre-wrap break-all border border-border">
          <span className="text-text-muted flex-shrink-0 select-none">{t({ en: 'Command:', fr: 'Commande :' })}</span>
          <span>{subtitle}</span>
        </div>
      )}
      <ScrollArea ref={scrollRef} className="flex-1 -m-4 p-4" onScrollbarGesture={handleScrollbarGesture}>
        <LogRenderer logs={logs} preClassName={preClassName} />
      </ScrollArea>
    </Modal>
  )
})
