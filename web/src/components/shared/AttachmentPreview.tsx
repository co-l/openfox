import type { Attachment } from '@shared/types.js'
import { CloseButton } from './CloseButton'
import { isPreviewableImage, formatFileSize, getFileExtension } from '../../lib/attachment-utils.js'

interface AttachmentPreviewProps {
  attachment: Attachment
  onRemove: (id: string) => void
}

export function AttachmentPreview({ attachment, onRemove }: AttachmentPreviewProps) {
  const extension = getFileExtension(attachment.filename)

  return (
    <div className="relative inline-flex flex-col items-center p-2 bg-bg-tertiary rounded-lg border border-border">
      <CloseButton
        onClick={() => onRemove(attachment.id)}
        className="absolute -top-2 -right-2"
        size="sm"
        variant="overlay"
        aria-label={`Remove ${attachment.filename}`}
      />

      {isPreviewableImage(attachment.mimeType) ? (
        <img
          src={attachment.data}
          alt={attachment.description || attachment.filename}
          className="w-16 h-16 object-cover rounded-md bg-bg-secondary"
        />
      ) : (
        <div className="w-16 h-16 flex items-center justify-center rounded-md bg-bg-secondary text-xs font-bold text-text-muted">
          {extension}
        </div>
      )}

      <div className="mt-1 text-xs text-text-muted text-center max-w-16 truncate" title={attachment.filename}>
        {attachment.filename}
      </div>
      <div className="text-[10px] text-text-muted">{formatFileSize(attachment.size)}</div>
    </div>
  )
}
