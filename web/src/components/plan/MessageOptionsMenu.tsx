import { useEffect, useRef, useState } from 'react'
import { CheckIcon, CopyIcon, EllipsisIcon, ReloadIcon } from '../shared/icons'
import { replayMessage } from '../../lib/api.js'
import { useSessionStore } from '../../stores/session.js'

interface MessageOptionsMenuProps {
  content: string
  align?: 'left' | 'right'
  messageIndex?: number
  sessionId?: string
}

export function MessageOptionsMenu({ content, align = 'right', messageIndex, sessionId }: MessageOptionsMenuProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const [menuPosition, setMenuPosition] = useState<'left' | 'right'>('left')
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const loadSession = useSessionStore((s) => s.loadSession)

  const isRightAligned = align === 'right'

  const calculatePosition = (): 'left' | 'right' => {
    if (!buttonRef.current) return 'left'
    const buttonRect = buttonRef.current.getBoundingClientRect()
    const spaceOnRight = window.innerWidth - buttonRect.right
    const spaceOnLeft = buttonRect.left

    // Get actual menu width from computed styles (min-w-36 = 144px, but can be wider based on content)
    const menuElement = menuRef.current?.querySelector('[class*="absolute"]') as HTMLElement
    const menuWidth = menuElement ? Math.max(menuElement.getBoundingClientRect().width, 144) : 144

    const canFitOnRight = spaceOnRight >= menuWidth
    const canFitOnLeft = spaceOnLeft >= menuWidth

    if (canFitOnLeft && canFitOnRight) return 'left'
    if (canFitOnLeft) return 'left'
    if (canFitOnRight) return 'right'
    return spaceOnLeft >= spaceOnRight ? 'left' : 'right'
  }

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

  const handleReplay = async () => {
    if (!sessionId || messageIndex === undefined) return

    setShowMenu(false)
    await replayMessage(sessionId, messageIndex)
    loadSession(sessionId)
  }

  return (
    <>
      <div className={`flex items-start gap-1.5 ${isRightAligned ? '' : 'order-first'}`}>
        {copied && <CheckIcon className="w-4 h-4 text-accent-success" />}

        <div ref={menuRef} className="relative">
          <button
            ref={buttonRef}
            onClick={() => {
              if (!showMenu) {
                setMenuPosition(calculatePosition())
              }
              setShowMenu(!showMenu)
            }}
            className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary"
            title="Message options"
          >
            <EllipsisIcon />
          </button>

          {showMenu && (
            <div
              className={`absolute top-full mt-1 bg-bg-secondary border border-border rounded shadow-xl z-50 py-1 min-w-36 ${menuPosition === 'right' ? 'left-0' : 'right-0'}`}
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
                    onClick={handleReplay}
                    className="w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-bg-tertiary flex items-center gap-2"
                  >
                    <ReloadIcon className="w-4 h-4" />
                    Replay
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
