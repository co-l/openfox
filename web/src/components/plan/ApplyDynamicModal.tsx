import { Modal } from '../shared/SelfContainedModal'

interface ApplyDynamicModalProps {
  isOpen: boolean
  onClose: () => void
  onApply: () => void
  disabled?: boolean
}

export function ApplyDynamicModal({ isOpen, onClose, onApply, disabled }: ApplyDynamicModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Update system prompt" size="sm">
      <p className="text-sm text-text-secondary mb-4">
        Applying the new system prompt will rebuild the cached prompt, which may cause the next response to take longer
        while the LLM reprocesses the prefix.
      </p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded bg-bg-tertiary text-text-primary hover:bg-border transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onApply}
          disabled={disabled}
          className="px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Update
        </button>
      </div>
    </Modal>
  )
}
