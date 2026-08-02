import { ScrollArea } from '../shared/ScrollArea'
import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { LogViewer } from './LogViewer'
import { createPortal } from 'react-dom'
import { useSessionStore } from '../../stores/session'
import { useDevServerStore } from '../../stores/dev-server'
import { useGitStatus } from '../../hooks/useGitStatus'
import { useSettingsStore, SETTINGS_KEYS } from '../../stores/settings'
import { ProgressBar } from '../shared/ProgressBar'
import { MetadataSectionHeader } from '../shared/MetadataEntries'
import { MetadataStatusIcon, statusOrder } from '../shared/MetadataStatusIcon'
import { CriteriaEditor } from './CriteriaEditor'
import { pathBasename } from '../../lib/path'
import { DevServerFooter } from './DevServerFooter'
import { DevServerConfigModal } from './DevServerConfigModal'
import { DynamicContextPreviewModal } from './DynamicContextPreviewModal'
import { WorkspaceBranchSection } from './WorkspaceBranchSection'
import { WorkspaceModal } from './WorkspaceModal'
import { BranchModal } from './BranchModal'
import { ContextPopover } from './ContextPopover'
import { FolderIcon, BranchIcon, ChevronDownIcon, OpenExternalIcon, PlayIcon } from '../shared/icons'
import { MetadataEntries } from '../shared/MetadataEntries'
import { MetadataModal } from '../shared/MetadataModal'
import { formatMetadataKeyLabel } from '../../lib/metadata-keys'
import { wsClient } from '../../lib/ws'

const POPOVER_Z_INDEX = 9999

interface SidebarSummaryHeaderProps {
  visible: boolean
}

/* ------------------------------------------------------------------ */
/*  Popover — lightweight click-to-open popup via portal              */
/* ------------------------------------------------------------------ */

interface PopoverHandle {
  close: () => void
}

const Popover = forwardRef<PopoverHandle, { trigger: React.ReactNode; children: React.ReactNode }>(function Popover(
  { trigger, children },
  ref,
) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  useImperativeHandle(ref, () => ({ close }), [close])

  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        if (open) {
          close()
        } else {
          previousFocusRef.current = document.activeElement as HTMLElement
          setOpen(true)
        }
      }
      if (e.key === 'Escape' && open) {
        close()
      }
    },
    [open, close],
  )

  useEffect(() => {
    if (!open) {
      previousFocusRef.current?.focus()
      previousFocusRef.current = null
      return
    }
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        close()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const handleBlur = () => close()
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('blur', handleBlur)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('blur', handleBlur)
    }
  }, [open, close])

  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        className="inline-flex cursor-pointer text-text-muted hover:text-text-primary transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent-primary/50 rounded"
        onClick={() => {
          if (!open) {
            previousFocusRef.current = document.activeElement as HTMLElement
          }
          setOpen((v) => !v)
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        {trigger}
      </span>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-modal="true"
            className="fixed bg-bg-secondary border border-border rounded-lg shadow-xl p-3 w-[320px] max-w-[calc(100vw-16px)] max-h-[60vh]"
            style={(() => {
              if (!triggerRef.current) return { zIndex: POPOVER_Z_INDEX, top: 0, left: 0 }
              const rect = triggerRef.current.getBoundingClientRect()
              const estWidth = 320
              const margin = 8
              let left = rect.left
              if (left + estWidth > window.innerWidth - margin) {
                left = rect.right - estWidth
              }
              left = Math.max(margin, Math.min(left, window.innerWidth - estWidth - margin))
              return {
                zIndex: POPOVER_Z_INDEX,
                top: rect.bottom + 4,
                left,
              }
            })()}
          >
            <ScrollArea className="max-h-full">{children}</ScrollArea>
          </div>,
          document.body,
        )}
    </>
  )
})

/* ------------------------------------------------------------------ */
/*  Metadata helpers                                                  */
/* ------------------------------------------------------------------ */

function MetadataStatusSummary({ entries }: { entries: { status: string }[] }) {
  const counts = new Map<string, number>()
  for (const e of entries) {
    counts.set(e.status, (counts.get(e.status) ?? 0) + 1)
  }
  const ordered = statusOrder.filter((s) => (counts.get(s) ?? 0) > 0)

  if (ordered.length === 0) return <span className="text-text-muted text-sm">None</span>

  return (
    <span className="flex items-center gap-1.5 text-sm">
      {ordered.map((status) => (
        <span key={status} className="flex items-center gap-0.5">
          <MetadataStatusIcon status={status} />
          <span className="text-text-muted">{counts.get(status)}</span>
        </span>
      ))}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

export function SidebarSummaryHeader({ visible }: SidebarSummaryHeaderProps) {
  const session = useSessionStore((state) => state.currentSession)
  const devServerStatus = useDevServerStore((s) => s.status)
  const devServerConfig = useDevServerStore((s) => s.config)
  const devServerStart = useDevServerStore((s) => s.start)
  const contextState = useSessionStore((state) => state.contextState)
  const queueUpdate = useSessionStore((state) => state.queueUpdate)
  const devServerLogs = useDevServerStore((s) => s.logs)
  const { branch, diff } = useGitStatus()
  const [showLogModal, setShowLogModal] = useState(false)
  const [showDevServerConfig, setShowDevServerConfig] = useState(false)
  const [showSystemPromptModal, setShowSystemPromptModal] = useState(false)
  const [activeMetadataKey, setActiveMetadataKey] = useState<string | null>(null)
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false)
  const [showBranchModal, setShowBranchModal] = useState(false)
  const devServerPopoverRef = useRef<PopoverHandle>(null)
  const contextPopoverRef = useRef<PopoverHandle>(null)
  const metadataPopoverRef = useRef<PopoverHandle>(null)
  const workspacePopoverRef = useRef<PopoverHandle>(null)
  const showEditorLink = useSettingsStore((s) => s.settings[SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR]) === 'true'
  if (!visible || !session) return null

  const workspaceName = pathBasename(session.workspace ?? '') || 'original'
  const workdir = session.workspace ?? session.workdir

  /* ---- Metadata ---- */
  const allEntries = session.metadataEntries ?? {}
  const criteriaEntries = allEntries['criteria'] ?? []
  const knownExtraKeys = ['review_findings', 'todos']
  const extraKeys = knownExtraKeys.filter((k) => k in allEntries && (allEntries[k]?.length ?? 0) > 0)
  const customKeys = Object.keys(allEntries)
    .filter((k) => k !== 'criteria' && !knownExtraKeys.includes(k))
    .filter((k) => (allEntries[k]?.length ?? 0) > 0)
  const otherCount = [...extraKeys, ...customKeys].reduce((sum, k) => sum + (allEntries[k]?.length ?? 0), 0)
  const otherLabels = [...extraKeys, ...customKeys].map(formatMetadataKeyLabel)

  /* ---- Diff summary ---- */
  const diffFiles = diff.files
  const totalAdditions = diffFiles.reduce((s, f) => s + f.additions, 0)
  const totalDeletions = diffFiles.reduce((s, f) => s + f.deletions, 0)

  /* ---- Dev Server ---- */
  const state = devServerStatus?.state ?? 'off'
  const isAlive = state === 'running' || state === 'warning'
  const hasConfig = devServerConfig !== null

  const handleStart = (e: React.MouseEvent) => {
    e.stopPropagation()
    devServerStart()
  }

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (devServerStatus?.url) {
      window.open(devServerStatus.url, '_blank')
    }
  }

  return (
    <div className="flex-shrink-0 px-4 py-1.5 border-b border-border bg-secondary">
      <div className="grid grid-cols-2 sm:flex sm:items-center sm:justify-between gap-x-2 gap-y-1 text-sm">
        {/* ---- Workspace / Branch ---- */}
        <div className="flex items-center gap-1 min-w-0 sm:shrink-0">
          <FolderIcon className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
          <span className="truncate text-text-secondary max-w-[120px]">{workspaceName}</span>
          <span className="text-text-muted">/</span>
          <BranchIcon className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
          <span className="truncate text-text-secondary max-w-[120px]">{branch ?? '-'}</span>
          {diffFiles.length > 0 ? (
            <span className="text-text-muted shrink-0 font-mono">
              +{totalAdditions} -{totalDeletions}
            </span>
          ) : (
            <span className="shrink-0" />
          )}
          <Popover ref={workspacePopoverRef} trigger={<ChevronDownIcon className="w-3 h-3" />}>
            <WorkspaceBranchSection
              workspaceName={workspaceName}
              branch={branch}
              workdir={workdir}
              showEditorLink={showEditorLink}
              sessionId={session.id}
              projectId={session.projectId}
              onEditWorkspace={() => {
                workspacePopoverRef.current?.close()
                setShowWorkspaceModal(true)
              }}
              onEditBranch={() => {
                workspacePopoverRef.current?.close()
                setShowBranchModal(true)
              }}
            />
          </Popover>
        </div>

        {/* ---- Divider ---- */}
        <div className="hidden sm:block w-px bg-border self-stretch mx-1" />

        {/* ---- Metadata Status ---- */}
        <div className="flex-1 flex items-center sm:justify-center justify-self-end gap-1 min-w-0">
          <MetadataStatusSummary entries={criteriaEntries} />
          {otherCount > 0 && (
            <span
              className="text-text-muted text-xs bg-bg-tertiary px-1 py-0.5 rounded leading-none"
              title={otherLabels.join(', ')}
            >
              +{otherCount}
            </span>
          )}
          <Popover ref={metadataPopoverRef} trigger={<ChevronDownIcon className="w-3 h-3" />}>
            <div className="space-y-3">
              <div>
                <button
                  onClick={() => {
                    metadataPopoverRef.current?.close()
                    setActiveMetadataKey('criteria')
                  }}
                  className="w-full text-left cursor-pointer hover:[&_h3]:text-accent-primary transition-colors"
                >
                  <MetadataSectionHeader entries={criteriaEntries} title="Acceptance Criteria" />
                </button>
                <CriteriaEditor entries={criteriaEntries} sessionId={session.id} />
              </div>
              {[...extraKeys, ...customKeys].map((key) => {
                const entries = allEntries[key]!
                return (
                  <div key={key}>
                    <button
                      onClick={() => {
                        metadataPopoverRef.current?.close()
                        setActiveMetadataKey(key)
                      }}
                      className="w-full text-left cursor-pointer hover:[&_h3]:text-accent-primary transition-colors"
                    >
                      <MetadataSectionHeader entries={entries} title={formatMetadataKeyLabel(key)} />
                    </button>
                    <MetadataEntries entries={entries} />
                  </div>
                )
              })}
            </div>
          </Popover>
        </div>

        {/* ---- Divider ---- */}
        <div className="hidden sm:block w-px bg-border self-stretch mx-1" />

        {/* Mobile row separator — full width */}
        <div className="col-span-2 border-t border-border sm:hidden -mx-4" />

        {/* ---- Context ---- */}
        <div className="flex items-center gap-1.5 min-w-0 shrink-0">
          {contextState && (
            <>
              <span className="text-text-muted text-xs font-mono tabular-nums">
                {contextState.currentTokens >= 1000
                  ? `${Math.round(contextState.currentTokens / 1000)}K`
                  : contextState.currentTokens}
              </span>
              <ProgressBar
                percent={Math.round((contextState.currentTokens / contextState.maxTokens) * 100)}
                dangerZone={contextState.dangerZone}
                size="sm"
              />
              <Popover ref={contextPopoverRef} trigger={<ChevronDownIcon className="w-3 h-3" />}>
                <ContextPopover
                  onUpdateSystemPrompt={() => {
                    contextPopoverRef.current?.close()
                    setShowSystemPromptModal(true)
                  }}
                />
              </Popover>
            </>
          )}
        </div>

        {/* ---- Divider ---- */}
        <div className="hidden sm:block w-px bg-border self-stretch mx-1" />

        {/* ---- Dev Server ---- */}
        <div className="flex items-center gap-1.5 min-w-0 shrink-0 justify-self-end">
          <span
            className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
              state === 'running'
                ? 'bg-accent-success'
                : state === 'warning'
                  ? 'bg-accent-warning'
                  : state === 'error'
                    ? 'bg-accent-error'
                    : 'bg-text-muted'
            }`}
          />
          {hasConfig ? (
            isAlive ? (
              <button
                onClick={handleOpen}
                className="flex items-center justify-center p-1 rounded text-sm font-medium bg-accent-primary/25 text-text-primary hover:bg-accent-primary/40 transition-colors leading-none"
                title="Open dev server"
              >
                <OpenExternalIcon className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={handleStart}
                className="flex items-center justify-center p-1 rounded text-sm font-medium bg-accent-primary/25 text-text-primary hover:bg-accent-primary/40 transition-colors leading-none"
                title="Start dev server"
              >
                <PlayIcon className="w-3.5 h-3.5" />
              </button>
            )
          ) : (
            <span className="text-text-muted text-xs">No config</span>
          )}

          <Popover ref={devServerPopoverRef} trigger={<ChevronDownIcon className="w-3 h-3" />}>
            <DevServerFooter
              workdir={workdir}
              compact
              onExpand={() => setShowLogModal(true)}
              onConfigure={() => {
                devServerPopoverRef.current?.close()
                setShowDevServerConfig(true)
              }}
            />
          </Popover>
        </div>
      </div>

      {showLogModal && (
        <LogViewer title="Dev Server Logs" logs={devServerLogs} onClose={() => setShowLogModal(false)} />
      )}

      {showDevServerConfig && <DevServerConfigModal isOpen={true} onClose={() => setShowDevServerConfig(false)} />}

      {activeMetadataKey && session && (
        <MetadataModal
          isOpen={true}
          onClose={() => setActiveMetadataKey(null)}
          entries={allEntries[activeMetadataKey] ?? []}
          sessionId={session.id}
          metadataKey={activeMetadataKey}
          title={formatMetadataKeyLabel(activeMetadataKey)}
        />
      )}

      {showWorkspaceModal && (
        <WorkspaceModal
          isOpen={true}
          onClose={() => setShowWorkspaceModal(false)}
          projectId={session.projectId}
          sessionId={session.id}
          currentWorkspace={workspaceName}
          currentBranch={branch}
        />
      )}

      {showBranchModal && (
        <BranchModal isOpen={true} onClose={() => setShowBranchModal(false)} sessionId={session.id} />
      )}

      {showSystemPromptModal && contextState && (
        <DynamicContextPreviewModal
          isOpen={true}
          onClose={() => setShowSystemPromptModal(false)}
          isRunning={session.isRunning}
          onApply={() => {
            if (session.isRunning) {
              queueUpdate()
            } else {
              wsClient.send('context.applyDynamic', {})
            }
            setShowSystemPromptModal(false)
          }}
        />
      )}
    </div>
  )
}
