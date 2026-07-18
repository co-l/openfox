import type { ReactNode } from 'react'
import { Modal } from './SelfContainedModal'
import { Spinner } from './Spinner'

interface ModalShellProps {
  isOpen: boolean
  onClose: () => void
  title: string
  busy: boolean
  loading: boolean
  children: ReactNode
}

export function ModalShell({ isOpen, onClose, title, busy, loading, children }: ModalShellProps) {
  const footer = (
    <div className="flex gap-2 justify-end">
      <button
        onClick={onClose}
        className="px-4 py-2 text-sm rounded bg-bg-tertiary text-text-secondary hover:bg-bg-secondary transition-colors"
      >
        Cancel
      </button>
    </div>
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md" footer={footer}>
      {loading || busy ? (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      ) : (
        children
      )}
    </Modal>
  )
}
