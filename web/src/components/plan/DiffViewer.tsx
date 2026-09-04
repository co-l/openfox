import { ScrollArea } from '../shared/ScrollArea'
import { useGitStatus } from '../../hooks/useGitStatus'
import { useT } from '../../hooks/useT'
import { useScopedContext } from '../../stores/session/session-scope'
import { SETTINGS_KEYS } from '../../lib/resources'
import { useSetting } from '../../hooks/useSetting'
import { buildEditorUrl } from '../../lib/editor-link'
import { truncateMiddle } from '../../lib/path'

interface GitDiffFile {
  path: string
  status: 'modified' | 'added' | 'deleted'
  additions: number
  deletions: number
}

interface DiffRowProps {
  file: GitDiffFile
  showEditorLink: boolean
  workdir: string | undefined
  remotePrefix: string
}

function DiffRow({ file, showEditorLink, workdir, remotePrefix }: DiffRowProps) {
  const t = useT()
  const displayPath = truncateMiddle(file.path, 28)

  const textColor =
    file.status === 'added'
      ? 'text-accent-success'
      : file.status === 'deleted'
        ? 'text-accent-error'
        : 'text-accent-primary'

  const stats =
    file.status === 'added'
      ? `+${file.additions}`
      : file.status === 'deleted'
        ? `-${file.deletions}`
        : file.additions > 0 || file.deletions > 0
          ? `+${file.additions}, -${file.deletions}`
          : ''

  const href = showEditorLink && workdir ? buildEditorUrl(file.path, undefined, workdir, remotePrefix) : undefined

  const content = (
    <>
      <span className={`truncate ${textColor}`} title={file.path}>
        {displayPath}
      </span>
      {stats && (
        <span
          className={`shrink-0 font-mono${file.status === 'added' ? ' text-accent-success' : file.status === 'deleted' ? ' text-accent-error' : ' text-text-muted'}`}
        >
          {stats}
        </span>
      )}
    </>
  )

  if (href) {
    return (
      <a
        href={href}
        className="flex items-center justify-between gap-1 py-0.5 text-xs min-w-0 hover:bg-bg-tertiary rounded px-1 transition-colors no-underline"
        title={t({ en: 'Open {{path}} in VSCode', fr: 'Ouvrir {{path}} dans VSCode' }, { path: file.path })}
      >
        {content}
      </a>
    )
  }

  return <div className="flex items-center justify-between gap-1 py-0.5 text-xs min-w-0">{content}</div>
}

export function DiffViewer() {
  const t = useT()
  const { diff } = useGitStatus()
  const showEditorLink = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR).value === 'true'
  const remotePrefix = useSetting(SETTINGS_KEYS.VSCODE_REMOTE_PREFIX).value
  const { currentSession: session } = useScopedContext()
  const workdir = session?.workspace ?? session?.workdir

  if (diff.loading) {
    return (
      <div className="mt-3">
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="w-3 h-3 border border-border border-t-accent-primary rounded-full animate-spin" />
          <span>{t({ en: 'Checking changes...', fr: 'Vérification des changements…' })}</span>
        </div>
      </div>
    )
  }

  if (diff.files.length === 0) {
    return (
      <div className="mt-3">
        <p className="text-xs text-text-muted text-center">{t({ en: 'No changes', fr: 'Aucun changement' })}</p>
      </div>
    )
  }

  return (
    <ScrollArea className="mt-3 max-h-[150px]">
      <div className="pr-1">
        {diff.files.map((file, i) => (
          <DiffRow key={i} file={file} showEditorLink={showEditorLink} workdir={workdir} remotePrefix={remotePrefix} />
        ))}
      </div>
    </ScrollArea>
  )
}
