import { useSessionStore } from '../../stores/session'
import { WarningIcon } from './icons'

export function ConnectionStatusBar() {
  const connectionStatus = useSessionStore((state) => state.connectionStatus)
  const reconnect = useSessionStore((state) => state.reconnect)

  if (connectionStatus === 'connected') {
    return null
  }

  const isReconnecting = connectionStatus === 'reconnecting'

  return (
    <div
      className={`
        flex items-center justify-between px-4 py-2 
        text-sm font-medium
        ${
          isReconnecting
            ? 'bg-amber-500/15 border-b border-amber-500/30 text-amber-300'
            : 'bg-red-500/15 border-b border-red-500/30 text-red-300'
        }
      `}
    >
      <div className="flex items-center gap-2">
        {isReconnecting ? (
          <>
            <span className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span
                className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"
                style={{ animationDelay: '150ms' }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"
                style={{ animationDelay: '300ms' }}
              />
            </span>
            <span>Reconnecting to server...</span>
          </>
        ) : (
          <>
            <WarningIcon />
            <span>Connection lost</span>
          </>
        )}
      </div>
      <button
        onClick={() => reconnect()}
        disabled={isReconnecting}
        className={`
          px-3 py-1 rounded text-xs font-medium
          transition-colors
          ${
            isReconnecting
              ? 'bg-amber-500/20 text-amber-400 cursor-not-allowed opacity-50'
              : 'bg-red-500/20 text-red-300 hover:bg-red-500/30 hover:text-red-200'
          }
        `}
      >
        {isReconnecting ? 'Reconnecting...' : 'Reconnect'}
      </button>
    </div>
  )
}
