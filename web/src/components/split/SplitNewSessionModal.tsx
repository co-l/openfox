import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useProjectStore } from '../../stores/project'
import { useSessionStore } from '../../stores/session'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { Input } from '../shared/Input'
import { FolderIcon, SearchIcon, StarFilledIcon } from '../shared/icons'
import { truncateMiddle } from '../../lib/path'
import { handleModalNavigation } from '../../lib/modal-utils'
import { shouldAutofocus } from '../../lib/device'
import { ScrollArea } from '../shared/ScrollArea'
import type { Project } from '@shared/types.js'

interface SplitNewSessionModalProps {
  isOpen: boolean
  onClose: () => void
}

function compareByName(a: Project, b: Project): number {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
}

function sortProjects(projects: Project[]): Project[] {
  const starred = projects.filter((p) => p.isStarred).sort(compareByName)
  const unstarred = projects.filter((p) => !p.isStarred).sort(compareByName)
  return [...starred, ...unstarred]
}

function filterProjects(projects: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase()
  if (!q) return projects
  return projects.filter((p) => p.name.toLowerCase().includes(q))
}

/** Project picker for creating a session straight into the split view. */
export function SplitNewSessionModal({ isOpen, onClose }: SplitNewSessionModalProps) {
  const projects = useProjectStore((state) => state.projects)
  const listProjects = useProjectStore((state) => state.listProjects)
  const createSession = useSessionStore((state) => state.createSession)
  const openPane = useSessionStore((state) => state.openPane)
  const resetPendingSessionCreate = useSessionStore((state) => state.resetPendingSessionCreate)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeRowRef = useRef<HTMLButtonElement>(null)

  const visibleProjects = useMemo(() => sortProjects(filterProjects(projects, query)), [projects, query])
  const activeProjectId = visibleProjects[activeIndex]
    ? `split-new-session-option-${visibleProjects[activeIndex]!.id}`
    : undefined

  useEffect(() => {
    if (isOpen) {
      setCreating(false)
      setError(null)
      setQuery('')
      setActiveIndex(0)
      if (shouldAutofocus()) inputRef.current?.focus()
      void listProjects()
    }
  }, [isOpen, listProjects])

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return
    activeRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [isOpen, activeIndex, visibleProjects])

  const handleSelect = async (projectId: string) => {
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      const session = await createSession(projectId)
      if (!session) {
        setError('Could not create the session — please try again.')
        return
      }
      await openPane(session.id, { focus: true })
      resetPendingSessionCreate()
      onClose()
    } catch {
      setError('Could not create the session — please try again.')
    } finally {
      setCreating(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    handleModalNavigation(
      event,
      visibleProjects.length - 1,
      setActiveIndex,
      () => {
        const project = visibleProjects[activeIndex]
        if (project) void handleSelect(project.id)
      },
      () => {
        if (query) {
          setQuery('')
          setActiveIndex(0)
        } else {
          onClose()
        }
      },
    )
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New session"
      size="sm"
      scrollable={false}
      footer={
        <div className="flex items-center justify-between gap-3">
          {projects.length > 0 && <p className="text-[11px] text-text-muted">↑ ↓ to navigate · Enter to select</p>}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {error && (
        <div className="mb-3 px-3 py-2 rounded bg-accent-error/10 border border-accent-error/30 text-sm text-accent-error">
          {error}
        </div>
      )}
      {projects.length === 0 ? (
        <p className="text-sm text-text-muted">No projects yet — create one from the home page first.</p>
      ) : (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          <div className="relative shrink-0">
            <SearchIcon className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search projects…"
              className="pl-9 w-full"
              aria-label="Search projects"
              role="combobox"
              aria-expanded="true"
              aria-controls="split-new-session-project-list"
              aria-activedescendant={activeProjectId}
            />
          </div>
          {visibleProjects.length === 0 ? (
            <p className="text-sm text-text-muted">No projects match</p>
          ) : (
            <ScrollArea className="-mx-4 -mb-4 flex-1 min-h-0">
              <div
                id="split-new-session-project-list"
                role="listbox"
                aria-label="Projects"
                className="flex flex-col gap-1 pl-4 pr-1"
              >
                {visibleProjects.map((project, index) => {
                  const isActive = index === activeIndex
                  return (
                    <button
                      key={project.id}
                      ref={isActive ? activeRowRef : undefined}
                      id={`split-new-session-option-${project.id}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-project-row
                      data-project-active={isActive || undefined}
                      data-starred={project.isStarred || undefined}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => void handleSelect(project.id)}
                      disabled={creating}
                      className={`flex items-center gap-3 rounded px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                        isActive ? 'bg-accent-primary/10' : 'hover:bg-bg-tertiary/70'
                      }`}
                    >
                      {project.isStarred ? (
                        <StarFilledIcon className="w-4 h-4 text-yellow-500 shrink-0" />
                      ) : (
                        <FolderIcon className="w-4 h-4 text-accent-primary shrink-0" />
                      )}
                      <span className="font-medium truncate text-sm">{project.name}</span>
                      <span className="text-xs text-text-muted truncate ml-auto">
                        {truncateMiddle(project.workdir, 24)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </Modal>
  )
}
