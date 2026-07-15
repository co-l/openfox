import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link } from 'wouter'
import { useSessionStore } from '../stores/session'
import { useProjectStore } from '../stores/project'
import { Button } from './shared/Button'
import { OpenProjectModal } from './CreateSessionModal'
import { DeleteProjectConfirmationModal } from './DeleteProjectConfirmationModal'
import { formatRelativeDate } from '../lib/format-date'
import { SearchIcon, XCloseIcon, FolderIcon, TrashIcon } from './shared/icons'
import { Spinner } from './shared/Spinner'
import { fuzzyMatch } from '../lib/modal-utils'
import type { SessionSummary } from '@shared/types.js'

function highlightMatches(text: string, query: string) {
  if (!query) return text
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()

  const matched = new Array(text.length).fill(false)

  const exactIdx = lowerText.indexOf(lowerQuery)
  if (exactIdx >= 0) {
    for (let i = exactIdx; i < exactIdx + lowerQuery.length; i++) {
      matched[i] = true
    }
  } else {
    let qi = 0
    for (let i = 0; i < text.length && qi < lowerQuery.length; i++) {
      if (lowerText[i] === lowerQuery[qi]) {
        matched[i] = true
        qi++
      }
    }
  }

  const parts: React.ReactNode[] = []
  let current = ''
  let currentMatch: boolean = matched[0] ?? false

  for (let i = 0; i < text.length; i++) {
    if (matched[i] === currentMatch) {
      current += text[i]!
    } else {
      parts.push(
        currentMatch ? (
          <span key={parts.length} className="font-semibold text-accent-primary">
            {current}
          </span>
        ) : (
          current
        ),
      )
      current = text[i]!
      currentMatch = matched[i] as boolean
    }
  }
  parts.push(
    currentMatch ? (
      <span key={parts.length} className="font-semibold text-accent-primary">
        {current}
      </span>
    ) : (
      current
    ),
  )

  return <>{parts}</>
}

export function HomePage() {
  const [showOpenModal, setShowOpenModal] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const sessions = useSessionStore((state) => state.sessions)
  const projects = useProjectStore((state) => state.projects)
  const loading = useProjectStore((state) => state.loading)
  const listProjects = useProjectStore((state) => state.listProjects)
  const listSessions = useSessionStore((state) => state.listSessions)
  const deleteProject = useProjectStore((state) => state.deleteProject)

  const connectionStatus = useSessionStore((state) => state.connectionStatus)

  useEffect(() => {
    if (connectionStatus === 'connected') {
      listProjects()
      listSessions()
    }
  }, [connectionStatus, listProjects, listSessions])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 150)
    return () => clearTimeout(t)
  }, [searchQuery])

  const { matchCount, filteredSessionIds, relevanceScores, matchTypes, promptSnippets } = useMemo(() => {
    if (!debouncedQuery)
      return {
        matchCount: 0,
        filteredSessionIds: null as Set<string> | null,
        relevanceScores: null as Map<string, number> | null,
        matchTypes: null as Map<string, string> | null,
        promptSnippets: null as Map<string, string> | null,
      }
    const projectById = new Map(projects.map((p) => [p.id, p]))
    const scores = new Map<string, number>()
    const types = new Map<string, string>()
    const snippets = new Map<string, string>()
    const matching = sessions.filter((s) => {
      const project = projectById.get(s.projectId)
      const projectName = project?.name ?? ''
      const title = s.title ?? ''
      const prompts = s.recentUserPrompts?.map((p) => p.content) ?? []
      const promptsJoined = prompts.join(' ')
      let score = 0
      let type = ''
      if (fuzzyMatch(title, debouncedQuery)) {
        score += 10
        type = 'title'
      }
      if (fuzzyMatch(promptsJoined, debouncedQuery)) {
        score += 3
        type = type === 'title' ? 'title' : 'prompts'
        const matchedPrompt = prompts.find((p) => fuzzyMatch(p, debouncedQuery))
        if (matchedPrompt) {
          const idx = matchedPrompt.toLowerCase().indexOf(debouncedQuery.toLowerCase())
          if (idx >= 0) {
            const start = Math.max(0, idx - 30)
            const end = Math.min(matchedPrompt.length, idx + debouncedQuery.length + 30)
            snippets.set(
              s.id,
              (start > 0 ? '…' : '') + matchedPrompt.slice(start, end) + (end < matchedPrompt.length ? '…' : ''),
            )
          } else {
            snippets.set(s.id, matchedPrompt.slice(0, 80) + (matchedPrompt.length > 80 ? '…' : ''))
          }
        }
      }
      if (fuzzyMatch(projectName, debouncedQuery)) {
        score += 1
        type = type || 'project'
      }
      scores.set(s.id, score)
      types.set(s.id, type)
      return score > 0
    })
    return {
      matchCount: matching.length,
      filteredSessionIds: new Set(matching.map((s) => s.id)),
      relevanceScores: scores,
      matchTypes: types,
      promptSnippets: snippets,
    }
  }, [sessions, debouncedQuery, projects])

  const lastActivityByProject = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of sessions) {
      const t = new Date(s.updatedAt).getTime()
      const prev = map.get(s.projectId) ?? 0
      if (t > prev) map.set(s.projectId, t)
    }
    return map
  }, [sessions])

  const sessionsByProject = useMemo(() => {
    const map = new Map<string, SessionSummary[]>()
    for (const s of sessions) {
      const list = map.get(s.projectId)
      if (list) {
        list.push(s)
      } else {
        map.set(s.projectId, [s])
      }
    }
    for (const [, list] of map) {
      list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    }
    return map
  }, [sessions])

  const sortedProjects = useMemo(() => {
    let filtered = projects
    if (debouncedQuery && filteredSessionIds) {
      filtered = projects.filter((p) => {
        const projectSessions = sessionsByProject.get(p.id)
        return projectSessions?.some((s) => filteredSessionIds!.has(s.id))
      })
    }
    return [...filtered].sort((a, b) => {
      const aTime = lastActivityByProject.get(a.id) ?? new Date(a.updatedAt).getTime()
      const bTime = lastActivityByProject.get(b.id) ?? new Date(b.updatedAt).getTime()
      return bTime - aTime
    })
  }, [projects, sessionsByProject, debouncedQuery, filteredSessionIds, lastActivityByProject])

  const getProjectSessions = useCallback(
    (projectId: string): SessionSummary[] => {
      const projectSessions = sessionsByProject.get(projectId)
      if (!projectSessions) return []
      if (debouncedQuery && filteredSessionIds && relevanceScores) {
        return projectSessions
          .filter((s) => filteredSessionIds.has(s.id))
          .sort((a, b) => {
            const scoreDiff = (relevanceScores.get(b.id) ?? 0) - (relevanceScores.get(a.id) ?? 0)
            if (scoreDiff !== 0) return scoreDiff
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          })
      }
      return projectSessions.slice(0, 5)
    },
    [sessionsByProject, debouncedQuery, filteredSessionIds, relevanceScores],
  )

  const handleOpenProject = () => {
    setShowOpenModal(true)
  }

  const handleClearSearch = () => {
    setSearchQuery('')
    setDebouncedQuery('')
    searchRef.current?.focus()
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClearSearch()
      searchRef.current?.blur()
    }
  }

  const isSearching = debouncedQuery.length > 0
  const hasNoResults = isSearching && matchCount === 0

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-primary">
      <div className="max-w-5xl mx-auto w-full p-4 md:p-8">
        <div className="mb-6 md:mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-accent-primary">OpenFox</h1>
            <p className="text-text-secondary">Local LLM-powered coding assistant with contract-driven execution</p>
          </div>
          <Button variant="primary" onClick={handleOpenProject}>
            Open Project
          </Button>
        </div>

        {sessions.length > 0 && (
          <div className="mb-4 md:mb-6 relative">
            <div className="relative flex items-center">
              <SearchIcon className="absolute left-3 w-4 h-4 text-text-muted pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search sessions by title or keyword..."
                className="w-full bg-bg-secondary border border-border rounded-lg pl-10 pr-10 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-3 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                  aria-label="Clear search"
                >
                  <XCloseIcon className="w-4 h-4" />
                </button>
              )}
            </div>
            {isSearching && !hasNoResults && (
              <div className="mt-1.5 text-xs text-text-muted px-1">
                {matchCount} {matchCount === 1 ? 'match' : 'matches'}
              </div>
            )}
          </div>
        )}

        {hasNoResults ? (
          <div className="text-center py-16 text-text-muted">
            <SearchIcon className="w-10 h-10 mx-auto mb-4 opacity-40" />
            <p className="text-lg">
              No sessions matching <span className="text-text-primary font-medium">&ldquo;{debouncedQuery}&rdquo;</span>
            </p>
            <p className="mt-2 text-sm">Try a different keyword or clear the search</p>
          </div>
        ) : (
          sortedProjects.map((project) => {
            const projectSessions = getProjectSessions(project.id)
            return (
              <div key={project.id} className="mb-6 md:mb-8">
                <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
                  <div className="p-3 md:p-4 border-b border-border flex items-center justify-between gap-2">
                    <Link
                      href={`/p/${project.id}`}
                      className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity flex-1"
                    >
                      <FolderIcon className="w-5 h-5 text-accent-primary flex-shrink-0" />
                      <span className="text-text-primary font-semibold">{project.name}</span>
                    </Link>
                    <Link
                      href={`/p/${project.id}/new`}
                      className="rounded font-medium transition-colors bg-accent-primary/25 text-text-primary hover:bg-accent-primary/40 px-1.5 py-1 text-xs"
                    >
                      + New Session
                    </Link>
                    <button
                      type="button"
                      onClick={() => setProjectToDelete({ id: project.id, name: project.name })}
                      className="p-1.5 rounded text-text-muted hover:text-accent-error hover:bg-accent-error/10 transition-colors"
                      title="Delete project"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="divide-y divide-border">
                    {projectSessions.length > 0 ? (
                      projectSessions.map((session) => {
                        const project = projects.find((p) => session.projectId === p.id)
                        const href = project ? `/p/${project.id}/s/${session.id}` : '#'
                        const displayTitle = session.title ?? session.id.slice(0, 8)
                        const matchType = matchTypes?.get(session.id)
                        return (
                          <Link
                            key={session.id}
                            href={href}
                            className="block p-3 md:p-4 hover:bg-bg-tertiary/50 cursor-pointer transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm text-text-muted truncate">
                                    {isSearching && matchType === 'title'
                                      ? highlightMatches(displayTitle, debouncedQuery)
                                      : displayTitle}
                                  </div>
                                  {isSearching && matchType && matchType !== 'title' && (
                                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                      <span className="text-[10px] font-medium text-accent-primary border border-accent-primary/30 bg-accent-primary/8 rounded px-1 py-0.5 leading-none">
                                        {matchType === 'prompts' ? 'prompts' : 'project'}
                                      </span>
                                      {matchType === 'prompts' && promptSnippets?.get(session.id) && (
                                        <span className="text-[11px] text-text-muted truncate max-w-[250px]">
                                          {highlightMatches(promptSnippets.get(session.id)!, debouncedQuery)}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-text-muted text-xs">{formatRelativeDate(session.updatedAt)}</span>
                                <span className="text-text-muted text-xs">{session.messageCount} msgs</span>
                              </div>
                            </div>
                          </Link>
                        )
                      })
                    ) : (
                      <div className="p-3 md:p-4 text-text-muted text-sm">No sessions yet</div>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}

        {!isSearching && sortedProjects.length === 0 && !loading && (
          <div className="text-center py-12 text-text-muted">No projects yet. Open a project to get started.</div>
        )}

        {loading && (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        )}
      </div>

      {showOpenModal && <OpenProjectModal isOpen={showOpenModal} onClose={() => setShowOpenModal(false)} />}

      {projectToDelete && (
        <DeleteProjectConfirmationModal
          isOpen={true}
          onClose={() => setProjectToDelete(null)}
          projectName={projectToDelete.name}
          onConfirm={() => deleteProject(projectToDelete.id)}
        />
      )}
    </div>
  )
}
