import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useTerminalStore } from '../../stores/terminal'
import { wsClient } from '../../lib/ws'
import { XCloseSmallIcon } from '../shared/icons'

interface TerminalPaneProps {
  sessionId: string
  onClose: () => void
  onEscape?: () => void
  autoFocus?: boolean
}

export function TerminalPane({ sessionId, onClose, onEscape, autoFocus }: TerminalPaneProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const sessionIdRef = useRef(sessionId)
  const termRef = useRef<any>(null)
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const writeSession = useTerminalStore(state => state.writeSession)
  const resizeSession = useTerminalStore(state => state.resizeSession)

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    if (!onEscape) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onEscape()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onEscape])

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
      convertEol: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    termRef.current = { term, fitAddon }

    terminalRef.current.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onEscape) {
        e.preventDefault()
        e.stopPropagation()
        onEscape()
      }
    })

    term.open(terminalRef.current)
    const terminalElement = terminalRef.current.querySelector('.xterm') as HTMLElement | null
    if (terminalElement) {
      terminalElement.style.padding = '8px'
    }
    fitAddon.fit()

    if (autoFocus) {
      setTimeout(() => {
        term.focus()
      }, 150)
    }

    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      resizeTimeoutRef.current = setTimeout(() => {
        requestAnimationFrame(() => {
          if (fitAddon.fit) {
            fitAddon.fit()
          }
          const termInstance = termRef.current?.term
          if (termInstance && termInstance.cols > 0 && termInstance.rows > 0) {
            resizeSession(sessionIdRef.current, termInstance.cols, termInstance.rows)
          }
        })
      }, 100)
    })
    resizeObserver.observe(terminalRef.current)

    term.onData((data) => {
      if (data === '\x1b' && onEscape) {
        onEscape()
        return
      }
      writeSession(sessionIdRef.current, data)
    })

    term.onKey((e) => {
      if (e.key === '\x1b' && onEscape) {
        e.domEvent.stopPropagation()
        onEscape()
      }
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
      resizeObserver.disconnect()
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      term.dispose()
      termRef.current = null
    }
  }, [sessionId, writeSession, resizeSession])

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a]">
      <div className="flex-shrink-0 flex items-center justify-between px-2 py-1 bg-[#252525] border-b border-[#333]">
        <div />
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[#333] text-[#888] hover:text-[#ccc] transition-colors"
          title="Close terminal"
        >
          <XCloseSmallIcon />
        </button>
      </div>
      <div 
        ref={terminalRef} 
        className="flex-1 relative overflow-hidden"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && onEscape) {
            e.preventDefault()
            e.stopPropagation()
            onEscape()
          }
        }}
      />
    </div>
  )
}