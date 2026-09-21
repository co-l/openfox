import type { SkillInfo } from '../../lib/skills-actions'
import { Button } from '../shared/Button'
import { Modal } from '../shared/SelfContainedModal'
import { useT } from '../../hooks/useT'

interface SkillDeleteModalProps {
  skill: SkillInfo | null
  deleting: boolean
  error: string
  onClose: () => void
  onConfirm: () => void | Promise<void>
}

export function SkillDeleteModal({ skill, deleting, error, onClose, onConfirm }: SkillDeleteModalProps) {
  const t = useT()
  return (
    <Modal
      isOpen={skill !== null}
      onClose={onClose}
      title={t({ en: 'Delete skill?', fr: 'Supprimer la compétence ?' })}
      size="sm"
      closeOnBackdropClick={!deleting}
      closeOnEscape={!deleting}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={deleting}>
            {t({ en: 'Cancel', fr: 'Annuler' })}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={deleting}>
            {deleting
              ? t({ en: 'Deleting...', fr: 'Suppression...' })
              : t({ en: 'Delete skill', fr: 'Supprimer la compétence' })}
          </Button>
        </div>
      }
    >
      <p className="text-sm font-medium text-text-primary">
        {t({ en: 'This skill files will be deleted.', fr: 'Les fichiers de cette compétence seront supprimés.' })}
      </p>
      <p className="mt-2 text-sm text-text-secondary">
        {t({
          en: 'The full skill folder and all its contents will be removed.',
          fr: 'Le dossier complet de la compétence et tout son contenu seront supprimés.',
        })}
      </p>
      {skill && <p className="mt-3 break-all font-mono text-xs text-text-muted">{skill.path}</p>}
      {error && <p className="mt-3 text-sm text-error">{error}</p>}
    </Modal>
  )
}
