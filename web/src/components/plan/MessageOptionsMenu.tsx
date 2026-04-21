import { useEffect, useRef, useState } from 'react'
import type { PromptContext } from '@shared/types.js'
import { PromptInspector } from '../shared/PromptInspector'
import { CheckIcon, CopyIcon, EyeIcon, EllipsisIcon } from '../shared/icons'

interface MessageOptionsMenuProps {
  content: string
  promptContext?: PromptContext
  align?: 'left' | 'right'
}

export function MessageOptionsMenu({ content, promptContext, align = 'right' }: MessageOptionsMenuProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [showInspector, setShowInspector] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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
        // Fallback for non-secure contexts where clipboard API is unavailable
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

  const isRightAligned = align === 'right'

  return (
    <>
      <div className={`flex items-start gap-1.5 ${isRightAligned ? '' : 'order-first'}`}>
        {copied && (
          <CheckIcon className="w-4 h-4 text-accent-success" />
        )}

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary"
            title="Message options"
          >
            <EllipsisIcon />
          </button>

          {showMenu && (
            <div className={`absolute top-full mt-1 bg-bg-secondary border border-border rounded shadow-xl z-50 py-1 min-w-36 ${isRightAligned ? 'right-0' : 'left-0'}`}>
              <button
                onClick={handleCopy}
                className="w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-bg-tertiary flex items-center gap-2"
              >
                <CopyIcon className="w-4 h-4" />
                Copy
              </button>
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
        <PromptInspector
          isOpen={showInspector}
          onClose={() => setShowInspector(false)}
          promptContext={promptContext}
        />
      )}
    </>
  )
}
