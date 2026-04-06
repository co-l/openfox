import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { useTerminalStore } from '../../stores/terminal'
import { wsClient } from '../../lib/ws'

interface TerminalPaneProps {
  sessionId: string
  onClose: () => void
}

export function TerminalPane({ sessionId, onClose }: TerminalPaneProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const sessionIdRef = useRef(sessionId)
  const termRef = useRef<any>(null)

  const writeSession = useTerminalStore(state => state.writeSession)

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    if (!terminalRef.current) return

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      theme: {
        background: '#1a1a1a',
        foreground: '#e0e0e0',
        cursor: '#ffffff',
        cursorAccent: '#1a1a1a',
      },
      cursorBlink: true,
      cursorStyle: 'bar',
    })

    termRef.current = term
    term.open(terminalRef.current)

    term.onData((data) => {
      writeSession(sessionIdRef.current, data)
    })

    const unsubscribe = wsClient.subscribe((msg: any) => {
      if (msg.type === 'terminal.output' && msg.payload?.sessionId === sessionIdRef.current) {
        const data = msg.payload?.data
        if (data) {
          term.write(data)
        }
      }
    })

    return () => {
      unsubscribe()
      term.dispose()
      termRef.current = null
    }
  }, [sessionId, writeSession])

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a]">
      <div className="flex-shrink-0 flex items-center justify-between px-2 py-1 bg-[#252525] border-b border-[#333]">
        <div />
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[#333] text-[#888] hover:text-[#ccc] transition-colors"
          title="Close terminal"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.55.5 0 0 1 0-.708z"/>
          </svg>
        </button>
      </div>
      <div ref={terminalRef} className="flex-1 p-2" style={{ boxSizing: 'border-box' }} />
    </div>
  )
}