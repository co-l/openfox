import { memo, useState, type ComponentType } from 'react'
import { OptionalScrollArea } from './OptionalScrollArea'
import { useDisplaySettings } from '../../hooks/useDisplaySettings'
import type { Diagnostic, EditContextRegion } from '@shared/types.js'
import { ToolIcon } from './ToolIcon'
import { DiffView, FilePreview, EditContextView, ReadFileView } from './DiffView'
import { DescribeImageView } from './DescribeImageView'
import { DiagnosticsView } from './DiagnosticsView'
import { RunCommandView } from './RunCommandView'
import { Markdown } from './Markdown'
import { TruncatedIndicator } from './TruncatedIndicator'
import { DevServerView } from './DevServerView'
import { BackgroundProcessView } from './BackgroundProcessView'
import { WorkspaceView } from './WorkspaceView'
import { ProjectTasksView } from './ProjectTasksView'
import { PathConfirmationButtons } from './PathConfirmationButtons'
import { TruncatedTooltip } from './TruncatedTooltip'
import { formatToolArgsFull, formatToolArgsWithMetadata } from '../../lib/formatToolArgs'
import { type PendingPathConfirmation } from '../../stores/session'
import { useSessionScope, useScopedPaneState } from '../../stores/session/session-scope'
import { SETTINGS_KEYS } from '../../lib/resources'
import { useSetting } from '../../hooks/useSetting'
import { buildEditorUrl } from '../../lib/editor-link'
import { detectRemoteExecution } from '../../lib/remote-execution'
import type { ToolStatus } from '../../lib/toolStatus'
import { useT } from '../../hooks/useT'

interface StreamingChunk {
  stream: 'stdout' | 'stderr'
  content: string
}

// Stable fallback for the scoped selector — a fresh array per render makes
// useSyncExternalStore loop ("Maximum update depth exceeded").
const EMPTY_CONFIRMATIONS: PendingPathConfirmation[] = []

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

// Finished tool calls with content above this size start collapsed when the
// collapseLargeToolCalls performance setting is on — large read_file dumps or
// command outputs dominate the initial DOM otherwise.
const COLLAPSE_THRESHOLD = 600

function getContentSize(
  result: string | undefined,
  streamingOutput: StreamingChunk[] | undefined,
  args: Record<string, unknown>,
): number {
  let size = result?.length ?? 0
  if (streamingOutput) {
    for (const chunk of streamingOutput) size += chunk.content.length
  }
  const content = args['content']
  if (typeof content === 'string') size += content.length
  return size
}

// Views that parse a JSON result by action and share the same prop shape.
const RESULT_ACTION_VIEWS: Record<string, ComponentType<{ result: string; action: string }>> = {
  dev_server: DevServerView,
  workspace: WorkspaceView,
  project_tasks: ProjectTasksView,
  background_process: BackgroundProcessView,
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
    color: 'text-text-tool-error',
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
  const t = useT()
  // Expand by default for parity — a call seen streaming stays visible once it
  // finishes and a reload shows the same content. When the collapseLargeToolCalls
  // performance setting is on, large finished calls start collapsed (pending
  // calls still expand, so a live stream never collapses mid-run). `expanded`
  // is initialized once at mount; the component remounts when the tool call
  // identity changes, and forceCompact comes from a display setting stable
  // during the message's lifetime.
  const { collapseLargeToolCalls } = useDisplaySettings()
  const shouldAutoExpand =
    !forceCompact &&
    (!collapseLargeToolCalls ||
      status === 'pending' ||
      getContentSize(result, streamingOutput, args) < COLLAPSE_THRESHOLD)
  const [expanded, setExpanded] = useState(shouldAutoExpand)
  const config = statusConfig[status]
  const remoteProtocol = detectRemoteExecution(tool, args)
  const showEditorLink = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR).value === 'true'
  const vscodeRemotePrefix = useSetting(SETTINGS_KEYS.VSCODE_REMOTE_PREFIX).value
  const argsLabel = formatToolArgsWithMetadata(tool, args, metadata)

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

  // Check if there's a pending path confirmation matching this tool call.
  // Confirmations use composite callIds: `${toolCallId}-${seq}` so we match by prefix.
  // In split view confirmations live on the owning pane, not the flat focused
  // state — read them from the scoped pane so they appear instantly.
  const scopeId = useSessionScope()
  const pendingPathConfirmations = useScopedPaneState(
    scopeId,
    (pane) => pane.pendingPathConfirmations,
    (state) => state.pendingPathConfirmations,
    EMPTY_CONFIRMATIONS,
  )
  const pendingConfirmation: PendingPathConfirmation | null = callId
    ? (pendingPathConfirmations.find((pc) => pc.callId === callId || pc.callId.startsWith(callId + '-')) ?? null)
    : null
  // step_done is a simple completion signal — minimal inline pill, no collapsible, no args
  if (tool === 'step_done') {
    return (
      <div className="flex items-center gap-1.5 text-xs bg-secondary border border-border rounded px-2 py-1.5 my-1">
        <span className={`${config.color} ${config.animate ? 'animate-pulse' : ''}`}>{config.icon}</span>
        <span className="font-mono text-accent-primary text-sm">{tool}</span>
      </div>
    )
  }
  if (variant === 'compact') {
    return (
      <div
        className={`flex items-center gap-1.5 text-xs rounded px-2 py-1.5 border ${remoteProtocol ? 'border-text-thinking/60 bg-text-thinking/10' : 'border-transparent bg-secondary'}`}
      >
        <ToolIcon tool={tool} />
        <span className="text-accent-primary font-medium">{tool}</span>
        <TruncatedTooltip text={argsLabel} className="flex-1 text-text-muted" />
        <span className={`${config.color} ${config.animate ? 'animate-pulse' : ''}`}>
          {status === 'pending' ? '...' : t({ en: 'Done', fr: 'Terminé' })}
        </span>
      </div>
    )
  }

  return (
    <div
      className={`border rounded overflow-hidden my-1 min-w-0 ${remoteProtocol ? 'border-text-thinking/60 shadow-[0_0_0_1px_rgb(var(--color-text-thinking)_/_0.12)]' : 'border-border'}`}
    >
      <button
        className={`w-full flex items-center gap-1.5 p-2 text-left ${remoteProtocol ? 'bg-text-thinking/10 hover:bg-text-thinking/15' : 'bg-secondary hover:bg-secondary/80'}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`${config.color} ${config.animate ? 'animate-pulse' : ''}`}>{config.icon}</span>
        <span className="font-mono text-accent-primary text-sm">{tool}</span>
        <TruncatedTooltip text={argsLabel} className="flex-1 text-text-muted text-xs" />
        <span className="text-text-muted text-xs">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <div
          className={`p-2 border-t space-y-2 min-w-0 ${remoteProtocol ? 'border-text-thinking/40 bg-text-thinking/5' : 'border-border bg-primary'}`}
        >
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
            <ReadFileView result={result} metadata={metadata} filePath={String(args.path ?? '')} />
          )}

          {/* Specialized rendering for describe_image (non-vision models w/ vision fallback) */}
          {tool === 'describe_image' && (status === 'success' || status === 'pending') && (
            <DescribeImageView args={args} result={result} metadata={metadata} pending={status === 'pending'} />
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
                    {t({ en: 'Sub-Agent Summary', fr: 'Résumé du sous-agent' })}
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
                {String(args.subAgentType ?? t({ en: 'Sub-Agent', fr: 'Sous-agent' }))}{' '}
                {t({ en: 'Prompt', fr: 'Invite' })}
              </div>
              <OptionalScrollArea className="text-xs prose prose-invert prose-sm max-w-none max-h-[60vh]">
                <Markdown content={String(args.prompt ?? '')} />
              </OptionalScrollArea>
            </div>
          )}

          {/* Specialized rendering for web_search */}
          {tool === 'web_search' && status === 'success' && (
            <div>
              <OptionalScrollArea className="text-xs prose prose-invert prose-sm max-w-none max-h-[60vh]">
                <Markdown content={result ?? ''} />
              </OptionalScrollArea>
              {truncated && <TruncatedIndicator className="mt-1" />}
            </div>
          )}

          {/* Specialized rendering for load_skill */}
          {tool === 'load_skill' && status === 'success' && (
            <div>
              <div className="text-[10px] text-accent-primary font-medium mb-1 uppercase tracking-wide">
                {t({ en: 'Skill: {{skill}}', fr: 'Compétence : {{skill}}' }, { skill: String(args.skillId ?? '') })}
              </div>
              <OptionalScrollArea className="text-xs prose prose-invert prose-sm max-w-none max-h-[60vh]">
                <Markdown content={result ?? ''} />
              </OptionalScrollArea>
              {truncated && <TruncatedIndicator className="mt-1" />}
            </div>
          )}

          {/* Specialized rendering for web_fetch */}
          {tool === 'web_fetch' && status === 'success' && (
            <div className="space-y-2">
              {Boolean(metadata?.url) && (
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <span>{t({ en: 'Source:', fr: 'Source :' })}</span>
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
                    <span className="text-text-muted flex-shrink-0">
                      {t({ en: '· {{n}} pages', fr: '· {{n}} pages' }, { n: String(metadata!.pageCount) })}
                    </span>
                  )}
                </div>
              )}
              <OptionalScrollArea className="text-xs prose prose-invert prose-sm max-w-none max-h-[60vh]">
                <Markdown content={result ?? ''} />
              </OptionalScrollArea>
              {truncated && <TruncatedIndicator />}
            </div>
          )}

          {/* Specialized rendering for JSON-shaped action views */}
          {(() => {
            const View = RESULT_ACTION_VIEWS[tool]
            if (!View || status !== 'success' || !result) return null
            return <View result={result} action={String(args.action ?? '')} />
          })()}

          {/* Specialized rendering for mcp_config */}
          {tool === 'mcp_config' && status === 'success' && (
            <div>
              <OptionalScrollArea className="text-xs prose prose-invert prose-sm max-w-none max-h-[60vh]">
                <Markdown content={result ?? ''} />
              </OptionalScrollArea>
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
            tool !== 'describe_image' &&
            tool !== 'return_value' &&
            tool !== 'call_sub_agent' &&
            tool !== 'web_search' &&
            tool !== 'load_skill' &&
            tool !== 'web_fetch' &&
            tool !== 'dev_server' &&
            tool !== 'workspace' &&
            tool !== 'project_tasks' &&
            tool !== 'background_process' &&
            tool !== 'mcp_config' &&
            tool !== 'step_done' && (
              <>
                {/* Show arguments only if there are meaningful keys */}
                {Object.keys(args).length > 0 && (
                  <div>
                    <div className="text-[10px] text-text-muted mb-0.5">
                      {t({ en: 'Arguments:', fr: 'Arguments :' })}
                    </div>
                    <OptionalScrollArea horizontal>
                      <pre className="text-xs bg-bg-primary p-1.5 rounded break-words">{formatToolArgsFull(args)}</pre>
                    </OptionalScrollArea>
                  </div>
                )}

                {/* Show result for non-specialized operations */}
                {status === 'success' && result !== undefined && (
                  <div>
                    <div className="text-[10px] text-text-muted mb-0.5">
                      {durationMs !== undefined
                        ? t({ en: 'Result ({{ms}}ms):', fr: 'Résultat ({{ms}} ms) :' }, { ms: durationMs })
                        : t({ en: 'Result:', fr: 'Résultat :' })}
                    </div>
                    <OptionalScrollArea horizontal className="max-h-[60vh]">
                      <pre className="text-xs bg-bg-primary p-1.5 rounded break-words">
                        {result || t({ en: 'No output', fr: 'Aucune sortie' })}
                      </pre>
                    </OptionalScrollArea>
                    {truncated && <TruncatedIndicator className="mt-1" />}
                  </div>
                )}
              </>
            )}

          {/* Bottom metadata bar: duration + remote badge */}
          {(remoteProtocol ||
            (status === 'success' &&
              durationMs !== undefined &&
              (tool === 'run_command' ||
                tool === 'edit_file' ||
                tool === 'write_file' ||
                tool === 'read_file' ||
                tool === 'describe_image'))) && (
            <div className="text-[10px] text-text-muted flex items-center gap-2">
              {status === 'success' &&
                durationMs !== undefined &&
                (tool === 'run_command' ||
                  tool === 'edit_file' ||
                  tool === 'write_file' ||
                  tool === 'read_file' ||
                  tool === 'describe_image') && (
                  <span>
                    {t({ en: 'Completed in {{s}}s', fr: 'Terminé en {{s}} s' }, { s: (durationMs / 1000).toFixed(2) })}
                  </span>
                )}
              <span className="flex-1" />
              {showEditorLink &&
                (tool === 'read_file' || tool === 'write_file' || tool === 'edit_file') &&
                String(metadata?.path ?? args.path ?? '') && (
                  <a
                    href={buildEditorUrl(
                      String(metadata?.path ?? args.path),
                      editorLine,
                      undefined,
                      vscodeRemotePrefix,
                    )}
                    className="text-accent-primary hover:underline"
                  >
                    {t({ en: 'Open in VSCode', fr: 'Ouvrir dans VSCode' })}
                  </a>
                )}
              {remoteProtocol && (
                <span className="shrink-0 rounded border border-text-thinking/50 bg-text-thinking/15 px-1.5 py-0.5 font-semibold tracking-wide text-text-thinking">
                  {t({ en: 'REMOTE · {{protocol}}', fr: 'DISTANT · {{protocol}}' }, { protocol: remoteProtocol })}
                </span>
              )}
            </div>
          )}

          {/* Error display for non-run_command (run_command handles its own errors) */}
          {status === 'error' && error && tool !== 'run_command' && (
            <div>
              <div className="text-[10px] text-accent-error mb-0.5">{t({ en: 'Error:', fr: 'Erreur :' })}</div>
              <pre className="text-xs bg-bg-primary p-1.5 rounded text-accent-error break-words">{error}</pre>
            </div>
          )}

          {/* Inline path confirmation for pending tools */}
          {pendingConfirmation && <PathConfirmationButtons confirmation={pendingConfirmation} />}
        </div>
      )}
    </div>
  )
})
