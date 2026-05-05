import { useEffect, useRef, useState } from 'react'
import type { PromptContext } from '@shared/types.js'
import { PromptInspector } from '../shared/PromptInspector'
import { CheckIcon, CopyIcon, EyeIcon, EllipsisIcon, TrashIcon } from '../shared/icons'
import { truncateSession } from '../../lib/api.js'
import { useSessionStore } from '../../stores/session.js'

interface MessageOptionsMenuProps {
  content: string
  promptContext?: PromptContext
  align?: 'left' | 'right'
  messageIndex?: number
  sessionId?: string
}

export function MessageOptionsMenu({
  content,
  promptContext,
  align = 'right',
  messageIndex,
  sessionId,
}: MessageOptionsMenuProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [showInspector, setShowInspector] = useState(false)
  const [copied, setCopied] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const loadSession = useSessionStore((s) => s.loadSession)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false)
      }
    }

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMenu])

  const handleCopy = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(content)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = content
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      setCopied(true)
      setShowMenu(false)
      window.setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleDeleteAfter = async () => {
    if (!sessionId || messageIndex === undefined) return
    if (!window.confirm('Delete all messages after this point?')) return

    setDeleting(true)
    setShowMenu(false)
    const ok = await truncateSession(sessionId, messageIndex)
    if (ok) {
      loadSession(sessionId)
    }
    setDeleting(false)
  }

  const isRightAligned = align === 'right'

  return (
    <>
      <div className={`flex items-start gap-1.5 ${isRightAligned ? '' : 'order-first'}`}>
        {copied && <CheckIcon className="w-4 h-4 text-accent-success" />}

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary"
            title="Message options"
          >
            <EllipsisIcon />
          </button>

          {showMenu && (
            <div
              className={`absolute top-full mt-1 bg-bg-secondary border border-border rounded shadow-xl z-50 py-1 min-w-36 ${isRightAligned ? 'right-0' : 'left-0'}`}
            >
              <button
                onClick={handleCopy}
                className="w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-bg-tertiary flex items-center gap-2"
              >
                <CopyIcon className="w-4 h-4" />
                Copy
              </button>
              {sessionId && messageIndex !== undefined && (
                <>
                  <div className="border-t border-border my-1" />
                  <button
                    onClick={handleDeleteAfter}
                    disabled={deleting}
                    className="w-full px-3 py-1.5 text-left text-sm text-red-400 hover:bg-bg-tertiary flex items-center gap-2 disabled:opacity-50"
                  >
                    <TrashIcon className="w-4 h-4" />
                    {deleting ? 'Deleting...' : 'Delete after'}
                  </button>
                </>
              )}
              {promptContext && (
                <button
                  onClick={() => {
                    setShowInspector(true)
                    setShowMenu(false)
                  }}
                  className="w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-bg-tertiary flex items-center gap-2"
                >
                  <EyeIcon className="w-4 h-4" />
                  Inspect
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {promptContext && (
        <PromptInspector isOpen={showInspector} onClose={() => setShowInspector(false)} promptContext={promptContext} />
      )}
    </>
  )
}
