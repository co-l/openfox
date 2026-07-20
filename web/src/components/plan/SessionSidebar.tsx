import { useState } from 'react'
import { useSessionStats } from '../../hooks/useSessionStats'
import { useGitStatus } from '../../hooks/useGitStatus'
import { useConfigStore } from '../../stores/config'
import { useSettingsStore, SETTINGS_KEYS } from '../../stores/settings'
import { useSessionStore } from '../../stores/session'
import { useUpdateStore } from '../../stores/update'
import { authFetch } from '../../lib/api'
import { buildWorkspaceUrl } from '../../lib/editor-link'
import { formatTime, formatSpeed } from '../../lib/format-stats'
import { formatMetadataKeyLabel } from '../../lib/metadata-keys'
import { StatsModal } from './StatsModal'
import { MetadataEntries, MetadataSectionHeader } from '../shared/MetadataEntries'
import { MetadataModal } from '../shared/MetadataModal'
import { CriteriaEditor } from './CriteriaEditor'
import { DevServerFooter } from './DevServerFooter'
import { BackgroundProcesses } from './BackgroundProcesses'
import { BranchIcon, FolderIcon, ReloadIcon } from '../shared/icons'
import { AutoUpdateModal } from '../AutoUpdateModal'
import { DiffViewer } from './DiffViewer'
import { BranchModal } from './BranchModal'
import { WorkspaceModal } from './WorkspaceModal'
import type { Message } from '@shared/types.js'

interface SessionSidebarProps {
  messages: Message[]
  workdir?: string
}

export function SessionSidebar({ messages, workdir }: SessionSidebarProps) {
  const [showStatsModal, setShowStatsModal] = useState(false)
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [showBranchModal, setShowBranchModal] = useState(false)
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false)
  const [activeMetadataKey, setActiveMetadataKey] = useState<string | null>(null)

  const stats = useSessionStats(messages)
  const { branch } = useGitStatus()
  const version = useConfigStore((state) => state.version)
  const session = useSessionStore((state) => state.currentSession)

  const workspaceName = session?.workspace ? (session.workspace.split('/').pop() ?? null) : null

  const showEditorLink = useSettingsStore((s) => s.settings[SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR]) === 'true'

  const updateStatus = useUpdateStore((state) => state.status)
  const checkForUpdate = useUpdateStore((state) => state.check)
  // "Up to date" is only meaningful as a response to a manual check; the
  // background check on load should stay silent unless an update is available.
  const [manuallyChecked, setManuallyChecked] = useState(false)

  return (
    <div className="flex flex-col h-full">
      {/* AI Stats at the top */}
      {stats && (
        <div className="mb-4">
          <button
            onClick={() => setShowStatsModal(true)}
            className="w-full flex items-center justify-center px-3 py-2 rounded bg-bg-tertiary hover:bg-bg-secondary transition-colors"
            title="View detailed response and call-level stats"
          >
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <span className="text-text-secondary">{formatTime(stats.aiTime)}</span>
              <span className="w-px h-3 bg-border" />
              <span className="text-text-secondary">{formatSpeed(stats.avgPrefillSpeed)}</span>
              <span>pp</span>
              <span className="w-px h-3 bg-border" />
              <span className="text-text-secondary">{formatSpeed(stats.avgGenerationSpeed)}</span>
              <span>tg</span>
            </div>
          </button>

          <StatsModal isOpen={showStatsModal} onClose={() => setShowStatsModal(false)} stats={stats} />
        </div>
      )}

      {/* Metadata sections */}
      <div className="flex flex-col flex-1 overflow-y-auto">
        <div className="mt-4">
          <button
            onClick={() => setActiveMetadataKey('criteria')}
            className="w-full text-left cursor-pointer hover:bg-bg-tertiary rounded px-1 -mx-1 transition-colors"
          >
            <MetadataSectionHeader entries={session?.metadataEntries?.['criteria'] ?? []} title="Acceptance Criteria" />
          </button>
          {session && <CriteriaEditor entries={session?.metadataEntries?.['criteria'] ?? []} sessionId={session.id} />}
          {session &&
            (() => {
              const knownOrder = ['review_findings', 'todos']
              const all = session.metadataEntries ?? {}
              const known = knownOrder.filter((k) => k in all)
              const unknown = Object.keys(all)
                .filter((k) => k !== 'criteria' && !knownOrder.includes(k))
                .sort()
              return [...known, ...unknown]
                .filter((key) => (all[key]?.length ?? 0) > 0)
                .map((key) => (
                  <div key={key} className="mt-6">
                    <button
                      onClick={() => setActiveMetadataKey(key)}
                      className="w-full text-left cursor-pointer hover:bg-bg-tertiary rounded px-1 -mx-1 transition-colors"
                    >
                      <MetadataSectionHeader entries={all[key]!} title={formatMetadataKeyLabel(key)} />
                    </button>
                    <MetadataEntries
                      entries={all[key]!}
                      onClearAll={async () => {
                        try {
                          await authFetch(`/api/sessions/${session.id}/metadata/${key}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ entries: [] }),
                          })
                        } catch (e) {
                          console.error(`Failed to clear ${key}:`, e)
                        }
                      }}
                    />
                  </div>
                ))
            })()}
        </div>
      </div>

      {/* Workspace & branch info — above separator */}
      <div className="mt-4 space-y-1.5">
        <div className="flex items-center gap-2 text-sm">
          {showEditorLink && workdir ? (
            <a
              href={buildWorkspaceUrl(workdir)}
              className="flex items-center gap-2 min-w-0 flex-1 no-underline group"
              title="Open workspace in VSCode"
            >
              <FolderIcon className="w-4 h-4 text-text-muted flex-shrink-0" />
              <span className="truncate text-text-secondary group-hover:text-accent-primary transition-colors">
                {workspaceName ?? 'original'}
              </span>
            </a>
          ) : (
            <>
              <FolderIcon className="w-4 h-4 text-text-muted flex-shrink-0" />
              <span className="truncate text-text-secondary">{workspaceName ?? 'original'}</span>
            </>
          )}
          <button
            onClick={() => setShowWorkspaceModal(true)}
            className="ml-auto px-2 py-0.5 text-xs rounded bg-bg-tertiary text-text-secondary hover:bg-bg-secondary transition-colors"
          >
            Edit
          </button>
        </div>
        <div className="h-px bg-border" />
        <div className="flex items-center gap-2 text-sm">
          <BranchIcon />
          <span className="truncate text-text-secondary">{branch ?? 'unknown'}</span>
          <button
            onClick={() => setShowBranchModal(true)}
            className="ml-auto px-2 py-0.5 text-xs rounded bg-bg-tertiary text-text-secondary hover:bg-bg-secondary transition-colors"
          >
            Edit
          </button>
        </div>
      </div>

      {/* Diff viewer — between branch and dev server */}
      <DiffViewer />

      {/* Dev Server — below separator */}
      <DevServerFooter workdir={workdir} />

      {/* Background Processes */}
      <BackgroundProcesses sessionId={session?.id} />

      {/* Version footer */}
      {version && (
        <div className="mt-4 pt-4 border-t border-border text-center text-xs text-text-muted">
          <div className="flex items-center justify-center gap-1">
            <a
              href="https://github.com/co-l/openfox"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent-primary transition-colors"
            >
              OpenFox
            </a>
            {' - '}
            <span className="font-mono">v{version}</span>
            <button
              onClick={() => {
                setManuallyChecked(true)
                checkForUpdate(true)
              }}
              disabled={updateStatus === 'checking'}
              className="p-0.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
              title="Check for updates"
            >
              <ReloadIcon className={`w-3 h-3 ${updateStatus === 'checking' ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {updateStatus === 'available' && (
            <button onClick={() => setShowUpdateModal(true)} className="text-accent-primary hover:underline mt-1">
              Update OpenFox →
            </button>
          )}
          {manuallyChecked && updateStatus === 'upToDate' && <div className="mt-1">Up to date</div>}
          {updateStatus === 'error' && <div className="mt-1">Update check failed</div>}
        </div>
      )}

      <AutoUpdateModal isOpen={showUpdateModal} onClose={() => setShowUpdateModal(false)} versionInfo={null} />

      <MetadataModal
        isOpen={activeMetadataKey !== null}
        onClose={() => setActiveMetadataKey(null)}
        entries={session?.metadataEntries?.[activeMetadataKey ?? ''] ?? []}
        sessionId={session?.id ?? ''}
        metadataKey={activeMetadataKey ?? ''}
        title={formatMetadataKeyLabel(activeMetadataKey ?? '')}
      />

      {session && (
        <>
          <WorkspaceModal
            isOpen={showWorkspaceModal}
            onClose={() => setShowWorkspaceModal(false)}
            projectId={session.projectId}
            sessionId={session.id}
            currentWorkspace={workspaceName}
            currentBranch={branch ?? null}
          />
          <BranchModal isOpen={showBranchModal} onClose={() => setShowBranchModal(false)} sessionId={session.id} />
        </>
      )}
    </div>
  )
}
