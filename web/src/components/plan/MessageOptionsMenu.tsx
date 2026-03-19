import { useEffect, useRef, useState } from 'react'
import type { PromptContext } from '../../../src/shared/types.js'
import { PromptInspector } from '../shared/PromptInspector'

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
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setShowMenu(false)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const isRightAligned = align === 'right'

  return (
    <>
      <div className={`flex items-start gap-1.5 ${isRightAligned ? '' : 'order-first'}`}>
        {copied && (
          <svg className="w-4 h-4 text-accent-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary"
            title="Message options"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>

          {showMenu && (
            <div className={`absolute top-full mt-1 bg-bg-secondary border border-border rounded shadow-xl z-50 py-1 min-w-36 ${isRightAligned ? 'right-0' : 'left-0'}`}>
              <button
                onClick={handleCopy}
                className="w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-bg-tertiary flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
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
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
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
