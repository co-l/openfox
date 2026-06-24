import { useState, useCallback, useEffect } from 'react'
import { useSessionStats } from '../../hooks/useSessionStats'
import { useGitStatus } from '../../hooks/useGitStatus'
import { useConfigStore } from '../../stores/config'
import { useSessionStore } from '../../stores/session'
import { formatTime, formatSpeed } from '../../lib/format-stats'
import { StatsModal } from './StatsModal'
import { MetadataEntries, MetadataSectionHeader } from '../shared/MetadataEntries'
import { CriteriaEditor } from './CriteriaEditor'
import { DevServerFooter } from './DevServerFooter'
import { BackgroundProcesses } from './BackgroundProcesses'
import { BranchIcon, ReloadIcon } from '../shared/icons'
import { AutoUpdateModal } from '../AutoUpdateModal'
import { DiffViewer } from './DiffViewer'
import type { Message } from '@shared/types.js'

interface SessionSidebarProps {
  messages: Message[]
  workdir?: string
}

export function SessionSidebar({ messages, workdir }: SessionSidebarProps) {
  const [showStatsModal, setShowStatsModal] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [showUpdateModal, setShowUpdateModal] = useState(false)

  const stats = useSessionStats(messages)
  const { branch } = useGitStatus()
  const version = useConfigStore((state) => state.version)
  const session = useSessionStore((state) => state.currentSession)

  const checkForUpdate = useCallback(async () => {
    setCheckingUpdate(true)
    try {
      const res = await fetch('/api/auto-update/check')
      if (res.ok) {
        const data = (await res.json()) as { isUpdateAvailable: boolean; current: string; latest: string }
        setUpdateAvailable(data.isUpdateAvailable)
      }
    } catch {
      // silently fail
    } finally {
      setCheckingUpdate(false)
    }
  }, [])

  useEffect(() => {
    checkForUpdate()
  }, [checkForUpdate])

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
          <MetadataSectionHeader entries={session?.metadataEntries?.['criteria'] ?? []} title="Acceptance Criteria" />
          {session && <CriteriaEditor entries={session?.metadataEntries?.['criteria'] ?? []} sessionId={session.id} />}
          {session && (session.metadataEntries?.['review_findings']?.length ?? 0) > 0 && (
            <div className="mt-6">
              <MetadataSectionHeader entries={session.metadataEntries!['review_findings']!} title="Review Findings" />
              <MetadataEntries entries={session.metadataEntries!['review_findings']!} />
            </div>
          )}
        </div>
      </div>

      {/* Git branch — above separator */}
      {branch && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <BranchIcon />
          <span className="truncate text-text-secondary" title={branch}>
            {branch}
          </span>
        </div>
      )}

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
              onClick={() => checkForUpdate()}
              disabled={checkingUpdate}
              className="p-0.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
              title="Check for updates"
            >
              <ReloadIcon className={`w-3 h-3 ${checkingUpdate ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {updateAvailable && (
            <button onClick={() => setShowUpdateModal(true)} className="text-accent-primary hover:underline mt-1">
              Update OpenFox →
            </button>
          )}
        </div>
      )}

      <AutoUpdateModal isOpen={showUpdateModal} onClose={() => setShowUpdateModal(false)} versionInfo={null} />
    </div>
  )
}
