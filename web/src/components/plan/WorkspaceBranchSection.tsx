import { useState } from 'react'
import { FolderIcon, BranchIcon } from '../shared/icons'
import { useT } from '../../hooks/useT'
import { DiffViewer } from './DiffViewer'
import { WorkspaceModal } from './WorkspaceModal'
import { BranchModal } from './BranchModal'
import { buildWorkspaceUrl } from '../../lib/editor-link'

interface WorkspaceBranchSectionProps {
  workspaceName: string
  branch: string | null
  workdir: string | undefined
  showEditorLink: boolean
  sessionId: string
  projectId: string
  onEditWorkspace?: () => void
  onEditBranch?: () => void
}

export function WorkspaceBranchSection({
  workspaceName,
  branch,
  workdir,
  showEditorLink,
  sessionId,
  projectId,
  onEditWorkspace,
  onEditBranch,
}: WorkspaceBranchSectionProps) {
  const t = useT()
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false)
  const [showBranchModal, setShowBranchModal] = useState(false)

  if (branch === null) return null

  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-sm">
          {showEditorLink && workdir ? (
            <a
              href={buildWorkspaceUrl(workdir)}
              className="flex items-center gap-2 min-w-0 flex-1 no-underline group"
              title={t({ en: 'Open workspace in VSCode', fr: 'Ouvrir l’espace de travail dans VSCode' })}
            >
              <FolderIcon className="w-4 h-4 text-text-muted flex-shrink-0" />
              <span className="truncate text-text-secondary group-hover:text-accent-primary transition-colors">
                {workspaceName}
              </span>
            </a>
          ) : (
            <>
              <FolderIcon className="w-4 h-4 text-text-muted flex-shrink-0" />
              <span className="truncate text-text-secondary">{workspaceName}</span>
            </>
          )}
          <button
            onClick={() => {
              if (onEditWorkspace) onEditWorkspace()
              else setShowWorkspaceModal(true)
            }}
            className="ml-auto px-2 py-0.5 text-xs rounded bg-bg-tertiary text-text-secondary hover:bg-bg-secondary transition-colors"
          >
            {t({ en: 'Edit', fr: 'Modifier' })}
          </button>
        </div>
        <div className="h-px bg-border" />
        <div className="flex items-center gap-2 text-sm">
          <BranchIcon />
          <span className="truncate text-text-secondary">{branch}</span>
          <button
            onClick={() => {
              if (onEditBranch) onEditBranch()
              else setShowBranchModal(true)
            }}
            className="ml-auto px-2 py-0.5 text-xs rounded bg-bg-tertiary text-text-secondary hover:bg-bg-secondary transition-colors"
          >
            {t({ en: 'Edit', fr: 'Modifier' })}
          </button>
        </div>
      </div>

      <DiffViewer />

      {!onEditWorkspace && (
        <WorkspaceModal
          isOpen={showWorkspaceModal}
          onClose={() => setShowWorkspaceModal(false)}
          projectId={projectId}
          sessionId={sessionId}
          currentWorkspace={workspaceName}
          currentBranch={branch}
        />
      )}
      {!onEditBranch && (
        <BranchModal isOpen={showBranchModal} onClose={() => setShowBranchModal(false)} sessionId={sessionId} />
      )}
    </>
  )
}
