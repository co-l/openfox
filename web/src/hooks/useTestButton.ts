import { useState, useCallback } from 'react'

export function useTestButton(): [
  string,
  string,
  boolean,
  (testFn: () => Promise<{ success: boolean; error?: string }>) => Promise<void>,
] {
  const [text, setText] = useState('Test')
  const [error, setError] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)
  const test = useCallback(async (testFn: () => Promise<{ success: boolean; error?: string }>) => {
    setText('Testing...')
    setError('')
    setIsSuccess(false)
    try {
      const result = await testFn()
      if (result.success) {
        setText('Success')
        setIsSuccess(true)
        setTimeout(() => {
          setText('Test')
          setIsSuccess(false)
        }, 3000)
      } else {
        setError(result.error ?? 'Test failed')
        setText('Test')
      }
    } catch {
      setError('Connection error')
      setText('Test')
    }
  }, [])
  return [text, error, isSuccess, test]
}
