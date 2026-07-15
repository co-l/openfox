import type { SkillInfo } from '../../stores/skills'
import { Button } from '../shared/Button'
import { Modal } from '../shared/SelfContainedModal'

interface SkillDeleteModalProps {
  skill: SkillInfo | null
  deleting: boolean
  error: string
  onClose: () => void
  onConfirm: () => void | Promise<void>
}

export function SkillDeleteModal({ skill, deleting, error, onClose, onConfirm }: SkillDeleteModalProps) {
  return (
    <Modal
      isOpen={skill !== null}
      onClose={onClose}
      title="Delete skill?"
      size="sm"
      closeOnBackdropClick={!deleting}
      closeOnEscape={!deleting}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete skill'}
          </Button>
        </div>
      }
    >
      <p className="text-sm font-medium text-text-primary">This skill files will be deleted.</p>
      <p className="mt-2 text-sm text-text-secondary">The full skill folder and all its contents will be removed.</p>
      {skill && <p className="mt-3 break-all font-mono text-xs text-text-muted">{skill.path}</p>}
      {error && <p className="mt-3 text-sm text-error">{error}</p>}
    </Modal>
  )
}
