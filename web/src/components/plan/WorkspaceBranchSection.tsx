import { useState } from 'react'
import { FolderIcon, BranchIcon } from '../shared/icons'
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
}

export function WorkspaceBranchSection({
  workspaceName,
  branch,
  workdir,
  showEditorLink,
  sessionId,
  projectId,
}: WorkspaceBranchSectionProps) {
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
              title="Open workspace in VSCode"
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
            onClick={() => setShowWorkspaceModal(true)}
            className="ml-auto px-2 py-0.5 text-xs rounded bg-bg-tertiary text-text-secondary hover:bg-bg-secondary transition-colors"
          >
            Edit
          </button>
        </div>
        <div className="h-px bg-border" />
        <div className="flex items-center gap-2 text-sm">
          <BranchIcon />
          <span className="truncate text-text-secondary">{branch}</span>
          <button
            onClick={() => setShowBranchModal(true)}
            className="ml-auto px-2 py-0.5 text-xs rounded bg-bg-tertiary text-text-secondary hover:bg-bg-secondary transition-colors"
          >
            Edit
          </button>
        </div>
      </div>

      <DiffViewer />

      <WorkspaceModal
        isOpen={showWorkspaceModal}
        onClose={() => setShowWorkspaceModal(false)}
        projectId={projectId}
        sessionId={sessionId}
        currentWorkspace={workspaceName}
        currentBranch={branch}
      />
      <BranchModal isOpen={showBranchModal} onClose={() => setShowBranchModal(false)} sessionId={sessionId} />
    </>
  )
}
