import { ConfirmModal } from './shared/ConfirmModal'
import { useT } from '../hooks/useT'

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
  const t = useT()
  const handleConfirm = () => {
    onConfirm()
    onClose()
  }

  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      title={t({ en: 'Delete Project', fr: 'Supprimer le projet' })}
      confirmLabel={t({ en: 'Delete', fr: 'Supprimer' })}
      confirmVariant="danger"
      message={
        <>
          {t({ en: 'This will permanently delete the project', fr: 'Cela supprimera définitivement le projet' })}{' '}
          <span className="font-semibold text-text-primary">{projectName}</span>{' '}
          {t({
            en: 'and all its sessions from OpenFox. The project files on disk will remain untouched.',
            fr: 'et toutes ses sessions d’OpenFox. Les fichiers du projet sur le disque resteront intacts.',
          })}
        </>
      }
    />
  )
}
