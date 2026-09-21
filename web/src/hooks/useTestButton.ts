import { useState, useCallback } from 'react'
import { t } from '@shared/i18n/index.js'

export function useTestButton(): [
  string,
  string,
  boolean,
  (testFn: () => Promise<{ success: boolean; error?: string }>) => Promise<void>,
] {
  const [text, setText] = useState(t({ en: 'Test', fr: 'Tester' }))
  const [error, setError] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)
  const test = useCallback(async (testFn: () => Promise<{ success: boolean; error?: string }>) => {
    setText(t({ en: 'Testing...', fr: 'Test en cours…' }))
    setError('')
    setIsSuccess(false)
    try {
      const result = await testFn()
      if (result.success) {
        setText(t({ en: 'Success', fr: 'Succès' }))
        setIsSuccess(true)
        setTimeout(() => {
          setText(t({ en: 'Test', fr: 'Tester' }))
          setIsSuccess(false)
        }, 3000)
      } else {
        setError(result.error ?? t({ en: 'Test failed', fr: 'Échec du test' }))
        setText(t({ en: 'Test', fr: 'Tester' }))
      }
    } catch {
      setError(t({ en: 'Connection error', fr: 'Erreur de connexion' }))
      setText(t({ en: 'Test', fr: 'Tester' }))
    }
  }, [])
  return [text, error, isSuccess, test]
}
