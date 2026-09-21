import { useT } from './useT'
import { useModalState } from './useModalState'
import { useSessionStore } from '../stores/session'

export function useSessionModalState(onClose: () => void) {
  const t = useT()
  const refreshSession = useSessionStore((s) => s.loadSession)
  const modalState = useModalState(onClose)
  return { t, refreshSession, ...modalState }
}
