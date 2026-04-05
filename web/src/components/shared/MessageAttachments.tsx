import { useState, useMemo } from 'react'
import type { Attachment } from '@shared/types.js'
import { ImageModal } from './ImageModal'
import { useSessionStore } from '../../stores/session'

interface MessageAttachmentsProps {
  attachments: Attachment[]
  messageId: string
}

export function MessageAttachments({ attachments, messageId }: MessageAttachmentsProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const visionFallbackByMessage = useSessionStore(state => state.visionFallbackByMessage)
  const messages = useSessionStore(state => state.messages)

  // Find the assistant message that follows this user message
  // This is needed because vision_fallback events use the assistant message ID
  const assistantMessageId = useMemo(() => {
    const msgIndex = messages.findIndex(m => m.id === messageId)
    if (msgIndex === -1) return null
    // Look for the next assistant message after this user message
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
    // First try with user message ID (for reload after completion)
    const userKey = `${messageId}-${attachmentId}`
    if (visionFallbackByMessage[userKey]) {
      return visionFallbackByMessage[userKey]
    }
    // Then try with assistant message ID (for active processing)
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

          return (
            <div key={attachment.id} className="relative inline-block">
              <button
                onClick={() => handleImageClick(attachment.data)}
                className="group relative inline-block"
                title={attachment.filename}
                disabled={fallback?.type === 'start'}
              >
                {/* 256px max dimension, maintaining aspect ratio */}
                <img
                  src={attachment.data}
                  alt={attachment.filename}
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
                  {fallback.description.slice(0, 200)}{fallback.description.length > 200 ? '...' : ''}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {selectedImage && (
        <ImageModal
          src={selectedImage}
          alt="Attached image"
          isOpen={true}
          onClose={handleCloseModal}
        />
      )}
    </>
  )
}