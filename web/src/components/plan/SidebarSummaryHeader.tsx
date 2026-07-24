import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useSessionStore } from '../../stores/session'
import { useDevServerStore } from '../../stores/dev-server'
import { useGitStatus } from '../../hooks/useGitStatus'
import { useSettingsStore, SETTINGS_KEYS } from '../../stores/settings'
import { MetadataSectionHeader } from '../shared/MetadataEntries'
import { MetadataStatusIcon, statusOrder } from '../shared/MetadataStatusIcon'
import { CriteriaEditor } from './CriteriaEditor'
import { DevServerFooter } from './DevServerFooter'
import { WorkspaceBranchSection } from './WorkspaceBranchSection'
import { FolderIcon, BranchIcon, ChevronDownIcon, OpenExternalIcon } from '../shared/icons'
import { MetadataEntries } from '../shared/MetadataEntries'
import { formatMetadataKeyLabel } from '../../lib/metadata-keys'

const POPOVER_Z_INDEX = 9999

interface SidebarSummaryHeaderProps {
  visible: boolean
}

/* ------------------------------------------------------------------ */
/*  Popover — lightweight click-to-open popup via portal              */
/* ------------------------------------------------------------------ */

function Popover({ trigger, children }: { trigger: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const close = useCallback(() => {
    setOpen(false)
  }, [])

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
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, close])

  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
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
            className="fixed bg-bg-secondary border border-border rounded-lg shadow-xl p-3 w-[320px] max-w-[calc(100vw-16px)] max-h-[60vh] overflow-y-auto"
            style={(() => {
              if (!triggerRef.current) return { zIndex: POPOVER_Z_INDEX, top: 0, left: 0 }
              const rect = triggerRef.current.getBoundingClientRect()
              const estWidth = 360
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
            {children}
          </div>,
          document.body,
        )}
    </>
  )
}

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
  const { branch, diff } = useGitStatus()
  const showEditorLink = useSettingsStore((s) => s.settings[SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR]) === 'true'
  if (!visible || !session) return null

  const workspaceName = session.workspace ? (session.workspace.split('/').pop() ?? 'original') : 'original'
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
      <div className="flex items-center justify-between text-sm">
        {/* ---- Workspace / Branch ---- */}
        <div className="flex items-center gap-1 min-w-0 shrink-0">
          <FolderIcon className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
          <span className="truncate text-text-secondary max-w-[80px]">{workspaceName}</span>
          <span className="text-text-muted">/</span>
          <BranchIcon className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
          <span className="truncate text-text-secondary max-w-[80px]">{branch ?? '-'}</span>
          {diffFiles.length > 0 ? (
            <span className="text-text-muted shrink-0 font-mono">
              +{totalAdditions} -{totalDeletions}
            </span>
          ) : (
            <span className="shrink-0" />
          )}
          <Popover trigger={<ChevronDownIcon className="w-3 h-3" />}>
            <WorkspaceBranchSection
              workspaceName={workspaceName}
              branch={branch}
              workdir={workdir}
              showEditorLink={showEditorLink}
              sessionId={session.id}
              projectId={session.projectId}
            />
          </Popover>
        </div>

        {/* ---- Divider ---- */}
        <div className="w-px bg-border self-stretch mx-1" />

        {/* ---- Metadata Status ---- */}
        <div className="flex-1 flex items-center justify-center gap-1 min-w-0">
          <MetadataStatusSummary entries={criteriaEntries} />
          {otherCount > 0 && (
            <span
              className="text-text-muted text-xs bg-bg-tertiary px-1 py-0.5 rounded leading-none"
              title={otherLabels.join(', ')}
            >
              +{otherCount}
            </span>
          )}
          <Popover trigger={<ChevronDownIcon className="w-3 h-3" />}>
            <div className="space-y-3">
              <div>
                <MetadataSectionHeader entries={criteriaEntries} title="Acceptance Criteria" />
                <CriteriaEditor entries={criteriaEntries} sessionId={session.id} />
              </div>
              {[...extraKeys, ...customKeys].map((key) => {
                const entries = allEntries[key]!
                return (
                  <div key={key}>
                    <MetadataSectionHeader entries={entries} title={formatMetadataKeyLabel(key)} />
                    <MetadataEntries entries={entries} />
                  </div>
                )
              })}
            </div>
          </Popover>
        </div>

        {/* ---- Divider ---- */}
        <div className="w-px bg-border self-stretch mx-1" />

        {/* ---- Dev Server ---- */}
        <div className="flex items-center gap-1.5 min-w-0 shrink-0">
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
                className="px-1.5 py-0.5 rounded text-xs font-medium bg-accent-primary/25 text-text-primary hover:bg-accent-primary/40 transition-colors leading-none"
              >
                Start
              </button>
            )
          ) : (
            <span className="text-text-muted text-xs">No config</span>
          )}

          <Popover trigger={<ChevronDownIcon className="w-3 h-3" />}>
            <DevServerFooter workdir={workdir} compact />
          </Popover>
        </div>
      </div>
    </div>
  )
}
