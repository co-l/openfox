import type { Attachment } from '@shared/types.js'
import { CloseButton } from './CloseButton'

interface AttachmentPreviewProps {
  attachment: Attachment
  onRemove: (id: string) => void
}

export function AttachmentPreview({ attachment, onRemove }: AttachmentPreviewProps) {
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="relative inline-flex flex-col items-center p-2 bg-bg-tertiary rounded-lg border border-border">
      {/* Close button */}
      <CloseButton
        onClick={() => onRemove(attachment.id)}
        className="absolute -top-2 -right-2"
        size="sm"
        variant="overlay"
        aria-label={`Remove ${attachment.filename}`}
      />

      {/* Thumbnail - 64x64 square */}
      <img
        src={attachment.data}
        alt={attachment.filename}
        className="w-16 h-16 object-cover rounded-md bg-bg-secondary"
      />

      {/* File info */}
      <div className="mt-1 text-xs text-text-muted text-center max-w-16 truncate" title={attachment.filename}>
        {attachment.filename}
      </div>
      <div className="text-[10px] text-text-muted">
        {formatFileSize(attachment.size)}
      </div>
    </div>
  )
}
