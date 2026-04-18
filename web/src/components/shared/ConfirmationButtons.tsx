interface ConfirmationButtonsProps {
  confirmId: string | null
  confirmAll: boolean
  onConfirm: () => void
  onCancel: () => void
  confirmText?: string
}

export function ConfirmationButtons({
  confirmId,
  confirmAll,
  onConfirm,
  onCancel,
  confirmText = 'Confirm',
}: ConfirmationButtonsProps) {
  if (!confirmId && !confirmAll) return null

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onConfirm}
        className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-xs hover:bg-amber-500/30 transition-colors"
      >
        {confirmText}
      </button>
      <button
        onClick={onCancel}
        className="px-1.5 py-0.5 rounded text-text-muted text-xs hover:bg-bg-primary transition-colors"
      >
        Cancel
      </button>
    </div>
  )
}