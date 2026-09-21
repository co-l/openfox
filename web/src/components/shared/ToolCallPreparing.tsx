import { memo, useDeferredValue, useMemo } from 'react'
import type { EditContextRegion } from '@shared/types.js'
import { ToolIcon } from './ToolIcon'
import { formatMetadataKeyLabelLower } from '../../lib/metadata-keys'
import { detectRemoteCommand } from '../../lib/remote-execution'
import { parsePartialFileArgs } from '@shared/partial-tool-args.js'
import { FilePreview, DiffView, EditContextView } from './DiffView'
import { SETTINGS_KEYS } from '../../lib/resources'
import { useSetting } from '../../hooks/useSetting'

interface ToolCallPreparingProps {
  name: string
  arguments?: string
  /** Live edit context (surrounding lines) for a streaming edit_file call. */
  editContext?: EditContextRegion[]
  /** When true (expanded tool output is off), keep the header-only card. */
  forceCompact?: boolean
}

// Tool-specific descriptions for better UX
const toolDescriptions: Record<string, string> = {
  read_file: 'Reading file',
  write_file: 'Writing file',
  edit_file: 'Editing file',
  run_command: 'Running command',
  glob: 'Searching files',
  grep: 'Searching content',
  ask_user: 'Asking user',
  criterion: 'Managing criterion',
  session_metadata: 'Managing',
  todo_write: 'Updating tasks',
}

function getToolDescription(name: string, args?: string): string {
  const base = toolDescriptions[name]
  if (!base) return `Preparing ${name}`
  if (name === 'session_metadata' && args) {
    try {
      const parsed = JSON.parse(args)
      const key = parsed.key as string | undefined
      if (key) {
        const label = formatMetadataKeyLabelLower(key)
        return `${base} ${label}`
      }
    } catch {
      // ignore parse errors
    }
  }
  return base
}

function extractCommandFromArgs(args: string): string | null {
  try {
    const cleaned = args.replace(/\s*\}\s*$/, '')
    const parsed = JSON.parse(cleaned)
    if (typeof parsed.command === 'string') return parsed.command
  } catch {
    const match = args.match(/"command"\s*:\s*"([^"]*)/)
    if (match && match[1]) return match[1]
  }
  return null
}

export const ToolCallPreparing = memo(function ToolCallPreparing({
  name,
  arguments: args,
  editContext,
  forceCompact,
}: ToolCallPreparingProps) {
  const description = getToolDescription(name, args)
  const showToolCallStreaming = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_TOOL_CALL_STREAMING, 'false')

  let detailText = description + '...'
  let remoteProtocol = null
  if (name === 'run_command' && args) {
    const command = extractCommandFromArgs(args)
    if (command) {
      detailText = command
      remoteProtocol = detectRemoteCommand(command)
    }
  }

  // Live preview of the final content component while the LLM is still
  // streaming the file tool's JSON — same shape as the finished call. The
  // preview renders from a deferred copy of the args so a fast stream of
  // deltas doesn't re-highlight the whole growing file on every chunk.
  const deferredArgs = useDeferredValue(args)
  const parsedFileArgs = useMemo(() => {
    if (forceCompact || showToolCallStreaming.value !== 'true') return null
    if (name !== 'write_file' && name !== 'edit_file') return null
    return parsePartialFileArgs(deferredArgs)
  }, [forceCompact, showToolCallStreaming.value, name, deferredArgs])

  const livePreview = useMemo(() => {
    if (!parsedFileArgs) return null
    if (name === 'write_file' && parsedFileArgs.content !== undefined) {
      return <FilePreview content={parsedFileArgs.content} filePath={parsedFileArgs.path} streaming />
    }
    if (name === 'edit_file' && editContext && editContext.length > 0) {
      return <EditContextView regions={editContext} filePath={parsedFileArgs.path} />
    }
    if (name === 'edit_file' && (parsedFileArgs.old_string !== undefined || parsedFileArgs.new_string !== undefined)) {
      return (
        <DiffView
          oldString={parsedFileArgs.old_string ?? ''}
          newString={parsedFileArgs.new_string ?? ''}
          filePath={parsedFileArgs.path}
        />
      )
    }
    return null
  }, [parsedFileArgs, name, editContext])

  const parsedPath = parsedFileArgs?.path
  if (livePreview && parsedPath) {
    detailText = parsedPath
  }

  return (
    <div
      className={`border rounded overflow-hidden my-1 min-w-0 ${remoteProtocol ? 'border-text-thinking/60 shadow-[0_0_0_1px_rgb(var(--color-text-thinking)_/_0.12)]' : 'border-border'}`}
    >
      <div
        className={`flex items-center gap-1.5 p-2 ${livePreview ? 'border-b border-border' : ''} ${remoteProtocol ? 'bg-text-thinking/10' : 'bg-bg-tertiary'}`}
      >
        <span className="text-accent-warning animate-pulse">...</span>
        <ToolIcon tool={name} />
        <span className="font-mono text-accent-primary text-sm">{name}</span>
        {name === 'run_command' && args ? (
          <code className="text-text-muted text-xs flex-1 truncate">{detailText}</code>
        ) : (
          <span className="text-text-muted text-xs flex-1 truncate">{detailText}</span>
        )}
      </div>
      {livePreview && <div className="p-2 space-y-2 min-w-0 bg-primary">{livePreview}</div>}
    </div>
  )
})
