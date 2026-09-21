import { useEffect } from 'react'
import { shouldAutofocus } from '../lib/device'

/**
 * When a search modal opens: clear the query + selection and focus the input
 * after a beat. Shared by QuickActionModal and MessageSearchModal so the
 * reset-on-open behavior stays identical and single-sourced.
 */
export function useResetSearchOnOpen(
  isOpen: boolean,
  searchRef: React.RefObject<HTMLInputElement | null>,
  setSearch: (value: string) => void,
  setSelectedIndex: (index: number) => void,
  extraDeps: readonly unknown[] = [],
): void {
  useEffect(() => {
    if (isOpen) {
      setSearch('')
      setSelectedIndex(0)
      const timer = setTimeout(() => {
        if (shouldAutofocus()) searchRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen, ...extraDeps])
}
