import { useProjectStore } from '../stores/project'

export function EmptyProjectView() {
  const currentProject = useProjectStore(state => state.currentProject)
  
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 text-center">
      <div className="max-w-md">
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          {currentProject?.name ?? 'Project'}
        </h2>
        <p className="text-text-secondary mb-4">
          No session selected. Click <strong>+ New Session</strong> in the sidebar to start a new coding session.
        </p>
        <p className="text-sm text-text-muted">
          Each session tracks your conversation with the AI and maintains acceptance criteria for your task.
        </p>
      </div>
    </div>
  )
}
