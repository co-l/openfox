import { useState, useRef, useEffect } from 'react'
import { Modal } from './shared/SelfContainedModal'
import { Button } from './shared/Button'
import { Input } from './shared/Input'
import { useT } from '../hooks/useT'
import { shouldAutofocus } from '../lib/device'

interface PasswordModalProps {
  isOpen: boolean
  isRetry?: boolean
  onSubmit: (password: string) => void
  onCancel: () => void
}

export function PasswordModal({ isOpen, isRetry, onSubmit, onCancel }: PasswordModalProps) {
  const t = useT()
  const [password, setPassword] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setPassword('')
      setTimeout(() => {
        if (shouldAutofocus()) inputRef.current?.focus()
      }, 100)
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
      title={
        isRetry
          ? t({ en: 'Invalid Password', fr: 'Mot de passe invalide' })
          : t({ en: 'Password Required', fr: 'Mot de passe requis' })
      }
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t({ en: 'Cancel', fr: 'Annuler' })}
          </Button>
          <Button type="submit" form="password-form" disabled={!password.trim()}>
            {isRetry ? t({ en: 'Try Again', fr: 'Réessayer' }) : t({ en: 'Connect', fr: 'Se connecter' })}
          </Button>
        </div>
      }
    >
      <form id="password-form" onSubmit={handleSubmit} className="space-y-4">
        <p className="text-text-secondary text-sm">
          {isRetry
            ? t({
                en: 'The password you entered was incorrect. Please try again.',
                fr: 'Le mot de passe saisi est incorrect. Veuillez réessayer.',
              })
            : t({
                en: 'This server requires a password to connect.',
                fr: 'Ce serveur requiert un mot de passe pour se connecter.',
              })}
        </p>
        <Input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t({ en: 'Enter password', fr: 'Saisir le mot de passe' })}
          autoFocus={shouldAutofocus()}
        />
      </form>
    </Modal>
  )
}
