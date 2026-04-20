import { useState, useRef, useEffect } from 'react'
import { Modal } from './shared/SelfContainedModal'
import { Button } from './shared/Button'
import { Input } from './shared/Input'

interface PasswordModalProps {
  isOpen: boolean
  isRetry?: boolean
  onSubmit: (password: string) => void
  onCancel: () => void
}

export function PasswordModal({ isOpen, isRetry, onSubmit, onCancel }: PasswordModalProps) {
  const [password, setPassword] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setPassword('')
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim()) {
      return
    }
    onSubmit(password)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={isRetry ? 'Invalid Password' : 'Password Required'}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-text-secondary text-sm">
          {isRetry
            ? 'The password you entered was incorrect. Please try again.'
            : 'This server requires a password to connect.'}
        </p>
        <Input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!password.trim()}>
            {isRetry ? 'Try Again' : 'Connect'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}