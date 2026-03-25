import type { Attachment } from '@shared/types.js'

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
      <button
        onClick={() => onRemove(attachment.id)}
        className="absolute -top-2 -right-2 w-5 h-5 bg-accent-error text-white rounded-full flex items-center justify-center hover:bg-accent-error/80 transition-colors"
        aria-label={`Remove ${attachment.filename}`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

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
