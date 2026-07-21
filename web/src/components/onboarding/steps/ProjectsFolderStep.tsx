import { useState, useEffect } from 'react'
import { authFetch } from '../../../lib/api'
import { DirectoryBrowser } from '../../shared/DirectoryBrowser'
import { appUrl } from '../../../lib/basePath'

interface ProjectsFolderStepProps {
  onNext: (data: { workdir: string }) => void
}

export function ProjectsFolderStep({ onNext }: ProjectsFolderStepProps) {
  const [workdir, setWorkdir] = useState('')
  const [showBrowser, setShowBrowser] = useState(false)

  useEffect(() => {
    authFetch('/api/config')
      .then((r) => r.json())
      .then((data) => {
        if (data.workdir) {
          setWorkdir(data.workdir)
        } else {
          fetch(appUrl('/api/directories?path=') + encodeURIComponent('/home'))
            .then((r) => r.json())
            .then((dirData) => {
              if (dirData.current) {
                setWorkdir(dirData.current)
              }
            })
            .catch(() => {})
        }
      })
      .catch(() => {
        fetch(appUrl('/api/directories?path=') + encodeURIComponent('/home'))
          .then((r) => r.json())
          .then((data) => {
            if (data.current) {
              setWorkdir(data.current)
            }
          })
          .catch(() => {})
      })
  }, [])

  return (
    <div className="max-w-xl mx-auto">
      <h2 className="text-2xl font-bold text-text-primary mb-2">Your Projects Folder</h2>
      <p className="text-text-secondary mb-8">Where should OpenFox create project folders?</p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-text-secondary mb-1">Workspace directory</label>
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
              Browse
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
          Continue
        </button>
      </div>
    </div>
  )
}
