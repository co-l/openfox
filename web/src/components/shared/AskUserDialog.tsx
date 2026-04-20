import { useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import { useSessionStore, type PendingQuestion } from '../../stores/session'

interface AskUserDialogProps {
  question: PendingQuestion
}

export function AskUserDialog({ question }: AskUserDialogProps) {
  const answerQuestion = useSessionStore(state => state.answerQuestion)
  const [answer, setAnswer] = useState('')

  const handleSubmit = () => {
    answerQuestion(question.callId, answer)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <Modal
      isOpen={true}
      onClose={() => {}}
      size="sm"
      closeOnBackdropClick={false}
      closeOnEscape={false}
      showCloseButton={false}
    >
      <div className="space-y-4">
        <p className="text-sm text-text-primary">{question.question}</p>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your answer here..."
          className="w-full min-h-[120px] px-3 py-2 bg-bg-tertiary border border-border rounded text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 resize-y"
          autoFocus
        />
        <div className="flex justify-end gap-2">
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
    </Modal>
  )
}
