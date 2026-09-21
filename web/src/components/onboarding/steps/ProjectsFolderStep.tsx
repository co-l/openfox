import { useState, useEffect } from 'react'
import { useT } from '../../../hooks/useT'
import { useConfig } from '../../../hooks/useConfig'
import { DirectoryBrowser } from '../../shared/DirectoryBrowser'
import { appUrl } from '../../../lib/basePath'

interface ProjectsFolderStepProps {
  onNext: (data: { workdir: string }) => void
}

export function ProjectsFolderStep({ onNext }: ProjectsFolderStepProps) {
  const t = useT()
  const [workdir, setWorkdir] = useState('')
  const [showBrowser, setShowBrowser] = useState(false)
  const { config } = useConfig()

  useEffect(() => {
    if (config?.workdir) {
      setWorkdir(config.workdir)
    } else {
      // Authorized transient read: home-directory probe when config has no workdir.
      fetch(appUrl('/api/directories?path=') + encodeURIComponent('/home'))
        .then((r) => r.json())
        .then((dirData) => {
          if (dirData.current) {
            setWorkdir(dirData.current)
          }
        })
        .catch(() => {})
    }
  }, [config?.workdir])

  return (
    <div className="max-w-xl mx-auto">
      <h2 className="text-2xl font-bold text-text-primary mb-2">
        {t({ en: 'Your Projects Folder', fr: 'Votre dossier de projets' })}
      </h2>
      <p className="text-text-secondary mb-8">
        {t({
          en: 'Where should OpenFox create project folders?',
          fr: 'Où OpenFox doit-il créer les dossiers de projets ?',
        })}
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-text-secondary mb-1">
            {t({ en: 'Workspace directory', fr: 'Dossier de travail' })}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={workdir}
              onChange={(e) => setWorkdir(e.target.value)}
              placeholder="/home/user/projects"
              data-testid="onboarding-workdir-input"
              className="flex-1 px-4 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
            />
            <button
              onClick={() => setShowBrowser(true)}
              className="px-4 py-2 bg-bg-secondary border border-border rounded-lg hover:border-text-muted"
            >
              {t({ en: 'Browse', fr: 'Parcourir' })}
            </button>
          </div>
        </div>

        {showBrowser && (
          <DirectoryBrowser
            initialPath={workdir || undefined}
            onSelect={(path) => {
              setWorkdir(path)
              setShowBrowser(false)
            }}
            onClose={() => setShowBrowser(false)}
          />
        )}

        <button
          onClick={() => onNext({ workdir })}
          disabled={!workdir}
          data-testid="onboarding-workdir-continue-button"
          className="w-full mt-6 px-6 py-3 bg-accent-primary text-text-primary rounded-lg font-medium hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {t({ en: 'Continue', fr: 'Continuer' })}
        </button>
      </div>
    </div>
  )
}
