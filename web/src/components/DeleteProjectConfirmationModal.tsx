import { Modal } from './shared/SelfContainedModal'
import { Button } from './shared/Button'

interface DeleteProjectConfirmationModalProps {
  isOpen: boolean
  onClose: () => void
  projectName: string
  onConfirm: () => void
}

export function DeleteProjectConfirmationModal({
  isOpen,
  onClose,
  projectName,
  onConfirm,
}: DeleteProjectConfirmationModalProps) {
  const handleConfirm = () => {
    onConfirm()
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Delete Project"
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-text-secondary">
          This will permanently delete the project <span className="font-semibold text-text-primary">{projectName}</span> and all its sessions from OpenFox. The project files on disk will remain untouched.
        </p>
        
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            variant="danger" 
            onClick={handleConfirm}
          >
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  )
}
