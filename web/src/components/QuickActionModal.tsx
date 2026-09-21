import { SearchResultsList, SelectableListButton } from './shared/SearchResultsList'
import { Modal } from './shared/Modal'
import { useEffect, useState, useRef } from 'react'
import { useLocation } from 'wouter'
import { useT } from '../hooks/useT'

function getProjectIdFromPath(path: string): string | undefined {
  const match = path.match(/^\/p\/([^/]+)/)
  return match?.[1]
}
import { useAgents } from '../hooks/useAgents'
import { useResource } from '../hooks/useResource'
import { commandsResource, workflowsResource } from '../lib/resources'
import { useSessionStore } from '../stores/session'
import { useSessionScope, useScopedPaneState } from '../stores/session/session-scope'
import { dedupById, fuzzyMatch, handleModalNavigation } from '../lib/modal-utils'
import type { WorkflowScope } from '@shared/types.js'
import { useResetSearchOnOpen } from '../hooks/useResetSearchOnOpen'

interface QuickActionModalProps {
  isOpen: boolean
  onClose: () => void
  onCloseComplete?: () => void
  onSelectCommand: (commandId: string, textareaContent?: string) => void
  onSelectWorkflow: (workflowId: string, scope?: WorkflowScope) => void
  onCloseCompleteAction?: () => void
  textareaContent?: string
  onSearchMessages?: () => void
  onToggleAutoScroll?: (enabled: boolean) => void
  isAutoScrollActive?: boolean
}

interface ActionItem {
  id: string
  name: string
  prefix: string
  action: () => void
}

export function QuickActionModal({
  isOpen,
  onClose,
  onCloseComplete,
  onSelectCommand,
  onSelectWorkflow,
  onCloseCompleteAction,
  textareaContent,
  onSearchMessages,
  onToggleAutoScroll,
  isAutoScrollActive,
}: QuickActionModalProps) {
  const t = useT()
  const [, navigate] = useLocation()
  const sessionId = useSessionScope()
  const currentMode = useScopedPaneState(
    sessionId,
    (pane) => pane.session?.mode ?? null,
    (state) => state.currentSession?.mode ?? null,
    null,
  )
  const currentDangerLevel = useScopedPaneState(
    sessionId,
    (pane) => pane.session?.dangerLevel ?? 'normal',
    (state) => state.currentSession?.dangerLevel ?? 'normal',
    'normal',
  )
  const switchMode = useSessionStore((state) => state.switchMode)
  const switchDangerLevel = useSessionStore((state) => state.switchDangerLevel)
  const currentProjectId = useScopedPaneState(
    sessionId,
    (pane) => pane.session?.projectId ?? null,
    (state) => state.currentSession?.projectId ?? null,
    null,
  )
  const currentWorkdir = useScopedPaneState(
    sessionId,
    (pane) => pane.session?.workdir ?? undefined,
    (state) => state.currentSession?.workdir,
    undefined,
  )
  const { agents } = useAgents(currentWorkdir)
  const { data: commandData } = useResource(commandsResource, currentWorkdir)
  const commandDefaults = commandData?.defaults ?? []
  const commandUserItems = commandData?.userItems ?? []
  const commandProjectItems = commandData?.projectItems ?? []
  const { data: workflowData } = useResource(workflowsResource, currentWorkdir)
  const workflowDefaults = workflowData?.defaults ?? []
  const workflowUserItems = workflowData?.userItems ?? []
  const workflowProjectItems = workflowData?.projectItems ?? []
  const closeCompleteAction = useRef<(() => void) | undefined>(undefined)

  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const wasOpenRef = useRef(false)

  useResetSearchOnOpen(isOpen, searchRef, setSearch, setSelectedIndex, [currentWorkdir])

  useEffect(() => {
    if (isOpen) wasOpenRef.current = true
  }, [isOpen])

  useEffect(() => {
    if (!isOpen && wasOpenRef.current) {
      onCloseComplete?.()
      closeCompleteAction.current?.()
      closeCompleteAction.current = undefined
    }
  }, [isOpen, onCloseComplete])

  const items: ActionItem[] = [
    {
      id: 'create-session',
      name: t({ en: 'New Session', fr: 'Nouvelle session' }),
      prefix: t({ en: 'Action > Create', fr: 'Action > Créer' }),
      action: () => {
        const projectId = currentProjectId ?? getProjectIdFromPath(window.location.pathname)
        if (projectId) navigate(`/p/${projectId}/new`)
      },
    },
    {
      id: 'navigate-session',
      name: t({ en: 'Another Session', fr: 'Une autre session' }),
      prefix: t({ en: 'Action > Navigate to', fr: 'Action > Aller vers' }),
      action: () => {
        closeCompleteAction.current = onCloseCompleteAction
        onClose()
      },
    },
    {
      id: 'search-messages',
      name: t({ en: 'Messages', fr: 'Messages' }),
      prefix: t({ en: 'Action > Search', fr: 'Action > Rechercher' }),
      action: () => {
        onClose()
        onSearchMessages?.()
      },
    },
    {
      id: 'toggle-autoscroll',
      name: isAutoScrollActive
        ? t({ en: 'Auto-scroll Off', fr: 'Défilement auto désactivé' })
        : t({ en: 'Auto-scroll On', fr: 'Défilement auto activé' }),
      prefix: t({ en: 'Action > Toggle', fr: 'Action > Activer/désactiver' }),
      action: () => {
        onClose()
        onToggleAutoScroll?.(!isAutoScrollActive)
      },
    },
    ...agents
      .filter((a) => !a.subagent && a.id !== currentMode)
      .map((a) => ({
        id: a.id,
        name: a.name,
        prefix: t({ en: 'Agent > Switch to', fr: 'Agent > Passer à' }),
        action: () => sessionId && switchMode(sessionId, a.id),
      })),
    ...dedupById(dedupById(commandDefaults, commandUserItems), commandProjectItems).map((c) => ({
      id: c.id,
      name: c.name,
      prefix: t({ en: 'Command > Launch', fr: 'Commande > Lancer' }),
      action: () => onSelectCommand(c.id, textareaContent),
    })),
    ...dedupById(dedupById(workflowDefaults, workflowUserItems), workflowProjectItems).map((w) => ({
      id: w.id,
      name: w.name,
      prefix: t({ en: 'Workflow > Run', fr: 'Workflow > Exécuter' }),
      action: () => onSelectWorkflow(w.id, w.scope),
    })),
    ...(['normal', 'dangerous'] as const)
      .filter((m) => m !== currentDangerLevel)
      .map((m) => ({
        id: m,
        name: m === 'dangerous' ? t({ en: 'Dangerous', fr: 'Dangereux' }) : t({ en: 'Normal', fr: 'Normal' }),
        prefix: t({ en: 'Mode > Switch to', fr: 'Mode > Passer à' }),
        action: () => sessionId && switchDangerLevel(sessionId, m),
      })),
  ]

  const filteredItems = items.filter((item) => fuzzyMatch(`${item.prefix} ${item.name}`, search))
  const maxIndex = filteredItems.length - 1

  const handleKeyDown = (e: React.KeyboardEvent) => {
    handleModalNavigation(
      e,
      maxIndex,
      setSelectedIndex,
      () => {
        filteredItems[selectedIndex]?.action()
        onClose()
      },
      onClose,
    )
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t({ en: 'Quick Actions', fr: 'Actions rapides' })}
      size="md"
      scrollable={false}
    >
      <SearchResultsList
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setSelectedIndex(0)
        }}
        onSearchKeyDown={handleKeyDown}
        placeholder={t({ en: 'Search...', fr: 'Rechercher…' })}
        searchRef={searchRef}
        rows={filteredItems.map((item, index) => (
          <SelectableListButton
            key={item.id}
            selected={index === selectedIndex}
            onClick={() => {
              item.action()
              onClose()
            }}
          >
            <span className="text-text-muted font-normal">{item.prefix} </span>
            <span>{item.name}</span>
          </SelectableListButton>
        ))}
        emptyText={
          commandDefaults.length + commandUserItems.length + workflowDefaults.length + workflowUserItems.length > 0
            ? t({ en: 'No matches', fr: 'Aucun résultat' })
            : t({ en: 'No agents, commands, or workflows yet', fr: 'Aucun agent, commande ou workflow pour le moment' })
        }
      />
    </Modal>
  )
}
