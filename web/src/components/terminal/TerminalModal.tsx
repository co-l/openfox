import { useState, useEffect, useCallback } from 'react'
import { useTerminalStore } from '../../stores/terminal'
import { useProjectStore } from '../../stores/project'
import { TerminalPane } from './TerminalPane'

type SplitDirection = 'vertical' | 'horizontal'

interface SplitNode {
  id: string
  sessionId: string | null
  children?: [SplitNode, SplitNode]
}

function generateId(): string {
  return `split_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

function createSplitNode(sessionId: string | null = null): SplitNode {
  return { id: generateId(), sessionId }
}

interface TerminalModalProps {
  isOpen: boolean
  onClose: () => void
}

export function TerminalModal({ isOpen, onClose }: TerminalModalProps) {
  const createSession = useTerminalStore(state => state.createSession)
  const killSession = useTerminalStore(state => state.killSession)
  const sessions = useTerminalStore(state => state.sessions)
  const setWorkdir = useTerminalStore(state => state.setWorkdir)
  const currentProject = useProjectStore(state => state.currentProject)

  const [rootSplit, setRootSplit] = useState<SplitNode | null>(null)

  useEffect(() => {
    if (currentProject?.workdir) {
      setWorkdir(currentProject.workdir)
    }
  }, [currentProject?.workdir, setWorkdir])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      window.addEventListener('keydown', handleEsc)
      return () => window.removeEventListener('keydown', handleEsc)
    }
  }, [isOpen, onClose])

  const handleInitialSplit = useCallback((_direction: SplitDirection) => {
    if (sessions.length === 0) {
      createSession()
    }
    setRootSplit(prev => {
      if (prev) {
        return prev
      }
      const firstSession = sessions[0]
      return {
        id: generateId(),
        sessionId: firstSession?.id ?? null,
        children: undefined,
      }
    })
  }, [sessions, createSession])

  const handleClose = useCallback((nodeId: string) => {
    setRootSplit(prev => {
      if (!prev) return null

      const findAndRemove = (node: SplitNode): SplitNode | null => {
        if (node.id === nodeId) {
          return null
        }
        if (node.children) {
          const [left, right] = node.children
          const newLeft = findAndRemove(left)
          const newRight = findAndRemove(right)
          if (newLeft !== left || newRight !== right) {
            return { ...node, children: [newLeft!, newRight!] }
          }
        }
        return node
      }

      const result = findAndRemove(prev)
      return result
    })

    for (const session of sessions) {
      killSession(session.id)
    }
  }, [sessions, killSession])

  const handleSplitVertical = useCallback((nodeId: string) => {
    const newSessionId = `pending_${generateId()}`
    createSession()

    setRootSplit(prev => {
      if (!prev) return createSplitNode(newSessionId)

      const addSplit = (node: SplitNode): SplitNode => {
        if (node.id === nodeId && !node.children) {
          const left = createSplitNode(node.sessionId)
          const right = createSplitNode(newSessionId)
          return {
            id: node.id,
            sessionId: null,
            children: [left, right],
          }
        }
        if (node.children) {
          return {
            ...node,
            children: [addSplit(node.children[0]), addSplit(node.children[1])],
          }
        }
        return node
      }

      return addSplit(prev)
    })
  }, [createSession])

  const handleSplitHorizontal = useCallback((nodeId: string) => {
    const newSessionId = `pending_${generateId()}`
    createSession()

    setRootSplit(prev => {
      if (!prev) return createSplitNode(newSessionId)

      const addSplit = (node: SplitNode): SplitNode => {
        if (node.id === nodeId && !node.children) {
          const left = createSplitNode(node.sessionId)
          const right = createSplitNode(newSessionId)
          return {
            id: node.id,
            sessionId: null,
            children: [left, right],
          }
        }
        if (node.children) {
          return {
            ...node,
            children: [addSplit(node.children[0]), addSplit(node.children[1])],
          }
        }
        return node
      }

      return addSplit(prev)
    })
  }, [createSession])

  useEffect(() => {
    const firstSession = sessions[0]
    if (isOpen && firstSession && !rootSplit) {
      setRootSplit(createSplitNode(firstSession.id))
    }
  }, [isOpen, sessions, rootSplit])

  const renderNode = (node: SplitNode, direction: 'vertical' | 'horizontal'): React.ReactNode => {
    if (node.children) {
      const [left, right] = node.children
      const directionClass = direction === 'vertical' ? 'flex-row' : 'flex-col'
      const dividerClass = direction === 'vertical'
        ? 'w-[1px] bg-border hover:bg-accent-primary cursor-col-resize'
        : 'h-[1px] bg-border hover:bg-accent-primary cursor-row-resize'

      return (
        <div key={node.id} className={`flex ${directionClass} flex-1 min-w-0 min-h-0`}>
          <div className="flex-1 min-w-0 min-h-0">
            {renderNode(left, 'vertical')}
          </div>
          <div className={dividerClass} />
          <div className="flex-1 min-w-0 min-h-0">
            {renderNode(right, 'horizontal')}
          </div>
        </div>
      )
    }

    const sessionId = node.sessionId ?? sessions[0]?.id ?? ''
    return (
      <TerminalPane
        key={node.id}
        sessionId={sessionId}
        onClose={() => handleClose(node.id)}
        onSplitVertical={() => handleSplitVertical(node.id)}
        onSplitHorizontal={() => handleSplitHorizontal(node.id)}
      />
    )
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative w-[90vw] h-[85vh] bg-bg-primary rounded-lg border border-border flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">Terminals</h3>
          <div className="flex items-center gap-2">
            {!rootSplit && sessions.length === 0 && (
              <>
                <button
                  onClick={() => handleInitialSplit('vertical')}
                  className="p-2 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
                  title="Split vertical"
                >
                  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M6 2v12H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h2zm8 0v12h2a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1h-2zM6 3h4v1H6V3zm0 2h4v1H6V5zm0 2h4v1H6V7zm0 2h4v1H6V9z"/>
                  </svg>
                </button>
                <button
                  onClick={() => handleInitialSplit('horizontal')}
                  className="p-2 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
                  title="Split horizontal"
                >
                  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 4v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1zm1 0h6v2H3V4zm6 0h6v2H9V4z"/>
                  </svg>
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
              title="Close"
            >
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          {rootSplit ? (
            renderNode(rootSplit, 'vertical')
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted">
              <div className="text-center">
                <p className="mb-4">No terminal sessions</p>
                <button
                  onClick={() => createSession()}
                  className="px-4 py-2 bg-accent-primary/25 text-white rounded hover:bg-accent-primary/40 transition-colors"
                >
                  Create Terminal
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}