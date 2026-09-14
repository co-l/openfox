import { ScrollArea } from './shared/ScrollArea'
import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useLocation } from 'wouter'
import { useSessionStore } from '../stores/session'
import { useProjectStore } from '../stores/project'
import { useProjects } from '../hooks/useProjects'
import { useResource } from '../hooks/useResource'
import { useT } from '../hooks/useT'
import { summariesResource } from '../lib/resources'
import { Button } from './shared/Button'
import { OpenProjectModal } from './CreateSessionModal'
import { DeleteProjectConfirmationModal } from './DeleteProjectConfirmationModal'
import { formatRelativeDate } from '../lib/format-date'
import { sortProjectsStarredFirst } from '../lib/projects'
import {
  SearchIcon,
  XCloseIcon,
  FolderIcon,
  TrashIcon,
  TasksIcon,
  ColumnsIcon,
  StarFilledIcon,
  PlusMdIcon,
  ChevronDownIcon,
} from './shared/icons'
import { DropdownMenu, type DropdownMenuItem } from './shared/DropdownMenu'
import { Spinner } from './shared/Spinner'
import { fuzzyMatch, highlightMatches } from '../lib/modal-utils'
import { shouldAutofocus } from '../lib/device'
import { TasksModal } from './tasks/TasksModal'
import type { Translation } from '@shared/i18n/index.js'
import type { SessionSummary, ProjectTaskCounts } from '@shared/types.js'

const HOME_SESSION_LIMIT = 20

/** Color-coded task-state chips shown on each project's Tasks button. */
const TASK_STATE_CHIPS: {
  key: keyof Pick<ProjectTaskCounts, 'todo' | 'queued' | 'running' | 'done'>
  label: Translation
  color: string
}[] = [
  { key: 'todo', label: { en: 'To Do', fr: 'À faire' }, color: 'text-blue-400' },
  { key: 'queued', label: { en: 'Queued', fr: 'En file' }, color: 'text-amber-400' },
  { key: 'running', label: { en: 'Running', fr: 'En cours' }, color: 'text-emerald-400' },
  { key: 'done', label: { en: 'Done', fr: 'Terminé' }, color: 'text-text-muted' },
]

function TaskStateChips({ counts }: { counts?: ProjectTaskCounts }) {
  const t = useT()
  if (!counts) return null
  const total = counts.todo + counts.queued + counts.running + counts.done
  if (total === 0) return null
  return (
    <span className="flex items-center gap-1.5">
      {TASK_STATE_CHIPS.map((chip) => {
        const count = counts[chip.key]
        if (count === 0) return null
        return (
          <span key={chip.key} title={t(chip.label)} className={`flex items-center gap-1 ${chip.color}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            {count}
          </span>
        )
      })}
    </span>
  )
}

/** Per-project task counts (homepage chips) with implicit loadership. */
function ProjectTaskChips({ projectId }: { projectId: string }) {
  const { data } = useResource(summariesResource, projectId)
  return <TaskStateChips counts={data?.counts} />
}

/** Dropdown on a session row's project name: new session (real link) + tasks modal. */
function SessionProjectMenu({
  projectId,
  projectName,
  onTasks,
}: {
  projectId: string
  projectName: string
  onTasks: () => void
}) {
  const t = useT()
  const items: DropdownMenuItem[] = [
    {
      label: t({ en: 'New Session', fr: 'Nouvelle session' }),
      icon: <PlusMdIcon className="w-3.5 h-3.5" />,
      href: `/p/${projectId}/new`,
    },
    {
      label: t({ en: 'Tasks', fr: 'Tâches' }),
      icon: <TasksIcon className="w-3.5 h-3.5" />,
      onClick: onTasks,
    },
  ]
  return (
    <DropdownMenu
      items={items}
      minWidth="180px"
      trigger={
        <button
          type="button"
          className="flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-primary shrink-0 max-w-[90px] hover:underline"
          title={t({ en: 'Project options', fr: 'Options du projet' })}
        >
          <span className="truncate">{projectName}</span>
          <ChevronDownIcon className="w-2.5 h-2.5 flex-shrink-0" />
        </button>
      }
    />
  )
}

/** Color-coded activity dot for a session row on the homepage list. */
function SessionStatusDot({ session, waiting }: { session: SessionSummary; waiting: boolean }) {
  const t = useT()
  if (session.isRunning) {
    return (
      <span
        className="w-2 h-2 rounded-full shrink-0 bg-emerald-400 animate-pulse"
        title={t({ en: 'Running', fr: 'En cours' })}
      />
    )
  }
  if (waiting || session.phase === 'blocked') {
    return (
      <span
        className="w-2 h-2 rounded-full shrink-0 bg-amber-400"
        title={
          waiting
            ? t({ en: 'Waiting for your input', fr: 'En attente de votre intervention' })
            : t({ en: 'Blocked', fr: 'Bloqué' })
        }
      />
    )
  }
  return <span className="w-2 h-2 rounded-full shrink-0 bg-text-muted/60" />
}

export function HomePage() {
  const t = useT()
  const [, navigate] = useLocation()
  const [showOpenModal, setShowOpenModal] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [tasksProjectId, setTasksProjectId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // The home page shows only the 20 most recent sessions; the full corpus
  // (with prompts) is loaded on demand when the user searches.
  const sessions = useSessionStore((state) => state.searchSessions ?? state.sessions)
  const hasFullCorpus = useSessionStore((state) => state.searchSessions !== null)
  const sessionsWithPendingConfirmations = useSessionStore((state) => state.sessionsWithPendingConfirmations)
  const { projects, loading } = useProjects()
  const listHomeSessions = useSessionStore((state) => state.listHomeSessions)
  const ensureFullSessionList = useSessionStore((state) => state.ensureFullSessionList)
  const deleteProject = useProjectStore((state) => state.deleteProject)

  const connectionStatus = useSessionStore((state) => state.connectionStatus)

  useEffect(() => {
    if (connectionStatus === 'connected') {
      listHomeSessions()
    }
  }, [connectionStatus, listHomeSessions])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 150)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Searching needs every session (with prompts) — load the full list lazily,
  // exactly once, only once the user actually types something.
  useEffect(() => {
    if (debouncedQuery && !hasFullCorpus) {
      ensureFullSessionList()
    }
  }, [debouncedQuery, hasFullCorpus, ensureFullSessionList])

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

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  // The server already returns the home list ordered by last activity; sort
  // defensively and cap at the homepage budget.
  const recentSessions = useMemo(() => {
    return [...sessions]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, HOME_SESSION_LIMIT)
  }, [sessions])

  const visibleSessions = useMemo(() => {
    if (!debouncedQuery || !filteredSessionIds || !relevanceScores) return recentSessions
    return sessions
      .filter((s) => filteredSessionIds.has(s.id))
      .sort((a, b) => {
        const scoreDiff = (relevanceScores.get(b.id) ?? 0) - (relevanceScores.get(a.id) ?? 0)
        if (scoreDiff !== 0) return scoreDiff
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      })
  }, [sessions, debouncedQuery, filteredSessionIds, relevanceScores, recentSessions])

  // Mirror the project dropdown ordering: starred first, then the rest,
  // alphabetical within each group.
  const sortedProjects = useMemo(() => sortProjectsStarredFirst(projects), [projects])

  const handleOpenProject = () => {
    setShowOpenModal(true)
  }

  const handleClearSearch = () => {
    setSearchQuery('')
    setDebouncedQuery('')
    if (shouldAutofocus()) searchRef.current?.focus()
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
    <ScrollArea className="flex-1 flex flex-col bg-primary">
      <div className="max-w-5xl mx-auto w-full p-4 md:p-8">
        <div className="mb-6 md:mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-accent-primary">OpenFox</h1>
            <p className="text-text-secondary">
              {t({
                en: 'Local LLM-powered coding assistant with contract-driven execution',
                fr: 'Assistant de codage local propulsé par LLM avec exécution pilotée par contrat',
              })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/split-view"
              className="inline-flex items-center gap-1.5 rounded font-medium transition-colors bg-bg-secondary border border-border text-text-primary hover:bg-bg-tertiary px-3 py-1.5 text-sm"
            >
              <ColumnsIcon className="w-4 h-4" />
              {t({ en: 'Open split view', fr: 'Ouvrir la vue divisée' })}
            </Link>
            <Button variant="primary" onClick={handleOpenProject}>
              {t({ en: 'Open Project', fr: 'Ouvrir un projet' })}
            </Button>
          </div>
        </div>

        <div className="mb-4 md:mb-6 relative">
          <div className="relative flex items-center">
            <SearchIcon className="absolute left-3 w-4 h-4 text-text-muted pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t({
                en: 'Search sessions by title or keyword...',
                fr: 'Rechercher des sessions par titre ou mot-clé…',
              })}
              className="w-full bg-bg-secondary border border-border rounded-lg pl-10 pr-10 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-3 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                aria-label={t({ en: 'Clear search', fr: 'Effacer la recherche' })}
              >
                <XCloseIcon className="w-4 h-4" />
              </button>
            )}
          </div>
          {isSearching && !hasNoResults && (
            <div className="mt-1.5 text-xs text-text-muted px-1">
              {t(
                {
                  en: { one: '{{count}} match', other: '{{count}} matches' },
                  fr: { one: '{{count}} résultat', other: '{{count}} résultats' },
                },
                { count: matchCount },
              )}
            </div>
          )}
        </div>

        <div aria-label={t({ en: 'Recent sessions', fr: 'Sessions récentes' })} className="mb-6 md:mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
            {t({ en: 'Recent sessions', fr: 'Sessions récentes' })}
          </h2>
          {hasNoResults ? (
            <div className="text-center py-16 text-text-muted bg-bg-secondary border border-border rounded-lg">
              <SearchIcon className="w-10 h-10 mx-auto mb-4 opacity-40" />
              <p className="text-lg">
                {t({ en: 'No sessions matching', fr: 'Aucune session correspondant à' })}{' '}
                <span className="text-text-primary font-medium">&ldquo;{debouncedQuery}&rdquo;</span>
              </p>
              <p className="mt-2 text-sm">
                {t({
                  en: 'Try a different keyword or clear the search',
                  fr: 'Essayez un autre mot-clé ou effacez la recherche',
                })}
              </p>
            </div>
          ) : visibleSessions.length > 0 ? (
            <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden divide-y divide-border">
              {visibleSessions.map((session) => {
                const project = projectById.get(session.projectId)
                const displayTitle = session.title ?? session.id.slice(0, 8)
                const matchType = matchTypes?.get(session.id)
                const waiting = sessionsWithPendingConfirmations.includes(session.id)
                const rowClass =
                  'flex items-center gap-3 px-3 md:px-4 py-2.5 transition-colors' +
                  (project ? ' hover:bg-bg-tertiary/50 cursor-pointer' : ' cursor-default')
                const rowBody = (
                  <>
                    <span className="text-sm text-text-primary truncate flex-1 min-w-0">
                      {isSearching && matchType === 'title'
                        ? highlightMatches(displayTitle, debouncedQuery)
                        : displayTitle}
                    </span>
                    {isSearching && matchType && matchType !== 'title' && (
                      <span className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-medium text-accent-primary border border-accent-primary/30 bg-accent-primary/8 rounded px-1 py-0.5 leading-none">
                          {matchType === 'prompts'
                            ? t({ en: 'prompts', fr: 'invites' })
                            : t({ en: 'project', fr: 'projet' })}
                        </span>
                        {matchType === 'prompts' && promptSnippets?.get(session.id) && (
                          <span className="text-[11px] text-text-muted truncate max-w-[250px]">
                            {highlightMatches(promptSnippets.get(session.id)!, debouncedQuery)}
                          </span>
                        )}
                      </span>
                    )}
                    <span className="text-xs text-text-muted shrink-0">{formatRelativeDate(session.updatedAt)}</span>
                    <span className="text-xs text-text-muted shrink-0">
                      {t({ en: '{{count}} msgs', fr: '{{count}} msg' }, { count: session.messageCount })}
                    </span>
                  </>
                )
                const statusDot = <SessionStatusDot session={session} waiting={waiting} />
                return project ? (
                  <div
                    key={session.id}
                    className={rowClass}
                    onClick={(e) => {
                      if (e.button !== 0 || e.defaultPrevented) return
                      if ((e.target as HTMLElement).closest('[data-testid="session-dropdown-menu"]')) return
                      navigate(`/p/${project.id}/s/${session.id}`)
                    }}
                  >
                    {statusDot}
                    <SessionProjectMenu
                      projectId={project.id}
                      projectName={project.name}
                      onTasks={() => setTasksProjectId(project.id)}
                    />
                    <Link href={`/p/${project.id}/s/${session.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                      {rowBody}
                    </Link>
                  </div>
                ) : (
                  <div key={session.id} className={rowClass}>
                    {statusDot}
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-accent-primary shrink-0 max-w-[90px] truncate">
                      {session.projectId.slice(0, 10)}
                    </span>
                    <div className="flex items-center gap-3 flex-1 min-w-0">{rowBody}</div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="bg-bg-secondary border border-border rounded-lg p-3 md:p-4 text-text-muted text-sm">
              {t({
                en: 'No sessions yet. Start one from a project below.',
                fr: 'Aucune session pour le moment. Commencez-en une depuis un projet ci-dessous.',
              })}
            </div>
          )}
        </div>

        <div aria-label={t({ en: 'Projects', fr: 'Projets' })} className="mb-6 md:mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
            {t({ en: 'Projects', fr: 'Projets' })}
          </h2>
          {sortedProjects.length > 0 ? (
            <div className="space-y-3">
              {sortedProjects.map((project) => (
                <div key={project.id} className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
                  <div className="p-3 md:p-4 flex items-center justify-between gap-2">
                    <Link
                      href={`/p/${project.id}`}
                      className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity flex-1 min-w-0"
                    >
                      {project.isStarred ? (
                        <StarFilledIcon className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                      ) : (
                        <FolderIcon className="w-5 h-5 text-accent-primary flex-shrink-0" />
                      )}
                      <span className="text-text-primary font-semibold truncate">{project.name}</span>
                    </Link>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setTasksProjectId(project.id)}
                        title={t({ en: 'Tasks for {{name}}', fr: 'Tâches pour {{name}}' }, { name: project.name })}
                        aria-label={t({ en: 'Tasks for {{name}}', fr: 'Tâches pour {{name}}' }, { name: project.name })}
                        className="flex items-center gap-1.5"
                      >
                        <TasksIcon className="w-4 h-4" />
                        <span>{t({ en: 'Tasks', fr: 'Tâches' })}</span>
                        <ProjectTaskChips projectId={project.id} />
                      </Button>
                      <Link
                        href={`/p/${project.id}/new`}
                        className="rounded font-medium transition-colors bg-accent-primary/25 text-text-primary hover:bg-accent-primary/40 px-1.5 py-1 text-xs"
                      >
                        {t({ en: '+ New Session', fr: '+ Nouvelle session' })}
                      </Link>
                    </div>
                    <button
                      type="button"
                      onClick={() => setProjectToDelete({ id: project.id, name: project.name })}
                      className="p-1.5 rounded text-text-muted hover:text-accent-error hover:bg-accent-error/10 transition-colors"
                      title={t({ en: 'Delete project', fr: 'Supprimer le projet' })}
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            !loading && (
              <div className="bg-bg-secondary border border-border rounded-lg p-3 md:p-4 text-text-muted text-sm">
                {t({
                  en: 'No projects yet. Open a project to get started.',
                  fr: 'Aucun projet pour le moment. Ouvrez un projet pour commencer.',
                })}
              </div>
            )
          )}
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        )}
      </div>

      {showOpenModal && <OpenProjectModal isOpen={showOpenModal} onClose={() => setShowOpenModal(false)} />}

      {tasksProjectId && <TasksModal isOpen onClose={() => setTasksProjectId(null)} projectId={tasksProjectId} />}

      {projectToDelete && (
        <DeleteProjectConfirmationModal
          isOpen={true}
          onClose={() => setProjectToDelete(null)}
          projectName={projectToDelete.name}
          onConfirm={() => deleteProject(projectToDelete.id)}
        />
      )}
    </ScrollArea>
  )
}
