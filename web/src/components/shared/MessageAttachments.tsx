import { useState } from 'react'
import type { Attachment } from '../../../../src/shared/types.js'
import { ImageModal } from './ImageModal'

interface MessageAttachmentsProps {
  attachments: Attachment[]
}

export function MessageAttachments({ attachments }: MessageAttachmentsProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null)

  const handleImageClick = (src: string) => {
    setSelectedImage(src)
  }

  const handleCloseModal = () => {
    setSelectedImage(null)
  }

  if (attachments.length === 0) return null

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-3">
        {attachments.map((attachment) => (
          <button
            key={attachment.id}
            onClick={() => handleImageClick(attachment.data)}
            className="group relative inline-block"
            title={attachment.filename}
          >
            {/* 256px max dimension, maintaining aspect ratio */}
            <img
              src={attachment.data}
              alt={attachment.filename}
              className="max-w-[256px] max-h-[256px] object-contain rounded-lg border border-border hover:border-accent-primary transition-colors cursor-pointer"
            />
          </button>
        ))}
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
