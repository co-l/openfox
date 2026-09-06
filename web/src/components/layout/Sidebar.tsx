import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useLocation, Link } from 'wouter'
import { useSessionStore } from '../../stores/session'
import type { PendingPathConfirmation } from '../../stores/session/types'
import { useCurrentProject } from '../../hooks/useCurrentProject'
import { useT } from '../../hooks/useT'
import type { SessionSummary } from '@shared/types.js'
import { ProjectSettingsModal } from '../settings/ProjectSettingsModal'
import { DropdownMenu } from '../shared/DropdownMenu'
import { ScrollArea } from '../shared/ScrollArea'
import { CloseButton } from '../shared/CloseButton'
import { ConfirmModal } from '../shared/ConfirmModal'
import { Modal } from '../shared/Modal'
import { ModalFooter } from '../shared/ModalFooter'
import {
  EllipsisIcon,
  SpinIcon,
  StopIcon,
  SearchIcon,
  XCloseIcon,
  StarIcon,
  StarFilledIcon,
  DownloadIcon,
  UploadIcon,
  GearIcon,
  TrashIcon,
  EditSmallIcon,
} from '../shared/icons'
import { groupSessionsByDate, formatDateHeader, formatTime } from '../../lib/format-date.js'
import { fuzzyMatch, highlightMatches } from '../../lib/modal-utils.js'
import { shouldAutofocus } from '../../lib/device'
import { useResource } from '../../hooks/useResource'
import { boardResource } from '../../lib/resources'
import { TaskStatusChip } from './TaskStatusChip'
import { columnMeta } from '../tasks/column-meta'
import type { TaskStatus } from '@shared/types.js'
import { useBinding, useKeybindings } from '../../hooks/useKeybindings.js'
import { hasStoredToken, downloadSessionExport, importSession } from '../../lib/api'
import { useResizable } from '../../hooks/useResizable'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useSidebarStore } from '../../stores/sidebar'

interface SidebarProps {
  projectId: string
  isOpen?: boolean
  /** When true, render as a fixed overlay (mobile / narrow desktop). When false, an inline flex item. */
  overlay?: boolean
  onClose?: () => void
}

export function Sidebar({ projectId, isOpen = true, overlay = false, onClose }: SidebarProps) {
  const t = useT()
  const [, navigate] = useLocation()
  const [showSettings, setShowSettings] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null)
  const [sessionToRename, setSessionToRename] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [showDeleteAll, setShowDeleteAll] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const importFileInputRef = useRef<HTMLInputElement>(null)

  const sessions = useSessionStore((state) => state.sessions)
  const currentSession = useSessionStore((state) => state.currentSession)
  const unreadSessionIds = useSessionStore((state) => state.unreadSessionIds)
  // Server-computed session→board-column map (session-card status chips).
  const { data: board } = useResource(boardResource, projectId)
  const deleteSession = useSessionStore((state) => state.deleteSession)
  const deleteAllSessions = useSessionStore((state) => state.deleteAllSessions)
  const loadMoreSessions = useSessionStore((state) => state.loadMoreSessions)
  const sessionsHasMore = useSessionStore((state) => state.sessionsHasMore)
  const sessionsPaginationLoading = useSessionStore((state) => state.sessionsPaginationLoading)
  const sessionsWithPendingConfirmations = useSessionStore((state) => state.sessionsWithPendingConfirmations)
  const pendingPathConfirmations = useSessionStore((state) => state.pendingPathConfirmations)
  const toggleFavorite = useSessionStore((state) => state.toggleFavorite)

  const currentProject = useCurrentProject()

  const [searchQuery, setSearchQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const searchRef = useRef<HTMLInputElement>(null)
  const sessionListRef = useRef<HTMLDivElement>(null)

  const { width: sidebarWidth, handleMouseDown: handleResizeMouseDown } = useResizable({
    initialWidth: 300,
    minWidth: 200,
    maxWidth: 600,
    direction: 'left',
  })

  useEffect(() => {
    useSidebarStore.getState().setLeftWidth(sidebarWidth)
  }, [sidebarWidth])

  const wasAutoOpenedRef = useRef(false)

  const connectionStatus = useSessionStore((state) => state.connectionStatus)
  const keybindings = useKeybindings(connectionStatus === 'connected' || hasStoredToken())
  useBinding(keybindings.sessionSearch, () => {
    if (isOpen && document.activeElement === searchRef.current) {
      onClose?.()
      return
    }
    if (!isOpen) {
      wasAutoOpenedRef.current = true
      onClose?.()
    }
    if (shouldAutofocus()) searchRef.current?.focus()
  })

  const loadMoreRef = useRef<HTMLDivElement>(null)

  const handleLoadMore = useCallback(() => {
    if (sessionsHasMore && !sessionsPaginationLoading && currentProject) {
      loadMoreSessions(currentProject.id)
    }
  }, [sessionsHasMore, sessionsPaginationLoading, currentProject, loadMoreSessions])

  useEffect(() => {
    if (!loadMoreRef.current || !sessionsHasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry && entry.isIntersecting) {
          handleLoadMore()
        }
      },
      { threshold: 0.1 },
    )

    observer.observe(loadMoreRef.current)
    return () => observer.disconnect()
  }, [sessionsHasMore, handleLoadMore])

  // Filter sessions to those belonging to the current project by ID
  const projectSessions = sessions.filter((session) => session.projectId === currentProject?.id)

  const [favoriteSessions, otherSessions] = useMemo(() => {
    const favs: SessionSummary[] = []
    const others: SessionSummary[] = []
    for (const s of projectSessions) {
      if (s.isFavorite) {
        favs.push(s)
      } else {
        others.push(s)
      }
    }
    return [favs, others]
  }, [projectSessions])

  const applySearch = (list: SessionSummary[]) => {
    if (!searchQuery) return list
    return list.filter((s) => {
      const title = s.title ?? ''
      const promptsJoined = (s.recentUserPrompts?.map((p) => p.content) ?? []).join(' ')
      return fuzzyMatch(title, searchQuery) || fuzzyMatch(promptsJoined, searchQuery)
    })
  }

  const filteredFavorites = useMemo(() => applySearch(favoriteSessions), [favoriteSessions, searchQuery])
  const filteredOthers = useMemo(() => applySearch(otherSessions), [otherSessions, searchQuery])

  const allFiltered = [...filteredFavorites, ...filteredOthers]

  const isSearching = searchQuery.length > 0
  const hasNoResults = isSearching && allFiltered.length === 0

  // Reset focused index when search results change
  useEffect(() => {
    setFocusedIndex(allFiltered.length > 0 ? 0 : -1)
  }, [allFiltered.length])

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex < 0) return
    const el = sessionListRef.current?.querySelector(`[data-sidx="${focusedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex])

  const handleDeleteSession = (sessionId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setSessionToDelete(sessionId)
  }

  const handleConfirmDeleteSession = () => {
    if (!sessionToDelete) return
    deleteSession(sessionToDelete)
    if (currentSession?.id === sessionToDelete) {
      navigate(`/p/${projectId}`)
    }
    setSessionToDelete(null)
  }

  const handleRenameSession = (sessionId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    const session = sessions.find((s) => s.id === sessionId)
    const currentTitle = session?.title ?? sessionId.slice(0, 6)
    setRenameValue(currentTitle)
    setSessionToRename(sessionId)
  }

  const handleConfirmRename = () => {
    if (!sessionToRename || renameValue.trim() === '') return
    const renameSession = useSessionStore.getState().renameSession
    renameSession(sessionToRename, renameValue.trim())
    setSessionToRename(null)
    setRenameValue('')
  }

  const handleDeleteAllSessions = () => {
    setShowDeleteAll(true)
  }

  const handleConfirmDeleteAll = () => {
    deleteAllSessions(projectId)
    navigate(`/p/${projectId}`)
    setShowDeleteAll(false)
  }

  const handleToggleFavorite = (sessionId: string, isFavorite: boolean) => {
    toggleFavorite(sessionId, !isFavorite)
  }

  const handleExportSession = async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId)
    setExportError(null)
    const ok = await downloadSessionExport(sessionId, session?.title)
    if (!ok) {
      setExportError(t({ en: 'Failed to export session', fr: 'Échec de l’export de la session' }))
    }
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportError(null)
    try {
      const payload = JSON.parse(await file.text())
      const result = await importSession(projectId, payload)
      if (result.ok) {
        navigate(`/p/${projectId}/s/${result.session.id}`)
      } else {
        setImportError(result.error)
      }
    } catch {
      setImportError(t({ en: 'Invalid session file', fr: 'Fichier de session invalide' }))
    }
  }

  const handleSessionListClick = (e: React.MouseEvent) => {
    if (!wasAutoOpenedRef.current) return
    const link = (e.target as HTMLElement).closest('a[href*="/s/"]')
    if (link) {
      wasAutoOpenedRef.current = false
      onClose?.()
    }
  }

  const handleClearSearch = () => {
    setSearchQuery('')
    if (shouldAutofocus()) searchRef.current?.focus()
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        setSearchQuery('')
        searchRef.current?.blur()
        break
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex((prev) => (prev < allFiltered.length - 1 ? prev + 1 : prev))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0))
        break
      case 'Enter': {
        e.preventDefault()
        const session = allFiltered[focusedIndex]
        if (session) {
          navigate(`/p/${projectId}/s/${session.id}`)
          if (wasAutoOpenedRef.current) {
            wasAutoOpenedRef.current = false
            onClose?.()
          }
        }
        break
      }
    }
  }

  return (
    <>
      {/* Overlay backdrop (mobile / narrow desktop) */}
      {overlay && isOpen && onClose && <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />}

      {/* Sidebar content — shared between desktop and mobile variants */}
      {(() => {
        const sidebarContent = (
          <>
            <div className="p-4 border-b border-border flex gap-2">
              <Link
                href={`/p/${projectId}/new`}
                className="flex-1 block text-center rounded font-medium transition-colors bg-accent-primary/25 text-text-primary hover:bg-accent-primary/40 px-3 py-1.5 text-sm"
                data-testid="sidebar-new-session-button"
              >
                {t({ en: '+ New Session', fr: '+ Nouvelle session' })}
              </Link>
              <input
                ref={importFileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
              <DropdownMenu
                items={[
                  {
                    label: t({ en: 'Import session', fr: 'Importer une session' }),
                    icon: <UploadIcon className="w-3.5 h-3.5" />,
                    onClick: () => importFileInputRef.current?.click(),
                  },
                  {
                    label: t({ en: 'Edit project settings', fr: 'Modifier les paramètres du projet' }),
                    icon: <GearIcon className="w-3.5 h-3.5" />,
                    onClick: () => setShowSettings(true),
                  },
                  {
                    label: t({ en: 'Delete all sessions', fr: 'Supprimer toutes les sessions' }),
                    icon: <TrashIcon className="w-3.5 h-3.5" />,
                    onClick: handleDeleteAllSessions,
                    danger: true,
                  },
                ]}
                trigger={
                  <button
                    className="flex-shrink-0 p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
                    title={t({ en: 'Options', fr: 'Options' })}
                  >
                    <EllipsisIcon />
                  </button>
                }
              />
              {/* Overlay close button */}
              {onClose && overlay && <CloseButton onClick={onClose} variant="sidebar" size="md" />}
            </div>

            {/* Transfer errors (import/export) */}
            {(importError || exportError) && (
              <div className="px-4 py-2 border-b border-border text-xs text-accent-error flex items-center justify-between gap-2">
                <span className="break-words">{importError ?? exportError}</span>
                <button
                  type="button"
                  onClick={() => {
                    setImportError(null)
                    setExportError(null)
                  }}
                  className="flex-shrink-0 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                  aria-label={t({ en: 'Dismiss', fr: 'Fermer' })}
                >
                  <XCloseIcon className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Search bar */}
            <div className="px-4 py-2 border-b border-border">
              <div className="relative flex items-center">
                <SearchIcon className="absolute left-2.5 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={t({ en: 'Search sessions...', fr: 'Rechercher des sessions…' })}
                  className="w-full bg-bg-tertiary border border-border rounded pl-8 pr-8 py-1.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary/50 focus:border-accent-primary transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    className="absolute right-1.5 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                    aria-label={t({ en: 'Clear search', fr: 'Effacer la recherche' })}
                  >
                    <XCloseIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {isSearching && !hasNoResults && (
                <div className="mt-1 text-xs text-text-muted px-1">
                  {t(
                    {
                      en: { one: '{{count}} match', other: '{{count}} matches' },
                      fr: { one: '{{count}} résultat', other: '{{count}} résultats' },
                    },
                    { count: allFiltered.length },
                  )}
                </div>
              )}
            </div>

            {/* Project Settings Modal */}
            {currentProject && (
              <ProjectSettingsModal
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
                project={currentProject}
              />
            )}

            <ConfirmModal
              isOpen={sessionToDelete !== null}
              onClose={() => setSessionToDelete(null)}
              onConfirm={handleConfirmDeleteSession}
              title={t({ en: 'Delete session?', fr: 'Supprimer la session ?' })}
              message={t({
                en: 'This session will be permanently deleted.',
                fr: 'Cette session sera définitivement supprimée.',
              })}
              confirmLabel={t({ en: 'Delete session', fr: 'Supprimer la session' })}
              confirmVariant="danger"
            />

            <ConfirmModal
              isOpen={showDeleteAll}
              onClose={() => setShowDeleteAll(false)}
              onConfirm={handleConfirmDeleteAll}
              title={t({ en: 'Delete all sessions?', fr: 'Supprimer toutes les sessions ?' })}
              message={t({
                en: 'Delete all sessions in this project? This cannot be undone.',
                fr: 'Supprimer toutes les sessions de ce projet ? Cette action est irréversible.',
              })}
              confirmLabel={t({ en: 'Delete all', fr: 'Tout supprimer' })}
              confirmVariant="danger"
            />

            <Modal
              isOpen={sessionToRename !== null}
              onClose={() => {
                setSessionToRename(null)
                setRenameValue('')
              }}
              title={t({ en: 'Rename session', fr: 'Renommer la session' })}
              size="sm"
              footer={
                <ModalFooter
                  onCancel={() => {
                    setSessionToRename(null)
                    setRenameValue('')
                  }}
                  onSave={handleConfirmRename}
                  saving={false}
                  saveDisabled={renameValue.trim() === ''}
                  saveLabel={t({ en: 'Rename', fr: 'Renommer' })}
                />
              }
            >
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmRename()
                }}
                onFocus={(e) => e.target.select()}
                className="w-full px-3 py-2 text-sm text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:ring-1 focus:ring-accent-primary"
                autoFocus={shouldAutofocus()}
              />
            </Modal>

            <ScrollArea className="flex-1">
              {allFiltered.length === 0 ? (
                <div className="p-4 text-center text-text-muted text-xs">
                  {isSearching
                    ? t({ en: 'No matching sessions', fr: 'Aucune session correspondante' })
                    : t({ en: 'No sessions', fr: 'Aucune session' })}
                </div>
              ) : (
                <>
                  <div className="divide-y divide-border" ref={sessionListRef} onClick={handleSessionListClick}>
                    {renderSessionList(
                      filteredFavorites,
                      filteredOthers,
                      currentSession,
                      unreadSessionIds,
                      handleDeleteSession,
                      handleRenameSession,
                      handleToggleFavorite,
                      handleExportSession,
                      projectId,
                      sessionsWithPendingConfirmations,
                      pendingPathConfirmations,
                      searchQuery,
                      focusedIndex,
                      t,
                      board?.sessionStatus,
                    )}
                  </div>
                  {sessionsPaginationLoading && (
                    <div className="p-4 text-center text-text-muted text-xs">
                      {t({ en: 'Loading more...', fr: 'Chargement…' })}
                    </div>
                  )}
                  <div ref={loadMoreRef} className="h-px" />
                </>
              )}
            </ScrollArea>
          </>
        )

        return overlay ? (
          <aside
            className={`fixed z-50 h-[calc(100vh-32px)] w-[300px] bg-secondary border-r border-border flex flex-col transition-transform duration-300 ease-in-out ${
              isOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            {sidebarContent}
          </aside>
        ) : (
          <aside
            className={`relative shrink-0 bg-secondary flex flex-col overflow-hidden ${
              isOpen ? 'w-[var(--sidebar-w)] border-r border-border' : 'w-0 border-r-0'
            }`}
            style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
          >
            {sidebarContent}
            {isOpen && <ResizeHandle side="right" onMouseDown={handleResizeMouseDown} />}
          </aside>
        )
      })()}
    </>
  )
}

function renderSessionList(
  favoriteSessions: SessionSummary[],
  otherSessions: SessionSummary[],
  currentSession: { id: string | null } | null,
  unreadSessionIds: string[],
  handleDeleteSession: (sessionId: string, e?: React.MouseEvent) => void,
  handleRenameSession: (sessionId: string, e?: React.MouseEvent) => void,
  handleToggleFavorite: (sessionId: string, isFavorite: boolean) => void,
  handleExportSession: (sessionId: string) => void,
  projectId: string,
  sessionsWithPendingConfirmations: string[],
  pendingPathConfirmations: PendingPathConfirmation[],
  searchQuery: string,
  focusedIndex: number,
  t: (
    tx: { en: string | Record<string, string>; fr: string | Record<string, string> },
    vars?: Record<string, string | number>,
  ) => string,
  sessionStatus?: Record<string, TaskStatus>,
) {
  let flatIdx = 0

  const renderSession = (session: SessionSummary) => {
    const idx = flatIdx++
    const isActive = currentSession?.id === session.id
    const isFocused = idx === focusedIndex
    const hasUnread = unreadSessionIds.includes(session.id)
    const isRunning = session.isRunning
    const isFavorite = session.isFavorite
    const hasPendingConfirmation =
      sessionsWithPendingConfirmations.includes(session.id) || (isActive && pendingPathConfirmations.length > 0)

    return (
      <div
        key={session.id}
        data-sidx={idx}
        className={`w-full px-4 py-3 text-left hover:bg-bg-tertiary/50 transition-colors group ${
          isActive ? 'bg-bg-tertiary' : ''
        } ${isFocused ? 'bg-accent-primary/10' : ''}`}
      >
        <Link
          href={`/p/${projectId}/s/${session.id}`}
          className={`block ${isActive ? 'text-accent-primary' : 'text-text-primary'} hover:text-accent-primary`}
        >
          <div className="flex justify-between items-center mb-1">
            <span className={`font-medium truncate text-sm ${isActive ? 'text-accent-primary' : 'text-text-primary'}`}>
              {searchQuery
                ? highlightMatches(session.title ?? session.id.slice(0, 6), searchQuery)
                : (session.title ?? session.id.slice(0, 6))}
            </span>
            <div className="flex items-center gap-1">
              <DropdownMenu
                items={[
                  {
                    label: isFavorite
                      ? t({ en: 'Remove from favorites', fr: 'Retirer des favoris' })
                      : t({ en: 'Add to favorites', fr: 'Ajouter aux favoris' }),
                    icon: isFavorite ? (
                      <StarFilledIcon className="w-3.5 h-3.5 text-amber-400" />
                    ) : (
                      <StarIcon className="w-3.5 h-3.5" />
                    ),
                    onClick: () => handleToggleFavorite(session.id, isFavorite),
                  },
                  {
                    label: t({ en: 'Rename session', fr: 'Renommer la session' }),
                    icon: <EditSmallIcon className="w-3.5 h-3.5" />,
                    onClick: (e?: React.MouseEvent) => handleRenameSession(session.id, e),
                  },
                  ...(isRunning
                    ? []
                    : [
                        {
                          label: t({ en: 'Export session', fr: 'Exporter la session' }),
                          icon: <DownloadIcon className="w-3.5 h-3.5" />,
                          onClick: (e?: React.MouseEvent) => {
                            e?.stopPropagation()
                            handleExportSession(session.id)
                          },
                        },
                      ]),
                  {
                    label: t({ en: 'Delete session', fr: 'Supprimer la session' }),
                    icon: <TrashIcon className="w-3.5 h-3.5" />,
                    onClick: (e?: React.MouseEvent) => handleDeleteSession(session.id, e),
                    danger: true,
                  },
                ]}
                trigger={
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                    }}
                    className="p-1.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-all"
                    title={t({ en: 'Options', fr: 'Options' })}
                  >
                    <EllipsisIcon />
                  </button>
                }
              />
            </div>
          </div>
          {/* Time displayed below the title as muted secondary text */}
          <div className="flex items-center gap-2 mt-1">
            {hasPendingConfirmation ? (
              <span title={t({ en: 'Awaiting confirmation', fr: 'En attente de confirmation' })}>
                <StopIcon className="w-3 h-3 text-red-400 flex-shrink-0" />
              </span>
            ) : isRunning ? (
              <SpinIcon />
            ) : hasUnread && !isActive ? (
              <span
                aria-label={t({ en: 'Unread activity', fr: 'Activité non lue' })}
                title={t({ en: 'Unread activity', fr: 'Activité non lue' })}
                className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0"
              />
            ) : null}
            {/* Time in muted style */}
            {!isFavorite && (
              <span className="text-text-muted text-xs flex-shrink-0">{formatTime(session.updatedAt)}</span>
            )}
            {/* Message count in muted style */}
            <span className="text-text-muted text-xs flex-shrink-0">
              {t({ en: '{{count}} messages', fr: '{{count}} messages' }, { count: session.messageCount })}
            </span>
            {sessionStatus?.[session.id] && (
              <TaskStatusChip
                status={sessionStatus[session.id]!}
                label={t(columnMeta(sessionStatus[session.id]!).title)}
              />
            )}
          </div>
        </Link>
      </div>
    )
  }

  const renderGroupedSessions = (sessionList: SessionSummary[]) => {
    const groups = groupSessionsByDate(sessionList)
    return Array.from(groups).map(([dateKey, daySessions]) => {
      const firstSession = daySessions[0]
      if (!firstSession) return null

      return (
        <div key={dateKey}>
          <div className="px-4 py-2 bg-bg-tertiary/30 text-text-muted text-xs font-medium">
            {formatDateHeader(firstSession.updatedAt)}
          </div>
          {daySessions.map((session) => renderSession(session))}
        </div>
      )
    })
  }

  return (
    <>
      {/* Pinned favorites section */}
      {favoriteSessions.length > 0 && (
        <div>
          <div className="px-4 py-2 bg-bg-tertiary/50 text-text-primary text-xs font-semibold flex items-center gap-1">
            <StarFilledIcon className="w-3 h-3 text-amber-400" />
            {t({ en: 'Favorites', fr: 'Favoris' })}
          </div>
          {favoriteSessions.map((session) => renderSession(session))}
        </div>
      )}

      {/* Regular sessions grouped by date */}
      {otherSessions.length > 0 && renderGroupedSessions(otherSessions)}
    </>
  )
}
