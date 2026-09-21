import { Link } from 'wouter'
import { useCurrentProject } from '../hooks/useCurrentProject'
import { useT } from '../hooks/useT'

export function EmptyProjectView() {
  const t = useT()
  const currentProject = useCurrentProject()

  return (
    <div className="h-full flex flex-col items-center justify-center p-8 text-center">
      <div className="max-w-md">
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          {currentProject?.name ?? t({ en: 'Project', fr: 'Projet' })}
        </h2>
        <p className="text-text-secondary mb-6">
          {t({ en: 'No session selected', fr: 'Aucune session sélectionnée' })}
        </p>
        <div className="flex flex-col gap-3">
          {currentProject && (
            <Link
              href={`/p/${currentProject.id}/new`}
              data-testid="create-new-session-button"
              className="block w-full rounded font-medium transition-colors bg-accent-primary/25 text-text-primary hover:bg-accent-primary/40 px-3 py-2 text-center"
            >
              {t({ en: 'Create New Session', fr: 'Créer une nouvelle session' })}
            </Link>
          )}
          <p className="text-sm text-text-muted">
            {t({
              en: 'Or select an existing session from the sidebar',
              fr: 'Ou sélectionnez une session existante dans la barre latérale',
            })}
          </p>
        </div>
      </div>
    </div>
  )
}
