import { Link } from 'wouter'
import { useProjectStore } from '../stores/project'

export function EmptyProjectView() {
  const currentProject = useProjectStore(state => state.currentProject)
  
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 text-center">
      <div className="max-w-md">
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          {currentProject?.name ?? 'Project'}
        </h2>
        <p className="text-text-secondary mb-6">
          No session selected
        </p>
        <div className="flex flex-col gap-3">
          {currentProject && (
            <Link
              href={`/p/${currentProject.id}/new`}
              className="block w-full rounded font-medium transition-colors bg-accent-primary/25 text-text-primary hover:bg-accent-primary/40 px-3 py-2 text-center"
            >
              Create New Session
            </Link>
          )}
          <p className="text-sm text-text-muted">
            Or select an existing session from the sidebar
          </p>
        </div>
      </div>
    </div>
  )
}
