import { useState, useMemo } from 'react'
import type { Attachment } from '@shared/types.js'
import { ImageModal } from './ImageModal'
import { useSessionStore } from '../../stores/session'
import { isPreviewableImage, isTextMime, formatFileSize, getFileExtension } from '../../lib/attachment-utils.js'

interface MessageAttachmentsProps {
  attachments: Attachment[]
  messageId: string
}

export function MessageAttachments({ attachments, messageId }: MessageAttachmentsProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const visionFallbackByMessage = useSessionStore((state) => state.visionFallbackByMessage)
  const messages = useSessionStore((state) => state.messages)

  const assistantMessageId = useMemo(() => {
    const msgIndex = messages.findIndex((m) => m.id === messageId)
    if (msgIndex === -1) return null
    for (let i = msgIndex + 1; i < messages.length; i++) {
      const msg = messages[i]
      if (msg && msg.role === 'assistant') {
        return msg.id
      }
    }
    return null
  }, [messages, messageId])

  const handleImageClick = (src: string) => {
    setSelectedImage(src)
  }

  const handleCloseModal = () => {
    setSelectedImage(null)
  }

  const getFallback = (attachmentId: string) => {
    const userKey = `${messageId}-${attachmentId}`
    if (visionFallbackByMessage[userKey]) {
      return visionFallbackByMessage[userKey]
    }
    if (assistantMessageId) {
      const assistantKey = `${assistantMessageId}-${attachmentId}`
      return visionFallbackByMessage[assistantKey]
    }
    return null
  }

  if (attachments.length === 0) return null

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-3">
        {attachments.map((attachment) => {
          const fallback = getFallback(attachment.id)

          if (isPreviewableImage(attachment.mimeType)) {
            return (
              <div key={attachment.id} className="relative inline-block">
                <button
                  onClick={() => handleImageClick(attachment.data)}
                  className="group relative inline-block"
                  title={
                    (fallback?.type === 'done' && fallback.description) || attachment.description || attachment.filename
                  }
                  disabled={fallback?.type === 'start'}
                >
                  <img
                    src={attachment.data}
                    alt={
                      (fallback?.type === 'done' && fallback.description) || attachment.description || attachment.filename
                    }
                    className="max-w-[256px] max-h-[256px] object-contain rounded-lg border border-border hover:border-accent-primary transition-colors cursor-pointer"
                  />
                  {fallback?.type === 'start' && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-lg">
                      <span className="text-xs text-text-primary animate-pulse">Describing image...</span>
                    </div>
                  )}
                </button>
                {fallback?.type === 'done' && fallback.description && (
                  <div className="mt-2 p-2 bg-bg-tertiary rounded text-xs text-text-secondary max-w-[256px]">
                    {fallback.description.slice(0, 200)}
                    {fallback.description.length > 200 ? '...' : ''}
                  </div>
                )}
              </div>
            )
          }

          return (
            <div key={attachment.id} className="inline-flex items-start gap-3 p-3 bg-bg-tertiary rounded-lg border border-border max-w-[300px]">
              <div className="w-10 h-10 flex items-center justify-center rounded-md bg-bg-secondary text-sm font-bold text-text-muted shrink-0">
                {getFileExtension(attachment.filename)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-text-primary truncate font-medium" title={attachment.filename}>
                  {attachment.filename}
                </div>
                <div className="text-[10px] text-text-muted">{formatFileSize(attachment.size)}</div>
                {isTextMime(attachment.mimeType) && attachment.data && (
                  <div className="mt-1.5 text-[10px] text-text-muted leading-relaxed line-clamp-3 font-mono break-all">
                    {attachment.data.slice(0, 200)}
                    {attachment.data.length > 200 ? '...' : ''}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {selectedImage && (
        <ImageModal src={selectedImage} alt="Attached image" isOpen={true} onClose={handleCloseModal} />
      )}
    </>
  )
}
