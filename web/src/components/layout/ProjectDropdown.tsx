import { useMemo, useState, useCallback } from 'react'
import { useLocation } from 'wouter'
import { useProjectStore } from '../../stores/project'
import { DropdownMenu, type DropdownMenuItem } from '../shared/DropdownMenu'
import { ChevronDownIcon, CheckIcon, StarIcon, StarFilledIcon, PlusMdIcon, FolderIcon } from '../shared/icons'
import { CreateProjectModal } from '../CreateProjectModal.js'
import { DirectoryBrowser } from '../shared/DirectoryBrowser.js'
import { useWorkdir } from '../../hooks/useWorkdir.js'
import { pathBasename } from '../../lib/path'

interface ProjectDropdownProps {
  projects: Array<{ id: string; name: string; workdir: string; isStarred?: boolean }>
  currentProject?: { id: string; name: string; workdir: string; isStarred?: boolean }
}

export function ProjectDropdown({ projects, currentProject }: ProjectDropdownProps) {
  const [, navigate] = useLocation()
  const loadProject = useProjectStore((state) => state.loadProject)
  const toggleStar = useProjectStore((state) => state.toggleStar)
  const createProject = useProjectStore((state) => state.createProject)
  const listProjects = useProjectStore((state) => state.listProjects)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showBrowser, setShowBrowser] = useState(false)
  const baseWorkdir = useWorkdir()

  const handleDirectorySelect = useCallback(
    async (path: string): Promise<boolean> => {
      const basename = pathBasename(path)
      const project = await createProject(basename, path)
      if (project && 'id' in project) {
        await listProjects()
        setShowBrowser(false)
        navigate(`/p/${project.id}`)
        return true
      }
      return false
    },
    [createProject, listProjects, navigate],
  )

  const sortedProjects = useMemo(() => {
    const starred = projects.filter((p) => p.isStarred).sort((a, b) => a.name.localeCompare(b.name))
    const unstarred = projects.filter((p) => !p.isStarred).sort((a, b) => a.name.localeCompare(b.name))
    return [...starred, ...unstarred]
  }, [projects])

  const items: DropdownMenuItem[] = sortedProjects.map((proj) => ({
    label: (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="truncate flex-1">{proj.name}</span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            e.nativeEvent.stopImmediatePropagation()
            toggleStar(proj.id, !proj.isStarred)
          }}
          className="flex-shrink-0 p-1 hover:bg-bg-tertiary rounded transition-colors"
          title={proj.isStarred ? 'Unstar project' : 'Star project'}
        >
          {proj.isStarred ? (
            <StarFilledIcon className="w-3.5 h-3.5 text-yellow-500" />
          ) : (
            <StarIcon className="w-3.5 h-3.5 text-text-muted hover:text-yellow-500" />
          )}
        </button>
      </div>
    ),
    icon: proj.id === currentProject?.id ? <CheckIcon /> : undefined,
    href: `/p/${proj.id}`,
    closeOnClick: true,
    onClick: () => {
      loadProject(proj.id)
    },
  }))

  const footerItems: DropdownMenuItem[] = [
    {
      label: (
        <div className="flex items-center gap-2">
          <FolderIcon className="w-4 h-4" />
          <span>Open Project</span>
        </div>
      ),
      onClick: () => setShowBrowser(true),
    },
    {
      label: (
        <div className="flex items-center gap-2 text-accent-primary">
          <PlusMdIcon className="w-4 h-4" />
          <span>New Project</span>
        </div>
      ),
      onClick: () => setShowCreateModal(true),
    },
  ]

  return (
    <>
      <DropdownMenu
        items={items}
        footerItems={footerItems}
        trigger={
          <button
            className={`text-text-secondary hover:text-text-primary text-sm truncate flex items-center gap-1 ${currentProject ? 'hover:underline' : ''}`}
            title={currentProject?.name ?? 'Select project'}
          >
            {currentProject?.name ?? <span className="text-text-muted">Select project...</span>}
            <ChevronDownIcon />
          </button>
        }
        minWidth="250px"
      />
      {showCreateModal && <CreateProjectModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />}
      {showBrowser && (
        <DirectoryBrowser
          initialPath={baseWorkdir ?? undefined}
          onSelect={handleDirectorySelect}
          onClose={() => setShowBrowser(false)}
        />
      )}
    </>
  )
}
