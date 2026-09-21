import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { useLocation } from 'wouter'
import { useProjectStore } from '../../stores/project'
import { useT } from '../../hooks/useT'
import { DropdownMenu, type DropdownMenuItem } from '../shared/DropdownMenu'
import {
  ChevronDownIcon,
  CheckIcon,
  StarIcon,
  StarFilledIcon,
  PlusMdIcon,
  FolderIcon,
  HomeIcon,
  SearchIcon,
} from '../shared/icons'
import { CreateProjectModal } from '../CreateProjectModal.js'
import { DirectoryBrowser } from '../shared/DirectoryBrowser.js'
import { useWorkdir } from '../../hooks/useWorkdir.js'
import { pathBasename } from '../../lib/path'
import { sortProjectsStarredFirst } from '../../lib/projects'
import { shouldAutofocus } from '../../lib/device'

interface ProjectDropdownProps {
  projects: Array<{ id: string; name: string; workdir: string; isStarred?: boolean }>
  currentProject?: { id: string; name: string; workdir: string; isStarred?: boolean }
}

export function ProjectDropdown({ projects, currentProject }: ProjectDropdownProps) {
  const t = useT()
  const [, navigate] = useLocation()
  const setCurrentProjectId = useProjectStore((state) => state.setCurrentProjectId)
  const toggleStar = useProjectStore((state) => state.toggleStar)
  const createProject = useProjectStore((state) => state.createProject)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showBrowser, setShowBrowser] = useState(false)
  const [search, setSearch] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const baseWorkdir = useWorkdir()

  useEffect(() => {
    if (isOpen) {
      setSearch('')
      requestAnimationFrame(() => {
        if (shouldAutofocus()) {
          searchInputRef.current?.focus()
        }
      })
    }
  }, [isOpen])

  const handleDirectorySelect = useCallback(
    async (path: string): Promise<boolean> => {
      const basename = pathBasename(path)
      const project = await createProject(basename, path)
      if (project && 'id' in project) {
        setShowBrowser(false)
        navigate(`/p/${project.id}`)
        return true
      }
      return false
    },
    [createProject, navigate],
  )

  const sortedProjects = useMemo(() => sortProjectsStarredFirst(projects), [projects])

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sortedProjects
    return sortedProjects.filter((p) => p.name.toLowerCase().includes(q))
  }, [sortedProjects, search])

  const items: DropdownMenuItem[] = useMemo(() => {
    if (sortedProjects.length > 0 && filteredProjects.length === 0) {
      return [
        {
          label: (
            <div className="px-3 py-2 text-text-muted text-xs cursor-default">
              {t({ en: 'No projects match', fr: 'Aucun projet ne correspond' })}
            </div>
          ),
          onClick: () => {},
        },
      ]
    }
    return filteredProjects.map((proj) => ({
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
            title={
              proj.isStarred
                ? t({ en: 'Unstar project', fr: 'Retirer des favoris' })
                : t({ en: 'Star project', fr: 'Ajouter aux favoris' })
            }
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
        setCurrentProjectId(proj.id)
      },
    }))
  }, [filteredProjects, sortedProjects.length, currentProject?.id, setCurrentProjectId, toggleStar, t])

  const footerItems: DropdownMenuItem[] = [
    {
      label: (
        <div className="flex items-center gap-2">
          <HomeIcon className="w-4 h-4" />
          <span>{t({ en: 'Home', fr: 'Accueil' })}</span>
        </div>
      ),
      href: '/',
    },
    {
      label: (
        <div className="flex items-center gap-2">
          <FolderIcon className="w-4 h-4" />
          <span>{t({ en: 'Open Project', fr: 'Ouvrir un projet' })}</span>
        </div>
      ),
      onClick: () => setShowBrowser(true),
    },
    {
      label: (
        <div className="flex items-center gap-2 text-accent-primary">
          <PlusMdIcon className="w-4 h-4" />
          <span>{t({ en: 'New Project', fr: 'Nouveau projet' })}</span>
        </div>
      ),
      onClick: () => setShowCreateModal(true),
    },
  ]

  const header =
    sortedProjects.length > 0 ? (
      <div className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
        <input
          ref={searchInputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t({ en: 'Search projects…', fr: 'Rechercher des projets…' })}
          aria-label={t({ en: 'Search projects', fr: 'Rechercher des projets' })}
          className="w-full text-xs bg-bg-tertiary border border-border rounded pl-8 pr-2 py-1.5 text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
        />
      </div>
    ) : undefined

  return (
    <>
      <DropdownMenu
        items={items}
        footerItems={footerItems}
        header={header}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        trigger={
          <button
            className={`text-text-secondary hover:text-text-primary text-sm min-w-0 flex items-center gap-1 ${currentProject ? 'hover:underline' : ''}`}
            title={currentProject?.name ?? t({ en: 'Select project', fr: 'Sélectionner un projet' })}
          >
            {currentProject ? (
              <span className="truncate max-w-[120px]">{currentProject.name}</span>
            ) : (
              <span className="text-text-muted truncate max-w-[120px]">
                {t({ en: 'Select project...', fr: 'Sélectionner un projet…' })}
              </span>
            )}
            <ChevronDownIcon className="w-3 h-3 flex-shrink-0" />
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
