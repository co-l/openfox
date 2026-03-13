import { useState } from 'react'

interface PlanToolEvent {
  type: 'call' | 'result'
  tool: string
  args?: Record<string, unknown>
  result?: string
}

interface PlanToolCallsProps {
  events: PlanToolEvent[]
}

export function PlanToolCalls({ events }: PlanToolCallsProps) {
  // Group events into call/result pairs
  const toolCalls: Array<{
    tool: string
    args?: Record<string, unknown>
    result?: string
    pending: boolean
  }> = []
  
  for (const event of events) {
    if (event.type === 'call') {
      toolCalls.push({
        tool: event.tool,
        args: event.args,
        pending: true,
      })
    } else if (event.type === 'result') {
      // Find matching pending call
      const pendingCall = toolCalls.find(
        c => c.tool === event.tool && c.pending
      )
      if (pendingCall) {
        pendingCall.result = event.result
        pendingCall.pending = false
      }
    }
  }
  
  return (
    <div className="my-2 space-y-2">
      {toolCalls.map((call, idx) => (
        <ToolCallItem key={idx} call={call} />
      ))}
    </div>
  )
}

interface ToolCallItemProps {
  call: {
    tool: string
    args?: Record<string, unknown>
    result?: string
    pending: boolean
  }
}

function ToolCallItem({ call }: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(false)
  
  const toolIcon = getToolIcon(call.tool)
  const summary = getToolSummary(call.tool, call.args)
  
  return (
    <div className="bg-bg-tertiary/50 border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-tertiary/70 transition-colors"
      >
        <span className="text-accent-secondary">{toolIcon}</span>
        <span className="text-text-secondary text-sm font-medium">{call.tool}</span>
        <span className="text-text-muted text-sm flex-1 truncate">{summary}</span>
        {call.pending ? (
          <span className="w-4 h-4 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
        ) : (
          <span className="text-green-500 text-sm">done</span>
        )}
        <span className="text-text-muted">{expanded ? '−' : '+'}</span>
      </button>
      
      {expanded && (
        <div className="px-3 py-2 border-t border-border bg-bg-primary/50">
          {call.args && (
            <div className="mb-2">
              <div className="text-text-muted text-xs mb-1">Arguments:</div>
              <pre className="text-text-secondary text-xs whitespace-pre-wrap overflow-x-auto">
                {JSON.stringify(call.args, null, 2)}
              </pre>
            </div>
          )}
          {call.result && (
            <div>
              <div className="text-text-muted text-xs mb-1">Result:</div>
              <pre className="text-text-secondary text-xs whitespace-pre-wrap overflow-x-auto max-h-48">
                {call.result.slice(0, 2000)}
                {call.result.length > 2000 && '\n...truncated...'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function getToolIcon(tool: string): string {
  switch (tool) {
    case 'read_file':
      return '📄'
    case 'glob':
      return '🔍'
    case 'grep':
      return '🔎'
    default:
      return '🔧'
  }
}

function getToolSummary(tool: string, args?: Record<string, unknown>): string {
  if (!args) return ''
  
  switch (tool) {
    case 'read_file':
      return String(args.path || '')
    case 'glob':
      return String(args.pattern || '')
    case 'grep':
      return `"${args.pattern}" in ${args.include || '*'}`
    default:
      return ''
  }
}
