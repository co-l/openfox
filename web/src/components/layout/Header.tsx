import { useState, useEffect } from 'react'
import { Link } from 'wouter'
import { useSessionStore } from '../../stores/session'
import { useProjectStore } from '../../stores/project'
import { useConfigStore } from '../../stores/config'
import { GlobalSettingsModal } from '../settings/GlobalSettingsModal'

interface HeaderProps {
  onMenuClick?: () => void
  onCriteriaToggle?: () => void
  hasCriteria?: boolean
}

export function Header({ onMenuClick, onCriteriaToggle, hasCriteria }: HeaderProps) {
  const [showSettings, setShowSettings] = useState(false)
  const connectionStatus = useSessionStore(state => state.connectionStatus)
  const session = useSessionStore(state => state.currentSession)
  const project = useProjectStore(state => state.currentProject)
  const startAutoRefresh = useConfigStore(state => state.startAutoRefresh)
  const stopAutoRefresh = useConfigStore(state => state.stopAutoRefresh)

  // Start auto-refresh on mount
  useEffect(() => {
    startAutoRefresh()
    return () => stopAutoRefresh()
  }, [startAutoRefresh, stopAutoRefresh])

  return (
    <header className="h-8 bg-bg-secondary border-b border-border flex items-center justify-between px-2">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {/* Hamburger menu button - visible on mobile and tablet */}
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="lg:hidden flex-shrink-0 p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="Toggle sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}

        <Link href="/" className="text-accent-primary font-semibold text-base hover:underline flex-shrink-0">
          OpenFox
        </Link>
        {project && (
          <>
            <span className="text-text-muted flex-shrink-0">/</span>
            <Link
              href={`/p/${project.id}`}
              className="text-text-secondary hover:text-text-primary hover:underline text-sm truncate"
            >
              {project.name}
            </Link>
          </>
        )}
        {session && (
          <>
            <span className="text-text-muted flex-shrink-0">/</span>
            <span className="text-text-secondary text-sm truncate">
              {session.metadata.title ?? session.id.slice(0, 8)}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Criteria toggle button - only visible when there are criteria */}
        {onCriteriaToggle && hasCriteria && (
          <button
            onClick={onCriteriaToggle}
            className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="Toggle criteria sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </button>
        )}

        {/* Global Settings Button */}
        <button
          onClick={() => setShowSettings(true)}
          className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
          title="Global Settings"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        {/* Connection status - icon-only on mobile, full on desktop */}
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            connectionStatus === 'connected' ? 'bg-accent-success' :
            connectionStatus === 'reconnecting' ? 'bg-accent-warning animate-pulse' :
            'bg-accent-error'
          }`} />
          <span className="text-sm text-text-secondary hidden sm:inline">
            {connectionStatus === 'connected' ? 'Connected' :
             connectionStatus === 'reconnecting' ? 'Reconnecting...' :
             'Disconnected'}
          </span>
        </div>
      </div>

      {/* Global Settings Modal */}
      <GlobalSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </header>
  )
}