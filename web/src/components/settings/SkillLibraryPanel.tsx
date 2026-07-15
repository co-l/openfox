import { useEffect, useRef, useState } from 'react'
import { Button } from '../shared/Button'
import { DirectoryBrowser } from '../shared/DirectoryBrowser'
import { packageFromDataTransfer, packageFromFileList, type DroppedSkillPackage } from './skill-package-drop'

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
  const [choosing, setChoosing] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.setAttribute('webkitdirectory', '')
  }, [])

  const choose = async (path: string) => {
    const trusted = window.confirm(
      'Skills may contain instructions and scripts. Select this folder for discovery without executing package content?',
    )
    if (!trusted) return
    const result = await onSelect(path)
    if (result && !result.success) {
      setError(result.error ?? 'Cannot use selected folder.')
      return
    }
    setChoosing(false)
  }

  const install = async (skillPackage: DroppedSkillPackage) => {
    setInstalling(true)
    setError('')
    const result = await onInstall(skillPackage)
    setInstalling(false)
    if (!result.success) setError(result.error ?? 'Failed to install skill package.')
  }

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    if (!selectedDirectory?.available || installing) return
    try {
      await install(await packageFromDataTransfer(event.dataTransfer))
    } catch (dropError) {
      setError(dropError instanceof Error ? dropError.message : 'Invalid skill folder.')
    }
  }

  return (
    <section className="mb-4 rounded border border-border bg-bg-tertiary/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-text-primary">Skills folder</h3>
          <p className="mt-1 truncate text-xs text-text-muted">
            {selectedDirectory?.configuredPath ?? 'No shared folder selected'}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={() => setChoosing(true)}>
            Change folder
          </Button>
          {selectedDirectory && (
            <>
              <Button variant="secondary" onClick={onRefresh}>
                Refresh
              </Button>
              {selectedDirectory.custom && (
                <Button variant="secondary" onClick={onRemove}>
                  Use default
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
            ? 'Installing skill package...'
            : 'Drop one skill folder here'
          : 'Choose a skills folder to enable drag and drop.'}
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
            setError(inputError instanceof Error ? inputError.message : 'Invalid skill folder.')
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
    </section>
  )
}
