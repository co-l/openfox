import { memo, useState } from 'react'
import type { Diagnostic, EditContextRegion } from '@shared/types.js'
import { ToolIcon } from './ToolIcon'
import { DiffView, FilePreview, EditContextView, ReadFileView } from './DiffView'
import { DiagnosticsView } from './DiagnosticsView'
import { RunCommandView } from './RunCommandView'
import { Markdown } from './Markdown'
import { TruncatedIndicator } from './TruncatedIndicator'
import { DevServerView } from './DevServerView'
import { BackgroundProcessView } from './BackgroundProcessView'
import { WorktreeView } from './WorktreeView'
import { PathConfirmationButtons } from './PathConfirmationButtons'
import { formatToolArgsFull, formatToolArgsWithMetadata } from '../../lib/formatToolArgs'
import { useSessionStore, type PendingPathConfirmation } from '../../stores/session'
import { useSettingsStore, SETTINGS_KEYS } from '../../stores/settings'

type ToolStatus = 'pending' | 'success' | 'error' | 'interrupted'

interface StreamingChunk {
  stream: 'stdout' | 'stderr'
  content: string
}

interface ToolCallDisplayProps {
  tool: string
  args: Record<string, unknown>
  status: ToolStatus
  variant?: 'compact' | 'expandable'
  forceCompact?: boolean // When true, renders compact variant even if expandable
  // For expandable variant
  result?: string
  error?: string
  durationMs?: number
  diagnostics?: Diagnostic[] // LSP diagnostics for file operations
  editContext?: { regions: EditContextRegion[] } // Edit context with line numbers
  // For run_command streaming
  startedAt?: number // Timestamp when tool started
  streamingOutput?: StreamingChunk[] // Real-time output chunks
  // For enhanced display with metadata
  metadata?: Record<string, unknown> // Tool-specific metadata
  truncated?: boolean // Whether the result was truncated
  // For path confirmation matching
  callId?: string
}

const statusConfig = {
  pending: {
    icon: '●',
    color: 'text-accent-warning',
    animate: true,
  },
  success: {
    icon: '✓',
    color: 'text-accent-success',
    animate: false,
  },
  error: {
    icon: '✗',
    color: 'text-accent-error',
    animate: false,
  },
  interrupted: {
    icon: '✗',
    color: 'text-red-400',
    animate: false,
  },
}

export const ToolCallDisplay = memo(function ToolCallDisplay({
  tool,
  args,
  status,
  variant = 'compact',
  forceCompact,
  result,
  error,
  durationMs,
  diagnostics,
  editContext,
  startedAt,
  streamingOutput,
  metadata,
  truncated,
  callId,
}: ToolCallDisplayProps) {
  // Auto-expand file operations and running commands so content is immediately visible
  const shouldAutoExpand = !forceCompact
  const [expanded, setExpanded] = useState(shouldAutoExpand)
  const config = statusConfig[status]
  const showEditorLink = useSettingsStore((s) => s.settings[SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR]) === 'true'

  const editorLine =
    tool === 'edit_file'
      ? editContext?.regions[0]?.startLine
      : tool === 'read_file'
        ? (() => {
            const firstLine = result?.split('\n')[0]
            const m = firstLine?.match(/^(\d+): /)
            return m ? parseInt(m[1]!, 10) : undefined
          })()
        : undefined

  // Check if there's a pending path confirmation matching this tool call
  const pendingPathConfirmations = useSessionStore((state) => state.pendingPathConfirmations)
  const pendingConfirmation: PendingPathConfirmation | null =
    status === 'pending' && callId ? (pendingPathConfirmations.find((pc) => pc.callId === callId) ?? null) : null
  // step_done is a simple completion signal — minimal inline pill, no collapsible, no args
  if (tool === 'step_done') {
    return (
      <div className="flex items-center gap-1.5 text-xs bg-secondary rounded px-2 py-1.5">
        <span className={`${config.color} ${config.animate ? 'animate-pulse' : ''}`}>{config.icon}</span>
        <span className="font-mono text-accent-primary text-sm">{tool}</span>
      </div>
    )
  }
  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-1.5 text-xs bg-secondary rounded px-2 py-1.5">
        <ToolIcon tool={tool} />
        <span className="text-accent-primary font-medium">{tool}</span>
        <span className="text-text-muted truncate flex-1">{formatToolArgsWithMetadata(tool, args, metadata)}</span>
        <span className={`${config.color} ${config.animate ? 'animate-pulse' : ''}`}>
          {status === 'pending' ? '...' : 'done'}
        </span>
      </div>
    )
  }

  return (
    <div className="border border-border rounded overflow-hidden my-1 min-w-0">
      <button
        className="w-full flex items-center gap-1.5 p-2 bg-secondary hover:bg-secondary/80 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`${config.color} ${config.animate ? 'animate-pulse' : ''}`}>{config.icon}</span>
        <span className="font-mono text-accent-primary text-sm">{tool}</span>
        <span className="text-text-muted text-xs flex-1 truncate">
          {formatToolArgsWithMetadata(tool, args, metadata)}
        </span>
        <span className="text-text-muted text-xs">{expanded ? '▼' : '▶'}</span>
      </button>

      {/* Inline path confirmation for pending tools */}
      {pendingConfirmation && <PathConfirmationButtons confirmation={pendingConfirmation} />}

      {expanded && (
        <div className="p-2 bg-primary border-t border-border space-y-2 min-w-0">
          {/* Specialized rendering for run_command with streaming output */}
          {tool === 'run_command' && (
            <RunCommandView
              command={String(args.command ?? '')}
              timeout={(args.timeout as number | undefined) ?? 120_000}
              startedAt={startedAt}
              streamingOutput={streamingOutput}
              status={status}
              result={result}
              error={error}
              durationMs={durationMs}
            />
          )}

          {/* Specialized rendering for file edit operations */}
          {tool === 'edit_file' && status === 'success' && (
            <>
              {editContext && editContext.regions.length > 0 ? (
                <EditContextView regions={editContext.regions} filePath={String(args.path ?? '')} />
              ) : (
                <DiffView
                  oldString={String(args.old_string ?? '')}
                  newString={String(args.new_string ?? '')}
                  filePath={String(args.path ?? '')}
                />
              )}
              {diagnostics && diagnostics.length > 0 && <DiagnosticsView diagnostics={diagnostics} />}
            </>
          )}

          {/* Specialized rendering for file write operations */}
          {tool === 'write_file' && status === 'success' && (
            <>
              <FilePreview content={String(args.content ?? '')} filePath={String(args.path ?? '')} />
              {diagnostics && diagnostics.length > 0 && <DiagnosticsView diagnostics={diagnostics} />}
            </>
          )}

          {/* Specialized rendering for read_file operations */}
          {tool === 'read_file' && status === 'success' && (
            <ReadFileView
              result={result}
              metadata={metadata}
              filePath={String(args.path ?? '')}
              heightExpanded={expanded}
            />
          )}

          {/* Specialized rendering for return_value */}
          {tool === 'return_value' &&
            (() => {
              // During streaming, show accumulated streaming output; when done, show final args
              const streamedContent = streamingOutput?.map((c) => c.content).join('') ?? ''
              const displayContent =
                status === 'pending' && streamedContent ? streamedContent : String(args.content ?? '')
              return (
                <div>
                  <div className="text-[10px] text-accent-primary font-medium mb-1 uppercase tracking-wide">
                    Sub-Agent Summary
                  </div>
                  <div className="text-xs prose prose-invert prose-sm max-w-none">
                    <Markdown content={displayContent} />
                  </div>
                </div>
              )
            })()}

          {/* Specialized rendering for call_sub_agent: show the prompt, not the response */}
          {tool === 'call_sub_agent' && (
            <div>
              <div className="text-[10px] text-accent-primary font-medium mb-1 uppercase tracking-wide">
                {String(args.subAgentType ?? 'Sub-Agent')} Prompt
              </div>
              <div className="text-xs prose prose-invert prose-sm max-w-none max-h-[60vh] overflow-y-auto">
                <Markdown content={String(args.prompt ?? '')} />
              </div>
            </div>
          )}

          {/* Specialized rendering for web_search */}
          {tool === 'web_search' && status === 'success' && (
            <div>
              <div className="text-xs prose prose-invert prose-sm max-w-none max-h-[60vh] overflow-y-auto">
                <Markdown content={result ?? ''} />
              </div>
              {truncated && <TruncatedIndicator className="mt-1" />}
            </div>
          )}

          {/* Specialized rendering for load_skill */}
          {tool === 'load_skill' && status === 'success' && (
            <div>
              <div className="text-[10px] text-accent-primary font-medium mb-1 uppercase tracking-wide">
                Skill: {String(args.skillId ?? '')}
              </div>
              <div className="text-xs prose prose-invert prose-sm max-w-none max-h-[60vh] overflow-y-auto">
                <Markdown content={result ?? ''} />
              </div>
              {truncated && <TruncatedIndicator className="mt-1" />}
            </div>
          )}

          {/* Specialized rendering for web_fetch */}
          {tool === 'web_fetch' && status === 'success' && (
            <div className="space-y-2">
              {Boolean(metadata?.url) && (
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <span>Source:</span>
                  <a
                    href={String(metadata!.url)}
                    className="text-accent-primary hover:underline truncate"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {String(metadata!.url)}
                  </a>
                  {Boolean(metadata?.contentType) && (
                    <span className="text-text-muted flex-shrink-0">({String(metadata!.contentType)})</span>
                  )}
                  {metadata?.pageCount != null && (
                    <span className="text-text-muted flex-shrink-0">· {String(metadata!.pageCount)} pages</span>
                  )}
                </div>
              )}
              <div className="text-xs prose prose-invert prose-sm max-w-none max-h-[60vh] overflow-y-auto">
                <Markdown content={result ?? ''} />
              </div>
              {truncated && <TruncatedIndicator />}
            </div>
          )}

          {/* Specialized rendering for dev_server */}
          {tool === 'dev_server' && status === 'success' && result && (
            <DevServerView result={result} action={String(args.action ?? '')} />
          )}

          {/* Specialized rendering for worktree */}
          {tool === 'worktree' && status === 'success' && result && (
            <WorktreeView result={result} action={String(args.action ?? '')} />
          )}

          {/* Specialized rendering for background_process */}
          {tool === 'background_process' && status === 'success' && result && (
            <BackgroundProcessView result={result} action={String(args.action ?? '')} />
          )}

          {/* Specialized rendering for mcp_config */}
          {tool === 'mcp_config' && status === 'success' && (
            <div>
              <div className="text-xs prose prose-invert prose-sm max-w-none max-h-[60vh] overflow-y-auto">
                <Markdown content={result ?? ''} />
              </div>
              {truncated && <TruncatedIndicator className="mt-1" />}
            </div>
          )}

          {/* step_done: just the header label is enough, no extra content needed */}
          {tool === 'step_done' && null}

          {/* Generic fallback for tools without specialized rendering */}
          {tool !== 'edit_file' &&
            tool !== 'write_file' &&
            tool !== 'run_command' &&
            tool !== 'read_file' &&
            tool !== 'return_value' &&
            tool !== 'call_sub_agent' &&
            tool !== 'web_search' &&
            tool !== 'load_skill' &&
            tool !== 'web_fetch' &&
            tool !== 'dev_server' &&
            tool !== 'worktree' &&
            tool !== 'background_process' &&
            tool !== 'mcp_config' &&
            tool !== 'step_done' && (
              <>
                {/* Show arguments only if there are meaningful keys */}
                {Object.keys(args).length > 0 && (
                  <div>
                    <div className="text-[10px] text-text-muted mb-0.5">Arguments:</div>
                    <pre className="text-xs bg-bg-primary p-1.5 rounded overflow-x-auto break-words">
                      {formatToolArgsFull(args)}
                    </pre>
                  </div>
                )}

                {/* Show result for non-specialized operations */}
                {status === 'success' && result !== undefined && (
                  <div>
                    <div className="text-[10px] text-text-muted mb-0.5">
                      Result{durationMs !== undefined && ` (${durationMs}ms)`}:
                    </div>
                    <pre className="text-xs bg-bg-primary p-1.5 rounded overflow-x-auto max-h-[60vh] break-words">
                      {result || 'No output'}
                    </pre>
                    {truncated && <TruncatedIndicator className="mt-1" />}
                  </div>
                )}
              </>
            )}

          {/* Duration badge for file operations */}
          {status === 'success' &&
            (tool === 'edit_file' || tool === 'write_file' || tool === 'read_file') &&
            durationMs !== undefined && (
              <div className="text-[10px] text-text-muted flex items-center gap-2">
                <span>Completed in {durationMs}ms</span>
                {showEditorLink &&
                  (tool === 'read_file' || tool === 'write_file' || tool === 'edit_file') &&
                  String(metadata?.path ?? args.path ?? '') && (
                    <a
                      href={`vscode://file/${String(metadata?.path ?? args.path)}${editorLine ? `:${editorLine}` : ''}`}
                      className="text-accent-primary hover:underline ml-auto"
                    >
                      Open in VSCode
                    </a>
                  )}
              </div>
            )}

          {/* Error display for non-run_command (run_command handles its own errors) */}
          {status === 'error' && error && tool !== 'run_command' && (
            <div>
              <div className="text-[10px] text-accent-error mb-0.5">Error:</div>
              <pre className="text-xs bg-bg-primary p-1.5 rounded text-accent-error break-words">{error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
})
