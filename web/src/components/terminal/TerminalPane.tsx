import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useTerminalStore } from '../../stores/terminal'
import { wsClient } from '../../lib/ws'

interface TerminalPaneProps {
  sessionId: string
  onClose: () => void
  onSplitVertical: () => void
  onSplitHorizontal: () => void
}

export function TerminalPane({ sessionId, onClose, onSplitVertical, onSplitHorizontal }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef(sessionId)

  const writeSession = useTerminalStore(state => state.writeSession)

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    if (!terminalRef.current) return

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#1a1a1a',
        foreground: '#e0e0e0',
        cursor: '#ffffff',
        cursorAccent: '#1a1a1a',
        selectionBackground: '#444444',
        black: '#000000',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#bfbfbf',
        brightBlack: '#4d4d4d',
        brightRed: '#ff6e67',
        brightGreen: '#5af78e',
        brightYellow: '#f4f99d',
        brightBlue: '#caa9fa',
        brightMagenta: '#ff92d0',
        brightCyan: '#9aedfe',
        brightWhite: '#e6e6e6',
      },
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    term.open(terminalRef.current)

    term.onData((data) => {
      writeSession(sessionIdRef.current, data)
    })

    const unsubscribe = wsClient.subscribe((msg: any) => {
      if (msg.type === 'terminal.output' && msg.payload?.sessionId === sessionIdRef.current) {
        const data = msg.payload?.data
        if (data && term) {
          term.write(data)
        }
      }
    })

    return () => {
      unsubscribe()
      term.dispose()
      fitAddonRef.current = null
    }
  }, [sessionId, writeSession])

  useEffect(() => {
    if (!fitAddonRef.current || !containerRef.current) return

    fitAddonRef.current.fit()

    const onResize = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => fitAddonRef.current?.fit())
      })
    }

    window.addEventListener('resize', onResize)
    const resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(containerRef.current)

    return () => {
      window.removeEventListener('resize', onResize)
      resizeObserver.disconnect()
    }
  }, [sessionId])

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a]">
      <div className="flex-shrink-0 flex items-center justify-between px-2 py-1 bg-[#252525] border-b border-[#333]">
        <div className="flex items-center gap-1">
          <button
            onClick={onSplitVertical}
            className="p-1 rounded hover:bg-[#333] text-[#888] hover:text-[#ccc] transition-colors"
            title="Split vertical"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6 2v12H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h2zm6 0v12h2a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1h-2zM6 3h4v1H6V3zm0 2h4v1H6V5zm0 2h4v1H6V7zm0 2h4v1H6V9z"/>
            </svg>
          </button>
          <button
            onClick={onSplitHorizontal}
            className="p-1 rounded hover:bg-[#333] text-[#888] hover:text-[#ccc] transition-colors"
            title="Split horizontal"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 4v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1zm1 0h5v2H3V4zm6 0h5v2H9V4z"/>
            </svg>
          </button>
        </div>
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
      <div ref={containerRef} className="flex-1 p-2" style={{ boxSizing: 'border-box' }}>
        <div ref={terminalRef} className="w-full h-full" />
      </div>
    </div>
  )
}