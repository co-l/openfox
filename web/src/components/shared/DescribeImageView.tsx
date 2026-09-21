import { useState } from 'react'
import { ImageModal } from './ImageModal'
import { Markdown } from './Markdown'
import { useT } from '../../hooks/useT'

interface DescribeImageViewProps {
  args: Record<string, unknown>
  result?: string
  metadata?: Record<string, unknown>
  pending?: boolean
}

/**
 * Rich display for the describe_image tool: a clickable image thumbnail, the
 * question the non-vision model asked, and the answer the vision fallback
 * model returned — rendered as clearly distinct content. While the fallback
 * call is in flight a live "describing" indicator is shown.
 */
export function DescribeImageView({ args, result, metadata, pending }: DescribeImageViewProps) {
  const t = useT()
  const [modalOpen, setModalOpen] = useState(false)

  const mimeType = metadata?.['mimeType'] as string | undefined
  const base64Data = metadata?.['base64Data'] as string | undefined
  const dataUrl = metadata?.['dataUrl'] as string | undefined
  const question = (metadata?.['question'] as string | undefined) ?? String(args['question'] ?? '')
  const filePath = String(metadata?.['path'] ?? args['path'] ?? '')
  const answer = result ?? ''

  const src =
    dataUrl ?? (mimeType?.startsWith('image/') && base64Data ? `data:${mimeType};base64,${base64Data}` : undefined)

  return (
    <div className="space-y-2">
      {src && (
        <>
          <div
            className="rounded overflow-hidden border border-border max-h-[32vh] flex items-center justify-center cursor-pointer hover:border-accent-primary transition-colors"
            onClick={() => setModalOpen(true)}
          >
            <img src={src} alt={filePath} className="max-w-full max-h-[32vh] object-contain" />
          </div>
          <ImageModal src={src} alt={filePath} isOpen={modalOpen} onClose={() => setModalOpen(false)} />
        </>
      )}

      {question && (
        <div className="flex gap-2">
          <div className="w-px self-stretch bg-accent-primary/50" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-text-muted uppercase tracking-wide mb-0.5">
              {t({ en: 'Question', fr: 'Question' })}
            </div>
            <div className="text-xs text-text-secondary">{question}</div>
          </div>
        </div>
      )}

      {pending && (
        <div className="text-xs text-text-muted animate-pulse">
          {t({ en: 'Asking the vision fallback model…', fr: 'Question au modèle de fallback vision…' })}
        </div>
      )}

      {answer && (
        <div>
          <div className="text-[10px] text-accent-primary font-medium mb-0.5 uppercase tracking-wide">
            {t({ en: 'Vision fallback', fr: 'Fallback vision' })}
          </div>
          <div className="text-xs prose prose-invert prose-sm max-w-none p-2 rounded border border-border bg-bg-secondary">
            <Markdown content={answer} />
          </div>
        </div>
      )}
    </div>
  )
}
