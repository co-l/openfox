import { useEffect, useRef, useState } from 'react'
import { Button } from '../shared/Button'
import { ConfirmModal } from '../shared/ConfirmModal'
import { DirectoryBrowser } from '../shared/DirectoryBrowser'
import { packageFromDataTransfer, packageFromFileList, type DroppedSkillPackage } from './skill-package-drop'
import { useT } from '../../hooks/useT'

export interface SelectedSkillDirectory {
  configuredPath: string
  resolvedPath: string | null
  available: boolean
  custom: boolean
}

interface SkillLibraryPanelProps {
  selectedDirectory: SelectedSkillDirectory | null
  onSelect: (path: string) => void | Promise<void | { success: boolean; error?: string }>
  onRemove: () => void | Promise<void>
  onRefresh: () => void | Promise<void>
  onInstall: (skillPackage: DroppedSkillPackage) => Promise<{ success: boolean; error?: string }>
}

export function SkillLibraryPanel({
  selectedDirectory,
  onSelect,
  onRemove,
  onRefresh,
  onInstall,
}: SkillLibraryPanelProps) {
  const t = useT()
  const [choosing, setChoosing] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const [confirmingPath, setConfirmingPath] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.setAttribute('webkitdirectory', '')
  }, [])

  const choose = (path: string) => {
    setPendingPath(path)
  }

  const handleConfirmPath = async () => {
    if (!pendingPath || confirmingPath) return
    setConfirmingPath(true)
    const result = await onSelect(pendingPath)
    if (result && !result.success) {
      setError(
        result.error ?? t({ en: 'Cannot use selected folder.', fr: 'Impossible d’utiliser le dossier sélectionné.' }),
      )
      setConfirmingPath(false)
      return
    }
    setPendingPath(null)
    setChoosing(false)
    setConfirmingPath(false)
  }

  const install = async (skillPackage: DroppedSkillPackage) => {
    setInstalling(true)
    setError('')
    const result = await onInstall(skillPackage)
    setInstalling(false)
    if (!result.success)
      setError(
        result.error ??
          t({ en: 'Failed to install skill package.', fr: 'Échec de l’installation du package de compétence.' }),
      )
  }

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    if (!selectedDirectory?.available || installing) return
    try {
      await install(await packageFromDataTransfer(event.dataTransfer))
    } catch (dropError) {
      setError(
        dropError instanceof Error
          ? dropError.message
          : t({ en: 'Invalid skill folder.', fr: 'Dossier de compétence invalide.' }),
      )
    }
  }

  return (
    <section className="mb-4 rounded border border-border bg-bg-tertiary/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-text-primary">
            {t({ en: 'Skills folder', fr: 'Dossier des compétences' })}
          </h3>
          <p className="mt-1 truncate text-xs text-text-muted">
            {selectedDirectory?.configuredPath ??
              t({ en: 'No shared folder selected', fr: 'Aucun dossier partagé sélectionné' })}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={() => setChoosing(true)}>
            {t({ en: 'Change folder', fr: 'Changer de dossier' })}
          </Button>
          {selectedDirectory && (
            <>
              <Button variant="secondary" onClick={onRefresh}>
                {t({ en: 'Refresh', fr: 'Actualiser' })}
              </Button>
              {selectedDirectory.custom && (
                <Button variant="secondary" onClick={onRemove}>
                  {t({ en: 'Use default', fr: 'Utiliser le défaut' })}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        disabled={!selectedDirectory?.available || installing}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        className="mt-3 w-full rounded border border-dashed border-border px-4 py-5 text-center text-xs text-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {selectedDirectory?.available
          ? installing
            ? t({ en: 'Installing skill package...', fr: 'Installation du package de compétence...' })
            : t({ en: 'Drop one skill folder here', fr: 'Déposez un dossier de compétence ici' })
          : t({
              en: 'Choose a skills folder to enable drag and drop.',
              fr: 'Choisissez un dossier de compétences pour activer le glisser-déposer.',
            })}
      </button>
      <input
        ref={inputRef}
        hidden
        type="file"
        multiple
        onChange={(event) => {
          if (!event.target.files?.length) return
          try {
            void install(packageFromFileList(event.target.files))
          } catch (inputError) {
            setError(
              inputError instanceof Error
                ? inputError.message
                : t({ en: 'Invalid skill folder.', fr: 'Dossier de compétence invalide.' }),
            )
          } finally {
            event.target.value = ''
          }
        }}
      />
      {error && <p className="mt-2 text-xs text-error">{error}</p>}
      {choosing && (
        <DirectoryBrowser
          initialPath={selectedDirectory?.resolvedPath ?? undefined}
          onSelect={choose}
          onClose={() => setChoosing(false)}
        />
      )}

      <ConfirmModal
        isOpen={pendingPath !== null}
        onClose={() => setPendingPath(null)}
        onConfirm={handleConfirmPath}
        title={t({ en: 'Trust this folder?', fr: 'Faire confiance à ce dossier ?' })}
        message={t({
          en: 'Skills may contain instructions and scripts. Select this folder for discovery without executing package content?',
          fr: 'Les compétences peuvent contenir des instructions et des scripts. Sélectionner ce dossier pour la découverte sans exécuter le contenu du package ?',
        })}
        confirmLabel={t({ en: 'Trust folder', fr: 'Faire confiance au dossier' })}
        disabled={confirmingPath}
      />
    </section>
  )
}
