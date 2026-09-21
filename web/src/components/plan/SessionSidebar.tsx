import { ScrollArea } from '../shared/ScrollArea'
import { useState } from 'react'
import { useT } from '../../hooks/useT'
import { mergeLiveStats } from '@shared/stats.js'
import { useGitStatus } from '../../hooks/useGitStatus'
import { useScopedContext, useScopedPaneState } from '../../stores/session/session-scope'
import { useConfig } from '../../hooks/useConfig'
import { SETTINGS_KEYS } from '../../lib/resources'
import { useSetting } from '../../hooks/useSetting'
import { useUpdateStore } from '../../stores/update'
import { authFetch } from '../../lib/api'
import { pathBasename } from '../../lib/path'
import { formatTime, formatSpeed } from '../../lib/format-stats'
import { formatMetadataKeyLabel } from '../../lib/metadata-keys'
import { StatsModal } from './StatsModal'
import { MetadataEntries, MetadataSectionHeader } from '../shared/MetadataEntries'
import { MetadataModal } from '../shared/MetadataModal'
import { CriteriaEditor } from './CriteriaEditor'
import { DevServerFooter } from './DevServerFooter'
import { BackgroundProcesses } from './BackgroundProcesses'
import { ReloadIcon } from '../shared/icons'
import { AutoUpdateModal } from '../AutoUpdateModal'
import { PluginZone } from '../plugins/PluginZone'
import { WorkspaceBranchSection } from './WorkspaceBranchSection'
import { ContextPopover } from './ContextPopover'
import type { SessionStatsSummary } from '@shared/types.js'

interface SessionSidebarProps {
  workdir?: string
}

export function SessionSidebar({ workdir }: SessionSidebarProps) {
  const t = useT()
  const [showStatsModal, setShowStatsModal] = useState(false)
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [activeMetadataKey, setActiveMetadataKey] = useState<string | null>(null)

  const { branch } = useGitStatus()
  const version = useConfig().config?.version ?? null
  const { currentSession: session, sessionId } = useScopedContext()
  const sessionStats = useScopedPaneState(
    sessionId,
    (pane) => pane.sessionStats,
    (state) => state.sessionStats,
    null,
  )
  const liveTurnStats = useScopedPaneState(
    sessionId,
    (pane) => pane.liveTurnStats,
    (state) => state.liveTurnStats,
    null,
  )
  // The server computes the headline over the whole session (every context
  // window) and ships it lean. While a turn runs it streams the current
  // turn's cumulative stats after each LLM call — merge them on top so the
  // sidebar grows live and lands on the final numbers when the turn ends (the
  // live channel is cleared in the same frame the finished response lands in
  // the next server summary).
  const stats: SessionStatsSummary | null = liveTurnStats ? mergeLiveStats(sessionStats, liveTurnStats) : sessionStats

  const workspaceName = pathBasename(session?.workspace ?? '') || null

  const showEditorLink = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR).value === 'true'

  const updateStatus = useUpdateStore((state) => state.status)
  const checkForUpdate = useUpdateStore((state) => state.check)
  // "Up to date" is only meaningful as a response to a manual check; the
  // background check on load should stay silent unless an update is available.
  const [manuallyChecked, setManuallyChecked] = useState(false)

  return (
    <div className="flex flex-col h-full">
      {/* Context info */}
      <ContextPopover variant="sidebar" />

      {/* AI Stats at the top */}
      {stats && (
        <div className="mb-4">
          <button
            onClick={() => setShowStatsModal(true)}
            className="w-full flex items-center justify-center px-3 py-2 rounded bg-bg-tertiary hover:bg-bg-secondary transition-colors"
            title={t({
              en: 'View detailed response and call-level stats',
              fr: 'Voir les statistiques détaillées des réponses et des appels',
            })}
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

          <StatsModal
            isOpen={showStatsModal}
            onClose={() => setShowStatsModal(false)}
            summary={stats}
            sessionId={session?.id ?? ''}
          />
        </div>
      )}

      {/* Metadata sections */}
      <ScrollArea className="flex flex-col flex-1 px-4 -mx-4 pb-4">
        <div>
          <button
            onClick={() => setActiveMetadataKey('criteria')}
            className="w-full text-left cursor-pointer hover:[&_h3]:text-accent-primary transition-colors"
          >
            <MetadataSectionHeader
              entries={session?.metadataEntries?.['criteria'] ?? []}
              title={t({ en: 'Acceptance Criteria', fr: 'Critères d’acceptation' })}
            />
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
                      className="w-full text-left cursor-pointer hover:[&_h3]:text-accent-primary transition-colors"
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
      </ScrollArea>

      {/* Workspace & branch info — only shown for git repos. */}
      <WorkspaceBranchSection
        workspaceName={workspaceName ?? 'original'}
        branch={branch}
        workdir={workdir}
        showEditorLink={showEditorLink}
        sessionId={session?.id ?? ''}
        projectId={session?.projectId ?? ''}
      />

      {/* Dev Server — below separator */}
      <DevServerFooter workdir={workdir} />

      {/* Background Processes */}
      <BackgroundProcesses sessionId={session?.id} />

      {/* Version footer */}
      <PluginZone id="session.footer" context={{ sessionId: session?.id, workdir }}>
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
              <span className="font-mono">{`v${version}`}</span>
              <button
                onClick={() => {
                  setManuallyChecked(true)
                  checkForUpdate(true)
                }}
                disabled={updateStatus === 'checking'}
                className="p-0.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
                title={t({ en: 'Check for updates', fr: 'Vérifier les mises à jour' })}
              >
                <ReloadIcon className={`w-3 h-3 ${updateStatus === 'checking' ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {updateStatus === 'available' && (
              <button onClick={() => setShowUpdateModal(true)} className="text-accent-primary hover:underline mt-1">
                {t({ en: 'Update OpenFox →', fr: 'Mettre à jour OpenFox →' })}
              </button>
            )}
            {manuallyChecked && updateStatus === 'upToDate' && (
              <div className="mt-1">{t({ en: 'Up to date', fr: 'À jour' })}</div>
            )}
            {updateStatus === 'error' && (
              <div className="mt-1">
                {t({ en: 'Update check failed', fr: 'Échec de la vérification des mises à jour' })}
              </div>
            )}
          </div>
        )}
      </PluginZone>

      <AutoUpdateModal isOpen={showUpdateModal} onClose={() => setShowUpdateModal(false)} versionInfo={null} />

      <MetadataModal
        isOpen={activeMetadataKey !== null}
        onClose={() => setActiveMetadataKey(null)}
        entries={session?.metadataEntries?.[activeMetadataKey ?? ''] ?? []}
        sessionId={session?.id ?? ''}
        metadataKey={activeMetadataKey ?? ''}
        title={formatMetadataKeyLabel(activeMetadataKey ?? '')}
      />
    </div>
  )
}
