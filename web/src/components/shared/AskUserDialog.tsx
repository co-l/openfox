import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useSessionStore, type PendingQuestion } from '../../stores/session'
import { Button } from './Button'

interface AskUserDialogProps {
  question: PendingQuestion
}

export function AskUserDialog({ question }: AskUserDialogProps) {
  const answerQuestion = useSessionStore(state => state.answerQuestion)
  const modalRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)
  const [answer, setAnswer] = useState('')
  
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Don't close on escape - user must explicitly answer or skip
    }
  }, [])

  useEffect(() => {
    previousActiveElement.current = document.activeElement as HTMLElement
    modalRef.current?.focus()
    document.body.style.overflow = 'hidden'
    
    return () => {
      previousActiveElement.current?.focus()
      document.body.style.overflow = ''
    }
  }, [])

  useEffect(() => {
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [handleEscape])

  const handleSubmit = () => {
    answerQuestion(question.callId, answer)
  }
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }
  
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* Modal */}
      <div 
        ref={modalRef}
        tabIndex={-1}
        className="relative w-full max-w-[90vw] md:max-w-md bg-bg-secondary border border-border rounded shadow-xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.592.115-1.207.532-1.207 1.093 0 .56.41.978 1.002 1.093 1.728.332 3.006 1.507 3.006 2.907 0 1.657-1.79 3-4 3-1.742 0-3.223-.835-3.772-2m-3.772 2v-2m1.772-12h1.594l1.414 1.414M3 12h.01M21 12h.01M12 3v2m0 14v2M3 6h.01M21 6h.01M3 18h.01M21 18h.01" />
            </svg>
            <h2 className="text-lg font-semibold text-text-primary">Question from Agent</h2>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 min-h-0 space-y-4">
          <p className="text-sm text-text-primary">
            {question.question}
          </p>
          
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your answer here..."
            className="w-full min-h-[120px] px-3 py-2 bg-bg-tertiary border border-border rounded text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 resize-y"
            autoFocus
          />
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-border flex justify-end gap-2 flex-shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => answerQuestion(question.callId, '')}
          >
            Skip
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
          >
            Send Answer
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
